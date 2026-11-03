"""
Campus Lost & Found — Lambda: Get Single Item
===============================================
Fetches one item by its itemId.

API: GET /items/{itemId}
"""

import json
import os
import boto3

TABLE_NAME = os.environ.get('ITEMS_TABLE', 'CampusLostFoundItems')
dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(TABLE_NAME)


def lambda_handler(event, context):
    try:
        # Get itemId from URL path: /items/{itemId}
        item_id = event.get('pathParameters', {}).get('itemId')

        if not item_id:
            return response_error(400, 'Missing itemId in path')

        # Fetch from DynamoDB
        response = table.get_item(Key={'itemId': item_id})
        item = response.get('Item')

        if not item:
            return response_error(404, 'Item not found')

        return response_200(item)

    except Exception as e:
        print(f"[ERROR] get_item: {str(e)}")
        return response_error(500, 'Failed to fetch item')


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
