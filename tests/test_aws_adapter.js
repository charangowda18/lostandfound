// Unit test for AwsAdapter photo resolution, caching, and API routing
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

// Mock dependencies
global.AppConfig = {
    aws: {
        apiBaseUrl: 'https://test.execute-api.ap-southeast-2.amazonaws.com/prod',
        region: 'ap-southeast-2',
    }
};

let mockLoggedIn = false;
let mockAccessToken = null;

global.Auth = {
    isLoggedIn: () => mockLoggedIn,
    getAccessToken: () => mockAccessToken,
    getToken: () => mockAccessToken,
};

// Track API calls
let fetchCalls = [];
global.fetch = async (url, options = {}) => {
    fetchCalls.push({ url, options });

    // Collection confirmation: POST /items/ITEM-101
    if (options.method === 'POST' && url.endsWith('/items/ITEM-101')) {
        return {
            ok: true,
            json: async () => ({
                message: 'Collection confirmed successfully',
                itemId: 'ITEM-101',
                status: 'COLLECTED',
            })
        };
    }

    // Create item: POST /items
    if (options.method === 'POST' && url.endsWith('/items')) {
        const body = JSON.parse(options.body || '{}');
        return {
            ok: true,
            json: async () => ({
                itemId: 'ITEM-999',
                itemName: body.itemName,
                imageKey: body.imageKey || null,
                reportType: body.reportType,
            })
        };
    }

    // Presigned upload URL: POST /upload-url
    if (options.method === 'POST' && url.endsWith('/upload-url')) {
        return {
            ok: true,
            json: async () => ({
                uploadUrl: 'https://campus-lost-found-photos-2026.s3.ap-southeast-2.amazonaws.com/',
                uploadFields: {
                    key: 'items/test-uuid.jpg',
                    'Content-Type': 'image/jpeg',
                },
                imageKey: 'items/test-uuid.jpg',
            })
        };
    }

    // Direct S3 Upload POST
    if (options.method === 'POST' && url.includes('s3.ap-southeast-2.amazonaws.com')) {
        return {
            ok: true,
            status: 204,
            text: async () => '',
        };
    }

    // Get item: GET /items/ITEM-101
    if (url.includes('/items/ITEM-101')) {
        return {
            ok: true,
            json: async () => ({
                itemId: 'ITEM-101',
                itemName: 'Water Bottle',
                imageKey: 'items/bottle.jpg',
                imageUrl: null,
            })
        };
    }

    // Collection history: GET /collection-history
    if (url.endsWith('/collection-history')) {
        return {
            ok: true,
            json: async () => ([
                { itemId: 'ITEM-101', claimantName: 'Jane Doe', status: 'COLLECTED' }
            ])
        };
    }

    // List items: GET /items
    if (url.endsWith('/items') || url.includes('/items?')) {
        return {
            ok: true,
            json: async () => ([
                { itemId: 'ITEM-1', itemName: 'Bottle', imageKey: 'items/bottle.jpg', reportType: 'FOUND', collectionStatus: 'PENDING' },
                { itemId: 'ITEM-2', itemName: 'Book', imageKey: null, reportType: 'LOST', collectionStatus: 'PENDING' },
                { itemId: 'ITEM-3', itemName: 'Keys', imageKey: 'items/missing.jpg', reportType: 'FOUND', collectionStatus: 'COLLECTED' }
            ])
        };
    }

    // Images lookup: GET /images/...
    if (url.includes('/images/items%2Fbottle.jpg')) {
        return {
            ok: true,
            json: async () => ({
                imageUrl: 'https://s3.ap-southeast-2.amazonaws.com/bucket/items/bottle.jpg?signed=true',
                expiresIn: 900
            })
        };
    }

    if (url.includes('/images/items%2Fmissing.jpg')) {
        return {
            ok: false,
            status: 404,
            json: async () => ({ error: 'Image not found' })
        };
    }

    return {
        ok: true,
        json: async () => ({})
    };
};

// Load aws-adapter.js into global scope
const code = fs.readFileSync('js/aws-adapter.js', 'utf8');
vm.runInThisContext(code);

async function runTests() {
    console.log('Running AwsAdapter tests...');
    await AwsAdapter.init();

    // Test 1: Single item image resolution
    fetchCalls = [];
    const item = await AwsAdapter.getItem('ITEM-101');
    assert.strictEqual(item.itemId, 'ITEM-101');
    assert.strictEqual(item.imageUrl, 'https://s3.ap-southeast-2.amazonaws.com/bucket/items/bottle.jpg?signed=true');
    console.log('✓ getItem resolves pre-signed imageUrl from imageKey');

    // Test 2: In-memory caching avoids duplicate API calls
    fetchCalls = [];
    const cachedUrl = await AwsAdapter.getImageUrl('items/bottle.jpg');
    assert.strictEqual(cachedUrl, 'https://s3.ap-southeast-2.amazonaws.com/bucket/items/bottle.jpg?signed=true');
    assert.strictEqual(fetchCalls.length, 0, 'Should not make HTTP request for cached image');
    console.log('✓ In-memory cache returns URL without extra network request');

    // Test 3: List items resolves images and handles missing/null keys gracefully
    fetchCalls = [];
    const items = await AwsAdapter.getItems({});
    assert.strictEqual(items.length, 3);
    assert.strictEqual(items[0].imageUrl, 'https://s3.ap-southeast-2.amazonaws.com/bucket/items/bottle.jpg?signed=true');
    assert.strictEqual(items[1].imageUrl, null, 'Null imageKey should have null imageUrl');
    assert.strictEqual(items[2].imageUrl, null, 'Failed imageKey lookup should gracefully fall back to null');
    console.log('✓ getItems resolves images and handles missing/null keys gracefully');

    // Test 4: Confirm collection sends Authorization header with Cognito Access Token to POST /items/{itemId}
    fetchCalls = [];
    mockLoggedIn = true;
    mockAccessToken = 'cognito-access-token-xyz-123';
    const confirmRes = await AwsAdapter.confirmCollection('ITEM-101', 'Jane Doe');
    assert.strictEqual(confirmRes.status, 'COLLECTED');
    assert.strictEqual(fetchCalls.length, 1);
    assert.strictEqual(fetchCalls[0].url, 'https://test.execute-api.ap-southeast-2.amazonaws.com/prod/items/ITEM-101');
    assert.strictEqual(fetchCalls[0].options.method, 'POST');
    assert.strictEqual(fetchCalls[0].options.headers['Authorization'], 'cognito-access-token-xyz-123');
    assert.deepStrictEqual(JSON.parse(fetchCalls[0].options.body), { claimantName: 'Jane Doe' });
    console.log('✓ confirmCollection calls POST /items/{itemId} with Authorization header containing Cognito Access Token');

    // Test 5: Create item sends POST /items
    fetchCalls = [];
    mockLoggedIn = false;
    mockAccessToken = null;
    const created = await AwsAdapter.createItem({ itemName: 'Calculator', reportType: 'LOST' });
    assert.strictEqual(created.itemId, 'ITEM-999');
    assert.strictEqual(created.itemName, 'Calculator');
    assert.strictEqual(fetchCalls[0].url, 'https://test.execute-api.ap-southeast-2.amazonaws.com/prod/items');
    assert.strictEqual(fetchCalls[0].options.method, 'POST');
    console.log('✓ createItem calls POST /items with item payload');

    // Test 6: Image upload via pre-signed POST flow
    fetchCalls = [];
    const fakeFile = { name: 'photo.jpg', type: 'image/jpeg' };
    const uploadRes = await AwsAdapter.uploadImage(fakeFile);
    assert.strictEqual(uploadRes.imageKey, 'items/test-uuid.jpg');
    assert.strictEqual(fetchCalls.length, 2);
    assert.strictEqual(fetchCalls[0].url, 'https://test.execute-api.ap-southeast-2.amazonaws.com/prod/upload-url');
    assert.strictEqual(fetchCalls[1].url, 'https://campus-lost-found-photos-2026.s3.ap-southeast-2.amazonaws.com/');
    console.log('✓ uploadImage requests presigned POST and uploads to S3');

    // Test 7: Get collection history
    fetchCalls = [];
    const history = await AwsAdapter.getCollectionHistory();
    assert.strictEqual(history.length, 1);
    assert.strictEqual(history[0].claimantName, 'Jane Doe');
    console.log('✓ getCollectionHistory calls GET /collection-history');

    // Test 8: Get stats
    fetchCalls = [];
    const stats = await AwsAdapter.getStats();
    assert.strictEqual(stats.total, 3);
    assert.strictEqual(stats.lost, 1);
    assert.strictEqual(stats.found, 2);
    assert.strictEqual(stats.collected, 1);
    console.log('✓ getStats aggregates item statistics');

    console.log('\nAll AwsAdapter tests passed successfully!');
}

runTests().catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
});
