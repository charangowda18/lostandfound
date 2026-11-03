/* ===================================================================
   Campus Lost & Found — Data Adapter Layer
   
   WHY THIS EXISTS (for beginners):
   - This file defines a "contract" (interface) for all data operations.
   - In LOCAL mode, it uses an in-memory adapter (fake data).
   - In AWS mode, it calls real API endpoints.
   - The rest of the app calls DataAdapter.getItems(), etc. — it doesn't
     care whether the data comes from memory or AWS.
   - This makes it easy to swap from demo to production later.
   =================================================================== */

/**
 * The DataAdapter object routes calls to the active adapter
 * (LocalAdapter or AwsAdapter) depending on AppConfig.mode.
 */
const DataAdapter = {
    _adapter: null,

    /** Initialise the correct adapter */
    init() {
        if (AppConfig.mode === 'AWS') {
            // AwsAdapter will be implemented in Phase 3
            if (typeof AwsAdapter !== 'undefined') {
                this._adapter = AwsAdapter;
            } else {
                console.error('[DataAdapter] AWS mode selected but AwsAdapter not loaded. Falling back to LOCAL.');
                this._adapter = LocalAdapter;
            }
        } else {
            this._adapter = LocalAdapter;
        }
        console.log(`[DataAdapter] Using ${this._adapter.name} adapter`);
        return this._adapter.init ? this._adapter.init() : Promise.resolve();
    },

    /** Get all items, optionally filtered */
    async getItems(filters = {}) {
        return this._adapter.getItems(filters);
    },

    /** Get a single item by ID */
    async getItem(itemId) {
        return this._adapter.getItem(itemId);
    },

    /** Create a new item (lost or found report) */
    async createItem(itemData) {
        return this._adapter.createItem(itemData);
    },

    /** Upload an image and return a key/URL */
    async uploadImage(file) {
        return this._adapter.uploadImage(file);
    },

    /** Get a viewable image URL from an imageKey */
    async getImageUrl(imageKey) {
        return this._adapter.getImageUrl(imageKey);
    },

    /**
     * Confirm collection of an item (organiser-only).
     * @param {string} itemId
     * @param {string} claimantName
     * @param {object} organiser  — { name, id } derived from auth, NOT user input
     */
    async confirmCollection(itemId, claimantName, organiser) {
        return this._adapter.confirmCollection(itemId, claimantName, organiser);
    },

    /** Get collection history records */
    async getCollectionHistory() {
        return this._adapter.getCollectionHistory();
    },

    /** Get summary stats */
    async getStats() {
        return this._adapter.getStats();
    },
};


/* ===================================================================
   LOCAL ADAPTER — In-Memory Demo Implementation
   All data lives in browser memory and resets on page refresh.
   =================================================================== */
const LocalAdapter = {
    name: 'LocalAdapter',
    _items: [],
    _collectionHistory: [],

    init() {
        // Load demo data (defined in demo-data.js)
        if (typeof DEMO_ITEMS !== 'undefined') {
            this._items = JSON.parse(JSON.stringify(DEMO_ITEMS));
        }
        if (typeof DEMO_COLLECTION_HISTORY !== 'undefined') {
            this._collectionHistory = JSON.parse(JSON.stringify(DEMO_COLLECTION_HISTORY));
        }
        console.log(`[LocalAdapter] Loaded ${this._items.length} demo items`);
        return Promise.resolve();
    },

    async getItems(filters = {}) {
        let result = [...this._items];

        // Search by name
        if (filters.search) {
            const q = filters.search.toLowerCase();
            result = result.filter(i => i.itemName.toLowerCase().includes(q));
        }
        // Filter by category
        if (filters.category) {
            result = result.filter(i => i.category === filters.category);
        }
        // Filter by report type (LOST / FOUND)
        if (filters.reportType) {
            result = result.filter(i => i.reportType === filters.reportType);
        }
        // Filter by collection status
        if (filters.collectionStatus) {
            result = result.filter(i => i.collectionStatus === filters.collectionStatus);
        }

        // Sort: newest first
        result.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        // Simulate a tiny network delay so loading states are visible
        await this._delay(300);
        return result;
    },

    async getItem(itemId) {
        await this._delay(100);
        const item = this._items.find(i => i.itemId === itemId);
        if (!item) throw new Error('Item not found');
        return { ...item };
    },

    async createItem(itemData) {
        const now = new Date().toISOString();
        const newItem = {
            itemId: 'ITEM-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4).toUpperCase(),
            itemName: itemData.itemName.trim(),
            description: itemData.description.trim(),
            category: itemData.category,
            reportType: itemData.reportType,
            location: itemData.location.trim(),
            reportDate: itemData.reportDate,
            imageKey: itemData.imageKey || null,
            imageUrl: itemData.imageUrl || null,  // local mode stores data URL
            status: 'ACTIVE',
            collectionStatus: 'PENDING',
            claimantName: null,
            organiserName: null,
            organiserId: null,
            collectionTimestamp: null,
            createdAt: now,
            updatedAt: now,
            isDemo: false,  // user-created items are not demo data
        };
        this._items.unshift(newItem);
        await this._delay(400);
        return newItem;
    },

    async uploadImage(file) {
        // In local mode, convert to data URL (stays in browser memory)
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const key = 'local-' + Date.now() + '-' + file.name;
                resolve({ imageKey: key, imageUrl: reader.result });
            };
            reader.onerror = () => reject(new Error('Failed to read image'));
            reader.readAsDataURL(file);
        });
    },

    async getImageUrl(imageKey) {
        // In local mode, the imageUrl is stored directly on the item
        // (it's a data URL), so we find the item and return it.
        const item = this._items.find(i => i.imageKey === imageKey);
        return item ? item.imageUrl : null;
    },

    async confirmCollection(itemId, claimantName, organiser) {
        await this._delay(500);

        const item = this._items.find(i => i.itemId === itemId);
        if (!item) throw new Error('Item not found');

        // Only FOUND items can be collected
        // (Lost items have not been physically located yet)
        if (item.reportType !== 'FOUND') {
            throw new Error('Only found items can be collected. Lost items must first be reported as found.');
        }

        // Prevent duplicate collection (mirrors DynamoDB conditional write)
        if (item.collectionStatus === 'COLLECTED') {
            throw new Error('This item has already been collected. Duplicate collection is not allowed.');
        }

        const now = new Date().toISOString();

        // Update item
        item.collectionStatus = 'COLLECTED';
        item.claimantName = claimantName.trim();
        item.organiserName = organiser.name;
        item.organiserId = organiser.id;
        item.collectionTimestamp = now;
        item.updatedAt = now;

        // Create append-only audit record
        const historyRecord = {
            recordId: 'COL-' + Date.now(),
            itemId: item.itemId,
            itemName: item.itemName,
            category: item.category,
            claimantName: item.claimantName,
            organiserName: item.organiserName,
            organiserId: item.organiserId,
            collectionTimestamp: now,
            status: 'COLLECTED',
            isDemo: false,
        };
        this._collectionHistory.unshift(historyRecord);

        return { item: { ...item }, historyRecord };
    },

    async getCollectionHistory() {
        await this._delay(200);
        return [...this._collectionHistory];
    },

    async getStats() {
        const items = this._items;
        return {
            total: items.length,
            lost: items.filter(i => i.reportType === 'LOST').length,
            found: items.filter(i => i.reportType === 'FOUND').length,
            collected: items.filter(i => i.collectionStatus === 'COLLECTED').length,
        };
    },

    /** Simulate network latency */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};
