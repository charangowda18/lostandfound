"""
Campus Lost & Found — Lambda Unit Tests
=========================================
Tests all Lambda functions locally with mocked AWS services.
No real AWS credentials or deployed resources needed.

Run with:  python -m pytest tests/test_lambdas.py -v
"""

import json
import sys
import os
import importlib
import types
from unittest.mock import MagicMock, patch
from datetime import datetime, timezone

import pytest

# ---------------------------------------------------------------------------
# Helper: load a lambda module from disk without importing boto3
# ---------------------------------------------------------------------------

def load_lambda(function_dir, module_name='lambda_function'):
    """
    Load a Lambda function module with boto3/botocore mocked out so tests
    work without real AWS credentials.
    """
    lambda_dir = os.path.join(
        os.path.dirname(__file__), '..', 'lambda', function_dir
    )
    lambda_dir = os.path.abspath(lambda_dir)
    path = os.path.join(lambda_dir, f'{module_name}.py')

    # Create stub modules for boto3 and botocore if not importable
    for mod_name in ('boto3', 'botocore', 'botocore.exceptions'):
        if mod_name not in sys.modules:
            sys.modules[mod_name] = types.ModuleType(mod_name)

    # Define ClientError for botocore.exceptions
    class ClientError(Exception):
        def __init__(self, error_response=None, operation_name=''):
            self.response = error_response or {'Error': {'Code': 'TestError', 'Message': 'test'}}
            super().__init__(str(self.response))

    sys.modules['botocore.exceptions'].ClientError = ClientError

    # Mock boto3.resource and boto3.client
    mock_resource = MagicMock()
    mock_client = MagicMock()
    sys.modules['boto3'].resource = MagicMock(return_value=mock_resource)
    sys.modules['boto3'].client = MagicMock(return_value=mock_client)

    # Provide Attr for get_items (boto3.dynamodb.conditions)
    conditions_mod = types.ModuleType('boto3.dynamodb.conditions')
    class MockAttr:
        def __init__(self, name):
            self._name = name
        def eq(self, val):
            return self
        def __and__(self, other):
            return self
    conditions_mod.Attr = MockAttr
    sys.modules['boto3.dynamodb'] = types.ModuleType('boto3.dynamodb')
    sys.modules['boto3.dynamodb.conditions'] = conditions_mod

    # Load the module
    spec = importlib.util.spec_from_file_location(
        f'lambda_{function_dir}', path
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    return mod, mock_resource, mock_client, ClientError


# ===========================================================================
# TEST: confirm_collection
# ===========================================================================

class TestConfirmCollection:
    """Tests for lambda/confirm_collection/lambda_function.py"""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.mod, self.mock_resource, self.mock_client, self.ClientError = load_lambda('confirm_collection')
        self.items_table = MagicMock()
        self.history_table = MagicMock()
        self.dynamodb_client = MagicMock()
        self.mod.items_table = self.items_table
        self.mod.history_table = self.history_table
        self.mod.dynamodb_client = self.dynamodb_client

    def _make_event(self, item_id='ITEM-001', claimant='John Doe',
                    sub='org-sub-123', name='Dr. Admin', email='admin@campus.edu',
                    groups=['Organisers']):
        claims = {
            'sub': sub,
            'name': name,
            'email': email,
        }
        if groups is not None:
            claims['cognito:groups'] = groups

        return {
            'pathParameters': {'itemId': item_id},
            'body': json.dumps({'claimantName': claimant}),
            'requestContext': {
                'authorizer': {
                    'claims': claims
                }
            }
        }

    def test_collect_found_item_succeeds(self):
        """Authorised organiser confirming FOUND + PENDING item succeeds atomically."""
        self.items_table.get_item.return_value = {
            'Item': {
                'itemId': 'ITEM-001',
                'itemName': 'Charger',
                'category': 'Electronics',
                'reportType': 'FOUND',
                'collectionStatus': 'PENDING',
            }
        }
        self.dynamodb_client.transact_write_items.return_value = {}

        result = self.mod.lambda_handler(self._make_event(), None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 200
        assert body['item']['collectionStatus'] == 'COLLECTED'
        assert body['item']['claimantName'] == 'John Doe'
        assert body['item']['organiserName'] == 'Dr. Admin'
        assert body['item']['organiserId'] == 'org-sub-123'
        assert body['historyRecord']['status'] == 'COLLECTED'
        assert body['historyRecord']['isDemo'] is False
        self.dynamodb_client.transact_write_items.assert_called_once()

    def test_ordinary_student_rejected_403(self):
        """Ordinary student with valid token but not in Organisers group is rejected with 403."""
        event = self._make_event(groups=['Students'])
        result = self.mod.lambda_handler(event, None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 403
        assert 'Forbidden' in body['error']
        assert 'Organisers' in body['error']
        self.dynamodb_client.transact_write_items.assert_not_called()

    def test_user_without_groups_rejected_403(self):
        """Authenticated user without cognito:groups claim is rejected with 403."""
        event = self._make_event(groups=None)
        result = self.mod.lambda_handler(event, None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 403
        assert 'Forbidden' in body['error']
        self.dynamodb_client.transact_write_items.assert_not_called()

    def test_reject_no_auth_token_403(self):
        """Request without Cognito claims / missing token must be rejected with 403."""
        event = {
            'pathParameters': {'itemId': 'ITEM-001'},
            'body': json.dumps({'claimantName': 'John'}),
            'requestContext': {'authorizer': {'claims': {}}},
        }

        result = self.mod.lambda_handler(event, None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 403
        assert 'Authentication required' in body['error']
        self.dynamodb_client.transact_write_items.assert_not_called()

    def test_reject_lost_item_collection(self):
        """LOST items must NOT be collectable — server-side enforcement."""
        self.items_table.get_item.return_value = {
            'Item': {
                'itemId': 'ITEM-002',
                'itemName': 'Wallet',
                'reportType': 'LOST',
                'collectionStatus': 'PENDING',
            }
        }

        result = self.mod.lambda_handler(self._make_event(item_id='ITEM-002'), None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 400
        assert 'Only found items' in body['error']
        self.dynamodb_client.transact_write_items.assert_not_called()

    def test_reject_already_collected_item_early_409(self):
        """Item already marked COLLECTED in DB returns 409 immediately."""
        self.items_table.get_item.return_value = {
            'Item': {
                'itemId': 'ITEM-003',
                'reportType': 'FOUND',
                'collectionStatus': 'COLLECTED',
                'itemName': 'Keys',
                'category': 'Keys',
            }
        }

        result = self.mod.lambda_handler(self._make_event(item_id='ITEM-003'), None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 409
        assert 'already been collected' in body['error']
        self.dynamodb_client.transact_write_items.assert_not_called()

    def test_reject_duplicate_collection_transaction_canceled(self):
        """Race condition / concurrent write rejected by DynamoDB transaction condition."""
        self.items_table.get_item.return_value = {
            'Item': {
                'itemId': 'ITEM-003',
                'reportType': 'FOUND',
                'collectionStatus': 'PENDING',
                'itemName': 'Keys',
                'category': 'Keys',
            }
        }
        self.dynamodb_client.transact_write_items.side_effect = self.ClientError(
            {'Error': {'Code': 'TransactionCanceledException', 'Message': 'Transaction cancelled'}},
            'TransactWriteItems'
        )

        result = self.mod.lambda_handler(self._make_event(item_id='ITEM-003'), None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 409
        assert 'already been collected' in body['error']

    def test_reject_missing_claimant(self):
        """Empty claimant name must be rejected."""
        event = self._make_event()
        event['body'] = json.dumps({'claimantName': ''})

        result = self.mod.lambda_handler(event, None)
        assert result['statusCode'] == 400
        assert 'claimantName is required' in json.loads(result['body'])['error']

    def test_reject_nonexistent_item(self):
        """Item not in DB must return 404."""
        self.items_table.get_item.return_value = {'Item': None}

        result = self.mod.lambda_handler(self._make_event(item_id='NOPE'), None)
        assert result['statusCode'] == 404

    def test_organiser_identity_from_jwt_not_body(self):
        """Organiser name/id must come from JWT claims, never from the request body."""
        self.items_table.get_item.return_value = {
            'Item': {
                'itemId': 'ITEM-004',
                'itemName': 'Book',
                'category': 'Books & Stationery',
                'reportType': 'FOUND',
                'collectionStatus': 'PENDING',
            }
        }
        self.dynamodb_client.transact_write_items.return_value = {}

        # Body attempts to spoof a different organiser identity
        event = self._make_event(
            item_id='ITEM-004',
            sub='real-sub-from-jwt',
            name='Real Organiser',
            groups=['Organisers']
        )
        body_data = json.loads(event['body'])
        body_data['organiserName'] = 'FAKE ATTACKER'
        body_data['organiserId'] = 'FAKE-ATTACKER-ID'
        event['body'] = json.dumps(body_data)

        result = self.mod.lambda_handler(event, None)
        result_body = json.loads(result['body'])

        assert result['statusCode'] == 200
        assert result_body['item']['organiserName'] == 'Real Organiser'
        assert result_body['item']['organiserId'] == 'real-sub-from-jwt'

    def test_error_does_not_leak_internals(self):
        """500 error messages must not expose internal stack traces."""
        self.items_table.get_item.side_effect = Exception('boto3 internal error with stack trace')

        result = self.mod.lambda_handler(self._make_event(), None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 500
        assert 'boto3' not in body['error']
        assert 'stack trace' not in body['error']
        assert body['error'] == 'Failed to confirm collection'

        assert result['statusCode'] == 500
        assert 'boto3' not in body['error']
        assert 'stack trace' not in body['error']
        assert body['error'] == 'Failed to confirm collection'


# ===========================================================================
# TEST: get_collection_history (privacy / redaction)
# ===========================================================================

class TestGetCollectionHistory:
    """Tests for lambda/get_collection_history/lambda_function.py"""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.mod, self.mock_resource, _, _ = load_lambda('get_collection_history')
        self.table = MagicMock()
        self.mod.table = self.table

    def _sample_records(self):
        return [
            {
                'recordId': 'COL-001',
                'itemId': 'ITEM-001',
                'itemName': 'Charger',
                'category': 'Electronics',
                'claimantName': 'Rahul Sharma',
                'organiserName': 'Dr. Admin',
                'organiserId': 'org-sub-123',
                'organiserEmail': 'admin@campus.edu',
                'collectionTimestamp': '2026-10-29T11:00:00Z',
                'status': 'COLLECTED',
                'isDemo': False,
            }
        ]

    def test_authenticated_sees_full_data(self):
        """Authenticated organiser sees claimant names and organiser IDs."""
        self.table.scan.return_value = {'Items': self._sample_records()}

        event = {
            'requestContext': {
                'authorizer': {
                    'claims': {'sub': 'org-sub-123', 'name': 'Dr. Admin'}
                }
            }
        }
        result = self.mod.lambda_handler(event, None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 200
        assert body[0]['claimantName'] == 'Rahul Sharma'
        assert body[0]['organiserId'] == 'org-sub-123'
        assert 'redacted' not in body[0]

    def test_unauthenticated_sees_redacted_data(self):
        """Unauthenticated user sees redacted claimant names."""
        self.table.scan.return_value = {'Items': self._sample_records()}

        event = {'requestContext': {}}  # no authorizer claims
        result = self.mod.lambda_handler(event, None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 200
        assert body[0]['claimantName'] == '(Redacted)'
        assert body[0]['organiserId'] == '(Redacted)'
        assert 'organiserEmail' not in body[0]
        assert body[0]['redacted'] is True
        # Item name and collection timestamp are still visible
        assert body[0]['itemName'] == 'Charger'
        assert body[0]['collectionTimestamp'] == '2026-10-29T11:00:00Z'

    def test_error_does_not_leak_internals(self):
        """500 error must not expose internal details."""
        self.table.scan.side_effect = Exception('DynamoDB internal timeout')

        event = {'requestContext': {}}
        result = self.mod.lambda_handler(event, None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 500
        assert 'DynamoDB' not in body['error']


# ===========================================================================
# TEST: get_image_url (error handling)
# ===========================================================================

class TestGetImageUrl:
    """Tests for lambda/get_image_url/lambda_function.py"""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.mod, _, self.mock_client, self.ClientError = load_lambda('get_image_url')
        self.mod.s3_client = self.mock_client

    def test_existing_image_returns_url(self):
        """Valid imageKey should return a pre-signed URL."""
        self.mock_client.head_object.return_value = {}
        self.mock_client.generate_presigned_url.return_value = 'https://s3.example.com/signed-url'

        event = {'pathParameters': {'imageKey': 'items/abc123.jpg'}}
        result = self.mod.lambda_handler(event, None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 200
        assert body['imageUrl'] == 'https://s3.example.com/signed-url'

    def test_missing_image_returns_404(self):
        """Non-existent imageKey should return 404, not crash."""
        self.mock_client.head_object.side_effect = self.ClientError(
            {'Error': {'Code': '404', 'Message': 'Not Found'}}, 'HeadObject'
        )

        event = {'pathParameters': {'imageKey': 'items/nonexistent.jpg'}}
        result = self.mod.lambda_handler(event, None)

        assert result['statusCode'] == 404
        assert 'not found' in json.loads(result['body'])['error'].lower()

    def test_missing_key_returns_400(self):
        """Missing imageKey parameter should return 400."""
        event = {'pathParameters': {}}
        result = self.mod.lambda_handler(event, None)
        assert result['statusCode'] == 400

    def test_error_does_not_leak_internals(self):
        """Server error must not expose S3 bucket name or stack trace."""
        self.mock_client.head_object.side_effect = Exception('internal s3 bucket name leaked')

        event = {'pathParameters': {'imageKey': 'items/test.jpg'}}
        result = self.mod.lambda_handler(event, None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 500
        assert 'bucket' not in body['error'].lower()
        assert body['error'] == 'Failed to generate image URL'


# ===========================================================================
# TEST: get_upload_url (size enforcement)
# ===========================================================================

class TestGetUploadUrl:
    """Tests for lambda/get_upload_url/lambda_function.py"""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.mod, _, self.mock_client, _ = load_lambda('get_upload_url')
        self.mod.s3_client = self.mock_client

    def test_valid_upload_request(self):
        """Valid request returns pre-signed POST with fields and size limit."""
        self.mock_client.generate_presigned_post.return_value = {
            'url': 'https://s3.example.com/bucket',
            'fields': {'key': 'items/abc.jpg', 'policy': 'encoded'},
        }

        event = {'body': json.dumps({'fileName': 'photo.jpg', 'contentType': 'image/jpeg'})}
        result = self.mod.lambda_handler(event, None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 200
        assert 'uploadUrl' in body
        assert 'uploadFields' in body
        assert 'imageKey' in body
        assert body['maxSizeBytes'] == 5 * 1024 * 1024

    def test_reject_invalid_mime_type(self):
        """Non-image MIME types must be rejected."""
        event = {'body': json.dumps({'fileName': 'malware.exe', 'contentType': 'application/x-exe'})}
        result = self.mod.lambda_handler(event, None)

        assert result['statusCode'] == 400
        assert 'Invalid file type' in json.loads(result['body'])['error']

    def test_reject_html_mime(self):
        """HTML content type must be rejected (XSS prevention)."""
        event = {'body': json.dumps({'fileName': 'page.html', 'contentType': 'text/html'})}
        result = self.mod.lambda_handler(event, None)
        assert result['statusCode'] == 400

    def test_safe_extension_from_whitelist(self):
        """Extension must come from MIME whitelist, not from client filename."""
        self.mock_client.generate_presigned_post.return_value = {
            'url': 'https://s3.example.com/bucket',
            'fields': {},
        }

        # Client sends a .exe filename but with image/png content type
        event = {'body': json.dumps({'fileName': 'evil.exe', 'contentType': 'image/png'})}
        result = self.mod.lambda_handler(event, None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 200
        # The image key should use .png, not .exe
        assert body['imageKey'].endswith('.png')


# ===========================================================================
# TEST: create_item
# ===========================================================================

class TestCreateItem:
    """Tests for lambda/create_item/lambda_function.py"""

    @pytest.fixture(autouse=True)
    def setup(self):
        self.mod, self.mock_resource, _, _ = load_lambda('create_item')
        self.table = MagicMock()
        self.mod.table = self.table

    def test_create_found_item(self):
        """Valid FOUND item should be created with PENDING status."""
        event = {
            'body': json.dumps({
                'itemName': 'Laptop Charger',
                'description': 'White USB-C charger',
                'category': 'Electronics',
                'reportType': 'FOUND',
                'location': 'Library',
                'reportDate': '2026-10-30',
            })
        }
        result = self.mod.lambda_handler(event, None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 201
        assert body['itemName'] == 'Laptop Charger'
        assert body['reportType'] == 'FOUND'
        assert body['collectionStatus'] == 'PENDING'
        assert body['isDemo'] is False
        self.table.put_item.assert_called_once()

    def test_create_lost_item(self):
        """Valid LOST item should be created."""
        event = {
            'body': json.dumps({
                'itemName': 'Water Bottle',
                'description': 'Blue Milton bottle',
                'category': 'Other',
                'reportType': 'LOST',
                'location': 'Canteen',
                'reportDate': '2026-10-30',
            })
        }
        result = self.mod.lambda_handler(event, None)
        assert result['statusCode'] == 201
        assert json.loads(result['body'])['reportType'] == 'LOST'

    def test_reject_missing_fields(self):
        """Missing required fields return 400."""
        event = {'body': json.dumps({'itemName': 'Test'})}
        result = self.mod.lambda_handler(event, None)
        assert result['statusCode'] == 400
        assert 'description is required' in json.loads(result['body'])['error']

    def test_reject_invalid_category(self):
        """Invalid category must be rejected."""
        event = {
            'body': json.dumps({
                'itemName': 'Test', 'description': 'test', 'category': 'INVALID',
                'reportType': 'FOUND', 'location': 'Here', 'reportDate': '2026-01-01',
            })
        }
        result = self.mod.lambda_handler(event, None)
        assert result['statusCode'] == 400
        assert 'Invalid category' in json.loads(result['body'])['error']

    def test_html_sanitisation(self):
        """HTML tags in input must be stripped."""
        event = {
            'body': json.dumps({
                'itemName': '<script>alert("xss")</script>Charger',
                'description': '<b>Bold</b> description',
                'category': 'Electronics',
                'reportType': 'FOUND',
                'location': '<img src=x>Library',
                'reportDate': '2026-10-30',
            })
        }
        result = self.mod.lambda_handler(event, None)
        body = json.loads(result['body'])

        assert result['statusCode'] == 201
        assert '<script>' not in body['itemName']
        assert '<b>' not in body['description']
        assert '<img' not in body['location']
        assert 'alert' in body['itemName']  # text content preserved


if __name__ == '__main__':
    pytest.main([__file__, '-v'])

