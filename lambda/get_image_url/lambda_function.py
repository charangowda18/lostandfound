"""
Campus Lost & Found — Lambda: Get Image URL
============================================
Generates a pre-signed S3 URL for viewing/downloading an item photo.

API: GET /images/{imageKey}

SECURITY:
- The S3 bucket has Block Public Access enabled.
- Photos are accessed only via short-lived pre-signed URLs.
- The URL expires in 15 minutes.
"""

import json
import os
import urllib.parse

import boto3
from botocore.exceptions import ClientError

S3_BUCKET = os.environ.get('IMAGES_BUCKET', 'campus-lost-found-images')
URL_EXPIRY_SECONDS = 900  # 15 minutes

s3_client = boto3.client('s3')


def lambda_handler(event, context):
    try:
        # imageKey comes as a path parameter, URL-encoded
        raw_key = event.get('pathParameters', {}).get('imageKey', '')
        # Also check proxy parameter (for items/{imageKey+})
        if not raw_key:
            raw_key = event.get('pathParameters', {}).get('proxy', '')

        image_key = urllib.parse.unquote(raw_key)

        if not image_key:
            return response_error(400, 'Missing imageKey')

        # Check if object exists
        try:
            s3_client.head_object(Bucket=S3_BUCKET, Key=image_key)
        except ClientError:
            return response_error(404, 'Image not found')

        # Generate pre-signed download URL
        presigned_url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': S3_BUCKET,
                'Key': image_key,
            },
            ExpiresIn=URL_EXPIRY_SECONDS,
        )

        return response_200({
            'imageUrl': presigned_url,
            'expiresIn': URL_EXPIRY_SECONDS,
        })

    except Exception as e:
        print(f"[ERROR] get_image_url: {str(e)}")
        return response_error(500, 'Failed to generate image URL')


def response_200(body):
    return {
        'statusCode': 200,
        'headers': cors_headers(),
        'body': json.dumps(body)
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
