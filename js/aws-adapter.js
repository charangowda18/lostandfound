/* ===================================================================
   Campus Lost & Found — AWS Data Adapter
   
   This adapter replaces LocalAdapter when the app runs in AWS mode.
   It calls the real API Gateway endpoints which trigger Lambda functions.
   
   HOW IT WORKS (for beginners):
   - Instead of storing data in browser memory, this adapter sends
     HTTP requests to API Gateway URLs.
   - API Gateway forwards the request to the correct Lambda function.
   - Lambda reads/writes DynamoDB and returns the result.
   - This file NEVER contains AWS credentials — all auth is done
     through Cognito JWT tokens sent in the Authorization header.
   =================================================================== */

const AwsAdapter = {
    name: 'AwsAdapter',
    _apiBase: '',

    init() {
        this._apiBase = AppConfig.aws.apiBaseUrl.replace(/\/$/, ''); // remove trailing slash
        if (!this._apiBase) {
            throw new Error('AWS API base URL is not configured. Check js/env.js');
        }
        console.log(`[AwsAdapter] API base: ${this._apiBase}`);
        return Promise.resolve();
    },

    /**
     * Make an authenticated API request.
     * Adds the Cognito JWT token if the user is logged in.
     */
    async _fetch(path, options = {}) {
        const url = `${this._apiBase}${path}`;
        const headers = {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
        };

        // Add auth token if available (for organiser-protected endpoints)
        if (Auth.isLoggedIn()) {
            const token = Auth.getToken();
            if (token) {
                headers['Authorization'] = token;
            }
        }

        const response = await fetch(url, { ...options, headers });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            throw new Error(errorBody.error || `API error: ${response.status}`);
        }

        return response.json();
    },

    /** Get all items with optional filters */
    async getItems(filters = {}) {
        const params = new URLSearchParams();
        if (filters.search) params.set('search', filters.search);
        if (filters.category) params.set('category', filters.category);
        if (filters.reportType) params.set('reportType', filters.reportType);
        if (filters.collectionStatus) params.set('collectionStatus', filters.collectionStatus);

        const query = params.toString();
        const path = '/items' + (query ? `?${query}` : '');
        return this._fetch(path);
    },

    /** Get a single item by ID */
    async getItem(itemId) {
        return this._fetch(`/items/${encodeURIComponent(itemId)}`);
    },

    /** Create a new item */
    async createItem(itemData) {
        return this._fetch('/items', {
            method: 'POST',
            body: JSON.stringify(itemData),
        });
    },

    /**
     * Upload an image to S3 via pre-signed POST.
     * Step 1: Ask our API for a pre-signed POST URL + form fields.
     * Step 2: Build a FormData with the signed fields + the file.
     * Step 3: POST the FormData directly to S3.
     *
     * WHY pre-signed POST instead of PUT?
     * Pre-signed POST supports 'content-length-range' conditions,
     * which lets the server enforce a 5 MB limit. Pre-signed PUT
     * cannot enforce file size — anyone could bypass the frontend
     * 5 MB check and upload an arbitrarily large file.
     */
    async uploadImage(file) {
        // Step 1: Get pre-signed POST data from our API
        const urlData = await this._fetch('/upload-url', {
            method: 'POST',
            body: JSON.stringify({
                fileName: file.name,
                contentType: file.type,
            }),
        });

        // Step 2: Build FormData with the signed fields + file
        // The order matters: all policy fields must come BEFORE 'file'
        const formData = new FormData();
        if (urlData.uploadFields) {
            for (const [key, value] of Object.entries(urlData.uploadFields)) {
                formData.append(key, value);
            }
        }
        formData.append('file', file);  // must be last

        // Step 3: POST to S3 (no Authorization header — the signed fields are the auth)
        const uploadResponse = await fetch(urlData.uploadUrl, {
            method: 'POST',
            body: formData,
            // Do NOT set Content-Type — the browser sets it with the boundary
        });

        if (!uploadResponse.ok) {
            throw new Error('Failed to upload image to S3. The file may exceed the 5 MB limit.');
        }

        return {
            imageKey: urlData.imageKey,
            imageUrl: null, // URL will be fetched via getImageUrl
        };
    },

    /** Get a viewable image URL (pre-signed download URL) */
    async getImageUrl(imageKey) {
        if (!imageKey) return null;
        const data = await this._fetch(`/images/${encodeURIComponent(imageKey)}`);
        return data.imageUrl;
    },

    /** Confirm collection (organiser-only) */
    async confirmCollection(itemId, claimantName, organiser) {
        // Note: organiser info is derived from JWT on the backend.
        // We only send claimantName in the request body.
        const result = await this._fetch(`/items/${encodeURIComponent(itemId)}/collect`, {
            method: 'POST',
            body: JSON.stringify({ claimantName }),
        });
        return result;
    },

    /** Get collection history */
    async getCollectionHistory() {
        return this._fetch('/collection-history');
    },

    /** Get summary stats (calculated from items) */
    async getStats() {
        const items = await this.getItems();
        return {
            total: items.length,
            lost: items.filter(i => i.reportType === 'LOST').length,
            found: items.filter(i => i.reportType === 'FOUND').length,
            collected: items.filter(i => i.collectionStatus === 'COLLECTED').length,
        };
    },
};
