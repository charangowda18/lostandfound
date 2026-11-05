"""
Campus Lost & Found — Lambda: Confirm Collection
=================================================
Marks an item as COLLECTED by an authorised organiser.

API: POST /items/{itemId}/collect
Body: { claimantName }
Auth: Cognito JWT required (Organisers group)

SECURITY & TRANSACTION ARCHITECTURE:
1. Validates Cognito JWT token presence via API Gateway claims.
2. Derives organiser identity strictly from verified token claims (sub, name, email),
   never trusting caller-supplied input in the request body.
3. Explicitly verifies that the caller belongs to the authorised Organisers group
   via the 'cognito:groups' claim. Ordinary students or users outside this group are
   rejected with HTTP 403 Forbidden.
4. Enforces that only FOUND items can be collected (LOST items must first be reported found).
5. Uses DynamoDB TransactWriteItems to atomically update the item status and write
   the immutable collection history record in a single transaction. If either write
   fails, neither is committed, guaranteeing that audit records cannot be silently lost.
6. Conditional expression (collectionStatus = PENDING) inside the transaction guarantees
   that duplicate collections are rejected atomically with HTTP 409 Conflict.
"""

import json
import os
import re
import uuid
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

ITEMS_TABLE = os.environ.get('ITEMS_TABLE', 'CampusLostFoundItems')
HISTORY_TABLE = os.environ.get('HISTORY_TABLE', 'CampusLostFoundHistory')
ORGANISER_GROUP = os.environ.get('ORGANISER_GROUP', 'Organisers')

dynamodb = boto3.resource('dynamodb')
dynamodb_client = boto3.client('dynamodb')
items_table = dynamodb.Table(ITEMS_TABLE)
history_table = dynamodb.Table(HISTORY_TABLE)


def is_in_organiser_group(claims):
    """
    Verify if the user belongs to the authorised organisers group.
    Cognito claims 'cognito:groups' can appear as:
    - A Python list/set: ['Organisers']
    - A single string: 'Organisers' or '[Organisers]'
    - A comma-separated string: 'Organisers,Staff'
    """
    raw_groups = claims.get('cognito:groups')
    if not raw_groups:
        return False

    target = ORGANISER_GROUP.strip().lower()

    if isinstance(raw_groups, (list, tuple, set)):
        return any(str(g).strip().lower() == target for g in raw_groups)

    if isinstance(raw_groups, str):
        cleaned = raw_groups.strip('[]"\' ')
        groups = [g.strip().strip('"\'').lower() for g in cleaned.split(',') if g.strip()]
        return target in groups

    return False


def lambda_handler(event, context):
    try:
        # ---- 1. Get itemId from URL path ----
        item_id = event.get('pathParameters', {}).get('itemId')
        if not item_id:
            return response_error(400, 'Missing itemId in path')

        # ---- 2. Get and verify organiser identity from JWT claims ----
        claims = event.get('requestContext', {}).get('authorizer', {}).get('claims', {})

        organiser_id = claims.get('sub', '')
        if not organiser_id:
            return response_error(403, 'Unable to identify organiser from token. Authentication required.')

        # ---- 3. Explicit Organiser Group Authorization Check ----
        # Ordinary students or users without the Organisers group are strictly forbidden
        if not is_in_organiser_group(claims):
            return response_error(403, f'Forbidden: User does not belong to the authorised {ORGANISER_GROUP} group.')

        # Organiser identity is derived strictly from verified claims, never from request body
        organiser_name = claims.get('name', '') or claims.get('email', '') or claims.get('cognito:username', 'Unknown')
        organiser_email = claims.get('email', '')

        # ---- 4. Parse and validate request body ----
        body = json.loads(event.get('body', '{}'))
        claimant_name = sanitise(body.get('claimantName', ''), max_len=100)

        if not claimant_name:
            return response_error(400, 'claimantName is required')

        # ---- 5. Fetch the item to check existence, type, and current status ----
        get_response = items_table.get_item(Key={'itemId': item_id})
        item = get_response.get('Item')

        if not item:
            return response_error(404, 'Item not found')

        # ---- 6. Verify item is a FOUND item ----
        # Lost items have not been physically recovered and cannot be collected directly
        if item.get('reportType') != 'FOUND':
            return response_error(400, 'Only found items can be collected. Lost items must first be reported as found.')

        # Fast pre-check for already collected item
        if item.get('collectionStatus') == 'COLLECTED':
            return response_error(409, 'This item has already been collected. Duplicate collection is not allowed.')

        now = datetime.now(timezone.utc).isoformat()
        record_id = f"COL-{uuid.uuid4().hex[:8].upper()}"

        # ---- 7. Atomic Transactional Write ----
        # Atomically updates the item and inserts the audit record in a single transaction.
        # This guarantees collection history is never silently lost if history write fails.
        # ConditionExpression ensures atomic duplicate prevention against race conditions.
        try:
            dynamodb_client.transact_write_items(
                TransactItems=[
                    {
                        'Update': {
                            'TableName': ITEMS_TABLE,
                            'Key': {'itemId': {'S': item_id}},
                            'UpdateExpression': (
                                'SET collectionStatus = :collected, '
                                'claimantName = :claimant, '
                                'organiserName = :orgName, '
                                'organiserId = :orgId, '
                                'collectionTimestamp = :ts, '
                                'updatedAt = :ts'
                            ),
                            'ExpressionAttributeValues': {
                                ':collected': {'S': 'COLLECTED'},
                                ':claimant': {'S': claimant_name},
                                ':orgName': {'S': organiser_name},
                                ':orgId': {'S': organiser_id},
                                ':ts': {'S': now},
                                ':pending': {'S': 'PENDING'},
                            },
                            'ConditionExpression': 'collectionStatus = :pending',
                        }
                    },
                    {
                        'Put': {
                            'TableName': HISTORY_TABLE,
                            'Item': {
                                'recordId': {'S': record_id},
                                'itemId': {'S': item_id},
                                'itemName': {'S': item.get('itemName', '')},
                                'category': {'S': item.get('category', '')},
                                'claimantName': {'S': claimant_name},
                                'organiserName': {'S': organiser_name},
                                'organiserId': {'S': organiser_id},
                                'organiserEmail': {'S': organiser_email or ''},
                                'collectionTimestamp': {'S': now},
                                'status': {'S': 'COLLECTED'},
                                'isDemo': {'BOOL': False},
                            }
                        }
                    }
                ]
            )
        except ClientError as e:
            code = e.response.get('Error', {}).get('Code', '')
            if code in ('TransactionCanceledException', 'ConditionalCheckFailedException'):
                return response_error(409, 'This item has already been collected. Duplicate collection is not allowed.')
            raise

        print(f"[INFO] Collection confirmed atomically: item={item_id}, claimant={claimant_name}, organiser={organiser_name}")

        history_record = {
            'recordId': record_id,
            'itemId': item_id,
            'itemName': item.get('itemName', ''),
            'category': item.get('category', ''),
            'claimantName': claimant_name,
            'organiserName': organiser_name,
            'organiserId': organiser_id,
            'organiserEmail': organiser_email,
            'collectionTimestamp': now,
            'status': 'COLLECTED',
            'isDemo': False,
        }

        updated_item = {
            **item,
            'collectionStatus': 'COLLECTED',
            'claimantName': claimant_name,
            'organiserName': organiser_name,
            'organiserId': organiser_id,
            'collectionTimestamp': now,
            'updatedAt': now,
        }

        return response_200({
            'item': updated_item,
            'historyRecord': history_record,
        })

    except json.JSONDecodeError:
        return response_error(400, 'Invalid JSON in request body')
    except Exception as e:
        print(f"[ERROR] confirm_collection: {str(e)}")
        return response_error(500, 'Failed to confirm collection')


def sanitise(text, max_len=200):
    if not text:
        return ''
    clean = re.sub(r'<[^>]+>', '', str(text)).strip()
    return clean[:max_len]


def response_200(body):
    return {
        'statusCode': 200,
        'headers': cors_headers(),
        'body': json.dumps(body, default=str)
    }


def response_error(status_code, message):
    return {
        'statusCode': status_code,
        'headers': cors_headers(),
        'body': json.dumps({'error': message})
    }


def cors_headers():
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
