"""
Campus Lost & Found — Lambda: Get Collection History
=====================================================
Returns collection audit records.

API: GET /collection-history

SECURITY:
- Authenticated organisers (valid Cognito JWT) see full records
  including claimant names, organiser emails, and organiser IDs.
- Unauthenticated requests receive a REDACTED response: claimant
  names are masked and organiser emails are omitted entirely.
- This protects private claimant information from public exposure
  while still allowing students to see that an item was collected.

API Gateway configuration:
  The Cognito authoriser on this endpoint should be set to OPTIONAL
  (or the endpoint left public) so both paths work. The Lambda itself
  inspects the JWT claims to decide which view to return.
"""

import json
import os
import boto3

HISTORY_TABLE = os.environ.get('HISTORY_TABLE', 'CampusLostFoundHistory')
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(HISTORY_TABLE)


def lambda_handler(event, context):
    try:
        # ---- 1. Check if request is from an authenticated organiser ----
        claims = event.get('requestContext', {}).get('authorizer', {}).get('claims', {})
        is_authenticated = bool(claims.get('sub'))

        # ---- 2. Fetch all history records ----
        response = table.scan()
        records = response.get('Items', [])

        # Handle pagination
        while 'LastEvaluatedKey' in response:
            response = table.scan(ExclusiveStartKey=response['LastEvaluatedKey'])
            records.extend(response.get('Items', []))

        # Sort by collectionTimestamp descending
        records.sort(key=lambda x: x.get('collectionTimestamp', ''), reverse=True)

        # ---- 3. Redact private fields for unauthenticated requests ----
        if not is_authenticated:
            records = [redact_record(r) for r in records]

        return response_200(records)

    except Exception as e:
        print(f"[ERROR] get_collection_history: {str(e)}")
        return response_error(500, 'Failed to fetch collection history')


def redact_record(record):
    """
    Return a copy of the record with private fields redacted.
    Students can see THAT an item was collected, but not WHO collected it.
    """
    safe = {
        'recordId': record.get('recordId', ''),
        'itemId': record.get('itemId', ''),
        'itemName': record.get('itemName', ''),
        'category': record.get('category', ''),
        'claimantName': '(Redacted)',
        'organiserName': record.get('organiserName', ''),
        'organiserId': '(Redacted)',
        'collectionTimestamp': record.get('collectionTimestamp', ''),
        'status': record.get('status', ''),
        'isDemo': record.get('isDemo', False),
        'redacted': True,   # flag so the frontend knows this is redacted
    }
    # Deliberately omit organiserEmail
    return safe


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
