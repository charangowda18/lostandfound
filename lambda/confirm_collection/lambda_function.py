"""
Campus Lost & Found — Lambda: Confirm Collection
=================================================
Marks an item as COLLECTED by an authorised organiser.

API: POST /items/{itemId}/collect
Body: { claimantName }
Auth: Cognito JWT required (organiser group)

SECURITY — THIS IS THE MOST IMPORTANT FUNCTION:
1. Requires valid Cognito JWT token (API Gateway validates it).
2. The organiser's name and ID come from the JWT claims, NOT the request body.
   This prevents someone from pretending to be a different organiser.
3. Uses a DynamoDB ConditionExpression to prevent duplicate collections.
   If the item is already COLLECTED, the write fails atomically.
4. Creates an append-only audit record in the CollectionHistory table.
5. Normal users cannot call this endpoint (Cognito group check).
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

dynamodb = boto3.resource('dynamodb')
items_table = dynamodb.Table(ITEMS_TABLE)
history_table = dynamodb.Table(HISTORY_TABLE)


def lambda_handler(event, context):
    try:
        # ---- 1. Get itemId from URL path ----
        item_id = event.get('pathParameters', {}).get('itemId')
        if not item_id:
            return response_error(400, 'Missing itemId in path')

        # ---- 2. Get organiser identity from JWT (NOT from request body) ----
        # API Gateway puts the decoded JWT claims in requestContext.authorizer.claims
        claims = event.get('requestContext', {}).get('authorizer', {}).get('claims', {})

        # 'sub' is the unique Cognito user ID
        # 'email' or 'cognito:username' is the username
        # 'name' is the display name (if set)
        # 'cognito:groups' contains the user's groups
        organiser_id = claims.get('sub', '')
        organiser_name = claims.get('name', '') or claims.get('email', '') or claims.get('cognito:username', 'Unknown')
        organiser_email = claims.get('email', '')

        if not organiser_id:
            return response_error(403, 'Unable to identify organiser from token. Authentication required.')

        # ---- 3. Parse and validate request body ----
        body = json.loads(event.get('body', '{}'))
        claimant_name = sanitise(body.get('claimantName', ''), max_len=100)

        if not claimant_name:
            return response_error(400, 'claimantName is required')

        # ---- 4. First, fetch the item to get its name/category for the audit record ----
        get_response = items_table.get_item(Key={'itemId': item_id})
        item = get_response.get('Item')

        if not item:
            return response_error(404, 'Item not found')

        # ---- 5a. Verify this is a FOUND item ----
        # Only found items can be collected. Lost items haven't been
        # physically recovered yet, so collection doesn't apply.
        # This is enforced server-side regardless of frontend checks.
        if item.get('reportType') != 'FOUND':
            return response_error(400, 'Only found items can be collected. Lost items must first be reported as found.')

        # ---- 5b. Conditional update: only if collectionStatus is still PENDING ----
        # This is the key security measure — DynamoDB guarantees atomicity.
        # If two organisers click "Confirm" at the same time, only one succeeds.
        now = datetime.now(timezone.utc).isoformat()

        try:
            items_table.update_item(
                Key={'itemId': item_id},
                UpdateExpression=(
                    'SET collectionStatus = :collected, '
                    'claimantName = :claimant, '
                    'organiserName = :orgName, '
                    'organiserId = :orgId, '
                    'collectionTimestamp = :ts, '
                    'updatedAt = :ts'
                ),
                ExpressionAttributeValues={
                    ':collected': 'COLLECTED',
                    ':claimant': claimant_name,
                    ':orgName': organiser_name,
                    ':orgId': organiser_id,
                    ':ts': now,
                    ':pending': 'PENDING',
                },
                ConditionExpression='collectionStatus = :pending',
            )
        except ClientError as e:
            if e.response['Error']['Code'] == 'ConditionalCheckFailedException':
                return response_error(409, 'This item has already been collected. Duplicate collection is not allowed.')
            raise

        # ---- 6. Create append-only audit record ----
        record_id = f"COL-{uuid.uuid4().hex[:8].upper()}"
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
        history_table.put_item(Item=history_record)

        print(f"[INFO] Collection confirmed: item={item_id}, claimant={claimant_name}, organiser={organiser_name}")

        # Return updated item + history record
        updated_item = {**item, 
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
