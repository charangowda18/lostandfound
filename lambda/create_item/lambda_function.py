"""
Campus Lost & Found — Lambda: Create Item
==========================================
Creates a new lost or found item report.

API: POST /items
Body: { itemName, description, category, reportType, location, reportDate, imageKey }

SECURITY:
- Validates all required fields
- Sanitises text input (strips HTML)
- Limits field lengths
- This is a PUBLIC endpoint (students don't need login to report)
"""

import json
import os
import re
import uuid
from datetime import datetime, timezone

import boto3

TABLE_NAME = os.environ.get('ITEMS_TABLE', 'CampusLostFoundItems')
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)

# Allowed categories (server-side validation)
VALID_CATEGORIES = [
    'Electronics', 'Books & Stationery', 'Clothing',
    'ID Cards & Documents', 'Keys', 'Bags & Wallets',
    'Sports Equipment', 'Other'
]

VALID_REPORT_TYPES = ['LOST', 'FOUND']


def lambda_handler(event, context):
    try:
        # Parse request body
        body = json.loads(event.get('body', '{}'))

        # ---- Validate required fields ----
        item_name = sanitise(body.get('itemName', ''), max_len=100)
        description = sanitise(body.get('description', ''), max_len=500)
        category = body.get('category', '').strip()
        report_type = body.get('reportType', '').strip().upper()
        location = sanitise(body.get('location', ''), max_len=150)
        report_date = body.get('reportDate', '').strip()
        image_key = body.get('imageKey', None)

        errors = []
        if not item_name:
            errors.append('itemName is required')
        if not description:
            errors.append('description is required')
        if category not in VALID_CATEGORIES:
            errors.append(f'Invalid category. Must be one of: {", ".join(VALID_CATEGORIES)}')
        if report_type not in VALID_REPORT_TYPES:
            errors.append('reportType must be LOST or FOUND')
        if not location:
            errors.append('location is required')
        if not report_date:
            errors.append('reportDate is required')

        if errors:
            return response_error(400, '; '.join(errors))

        # ---- Create item record ----
        now = datetime.now(timezone.utc).isoformat()
        item_id = f"ITEM-{uuid.uuid4().hex[:8].upper()}"

        item = {
            'itemId': item_id,
            'itemName': item_name,
            'description': description,
            'category': category,
            'reportType': report_type,
            'location': location,
            'reportDate': report_date,
            'imageKey': image_key,
            'status': 'ACTIVE',
            'collectionStatus': 'PENDING',
            'claimantName': None,
            'organiserName': None,
            'organiserId': None,
            'collectionTimestamp': None,
            'createdAt': now,
            'updatedAt': now,
            'isDemo': False,
        }

        # Write to DynamoDB
        table.put_item(Item=item)

        print(f"[INFO] Created item {item_id}: {item_name} ({report_type})")
        return response_201(item)

    except json.JSONDecodeError:
        return response_error(400, 'Invalid JSON in request body')
    except Exception as e:
        print(f"[ERROR] create_item: {str(e)}")
        return response_error(500, 'Failed to create item')


def sanitise(text, max_len=200):
    """Strip HTML tags and limit length."""
    if not text:
        return ''
    # Remove HTML tags
    clean = re.sub(r'<[^>]+>', '', str(text))
    # Strip whitespace
    clean = clean.strip()
    # Limit length
    return clean[:max_len]


def response_201(body):
    return {
        'statusCode': 201,
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
