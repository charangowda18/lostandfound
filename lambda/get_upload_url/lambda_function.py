"""
Campus Lost & Found — Lambda: Get Upload URL
=============================================
Generates a pre-signed S3 POST for uploading an item photo.

API: POST /upload-url
Body: { fileName, contentType }

SECURITY:
- Only allows image MIME types (jpeg, png, webp)
- Enforces 5 MB max file size via pre-signed POST conditions
- The S3 bucket has Block Public Access enabled
- The upload URL expires in 5 minutes
- The image key uses a UUID to prevent overwrites
- File extension is sanitised to prevent path traversal
"""

import json
import os
import re
import uuid

import boto3

S3_BUCKET = os.environ.get('IMAGES_BUCKET', 'campus-lost-found-images')
URL_EXPIRY_SECONDS = 300  # 5 minutes

ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp']
MAX_SIZE_BYTES = 5 * 1024 * 1024  # 5 MB

# Map MIME type to safe extension
MIME_TO_EXT = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
}

s3_client = boto3.client('s3')


def lambda_handler(event, context):
    try:
        body = json.loads(event.get('body', '{}'))

        file_name = body.get('fileName', 'photo.jpg')
        content_type = body.get('contentType', 'image/jpeg')

        # Validate content type
        if content_type not in ALLOWED_TYPES:
            return response_error(400, f'Invalid file type. Allowed: {", ".join(ALLOWED_TYPES)}')

        # Use a safe extension from the whitelist — never trust the client extension
        ext = MIME_TO_EXT.get(content_type, 'jpg')
        image_key = f"items/{uuid.uuid4().hex[:12]}.{ext}"

        # Generate pre-signed POST with size limit
        # This returns a URL + form fields that the browser submits as multipart/form-data
        presigned_post = s3_client.generate_presigned_post(
            Bucket=S3_BUCKET,
            Key=image_key,
            Fields={
                'Content-Type': content_type,
            },
            Conditions=[
                {'Content-Type': content_type},
                ['content-length-range', 1, MAX_SIZE_BYTES],  # 1 byte to 5 MB
            ],
            ExpiresIn=URL_EXPIRY_SECONDS,
        )

        return response_200({
            'uploadUrl': presigned_post['url'],
            'uploadFields': presigned_post['fields'],
            'imageKey': image_key,
            'maxSizeBytes': MAX_SIZE_BYTES,
            'expiresIn': URL_EXPIRY_SECONDS,
        })

    except json.JSONDecodeError:
        return response_error(400, 'Invalid JSON in request body')
    except Exception as e:
        print(f"[ERROR] get_upload_url: {str(e)}")
        return response_error(500, 'Failed to generate upload URL')


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
