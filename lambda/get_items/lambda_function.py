"""
Campus Lost & Found — Lambda: Get Items
========================================
Fetches items from DynamoDB with optional search/filter.

API: GET /items?search=...&category=...&reportType=...&collectionStatus=...

WHY THIS DESIGN (for beginners):
- This function scans the DynamoDB table and applies filters.
- For a small college project, a Scan with filters is fine.
- For a larger app, you'd use GSI queries instead of scans.
- The function returns JSON that the frontend can display directly.
"""

import json
import os
import boto3
from boto3.dynamodb.conditions import Attr

# Read table name from environment variable (set in Lambda config)
TABLE_NAME = os.environ.get('ITEMS_TABLE', 'CampusLostFoundItems')

# Create DynamoDB resource (reused across invocations for performance)
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)


def lambda_handler(event, context):
    """
    Main entry point. API Gateway sends the HTTP request details
    in the 'event' dictionary.
    """
    try:
        # Get query parameters (e.g., ?category=Electronics)
        params = event.get('queryStringParameters') or {}

        search = params.get('search', '').strip().lower()
        category = params.get('category', '').strip()
        report_type = params.get('reportType', '').strip()
        collection_status = params.get('collectionStatus', '').strip()

        # Build filter expression
        filter_parts = []

        if category:
            filter_parts.append(Attr('category').eq(category))
        if report_type:
            filter_parts.append(Attr('reportType').eq(report_type))
        if collection_status:
            filter_parts.append(Attr('collectionStatus').eq(collection_status))

        # Combine filters with AND
        scan_kwargs = {}
        if filter_parts:
            combined = filter_parts[0]
            for f in filter_parts[1:]:
                combined = combined & f
            scan_kwargs['FilterExpression'] = combined

        # Perform scan
        response = table.scan(**scan_kwargs)
        items = response.get('Items', [])

        # Handle pagination (DynamoDB returns max 1MB per scan)
        while 'LastEvaluatedKey' in response:
            scan_kwargs['ExclusiveStartKey'] = response['LastEvaluatedKey']
            response = table.scan(**scan_kwargs)
            items.extend(response.get('Items', []))

        # Apply text search filter (DynamoDB can't do "contains" on text efficiently)
        if search:
            items = [
                item for item in items
                if search in item.get('itemName', '').lower()
                or search in item.get('description', '').lower()
            ]

        # Sort by createdAt descending (newest first)
        items.sort(key=lambda x: x.get('createdAt', ''), reverse=True)

        return response_200(items)

    except Exception as e:
        print(f"[ERROR] get_items: {str(e)}")
        return response_error(500, 'Failed to fetch items')


# ---- Helper: Build HTTP response ----

def response_200(body):
    """Return a 200 OK response with CORS headers."""
    return {
        'statusCode': 200,
        'headers': cors_headers(),
        'body': json.dumps(body, default=str)  # default=str handles Decimal
    }


def response_error(status_code, message):
    """Return an error response."""
    return {
        'statusCode': status_code,
        'headers': cors_headers(),
        'body': json.dumps({'error': message})
    }


def cors_headers():
    """CORS headers so the browser allows requests from our frontend."""
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
