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
    _imageCache: {},

    init() {
        this._apiBase = AppConfig.aws.apiBaseUrl.replace(/\/$/, ''); // remove trailing slash
        this._imageCache = {};
        if (!this._apiBase) {
            throw new Error('AWS API base URL is not configured. Check js/env.js');
        }
        console.log(`[AwsAdapter] API base: ${this._apiBase}`);
        return Promise.resolve();
    },

    /**
     * Helper to resolve an item's imageKey to a pre-signed imageUrl.
     * Uses in-memory cache to avoid redundant API calls.
     */
    async _resolveItemImageUrl(item) {
        if (!item) return item;
        if (item.imageKey && !item.imageUrl) {
            try {
                item.imageUrl = await this.getImageUrl(item.imageKey);
            } catch (err) {
                console.warn(`[AwsAdapter] Could not resolve image for item ${item.itemId}:`, err);
                item.imageUrl = null;
            }
        } else if (!item.imageUrl) {
            item.imageUrl = null;
        }
        return item;
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
            const token = typeof Auth.getAccessToken === 'function' ? Auth.getAccessToken() : Auth.getToken();
            if (token) {
                headers['Authorization'] = token;
            }
        }

        const response = await fetch(url, { ...options, headers });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({}));
            const errorMsg = errorBody.error || errorBody.message || `API error: ${response.status}`;
            throw new Error(errorMsg);
        }

        return response.json();
    },

    /** Get all items with optional filters, resolving pre-signed image URLs */
    async getItems(filters = {}) {
        const params = new URLSearchParams();
        if (filters.search) params.set('search', filters.search);
        if (filters.category) params.set('category', filters.category);
        if (filters.reportType) params.set('reportType', filters.reportType);
        if (filters.collectionStatus) params.set('collectionStatus', filters.collectionStatus);

        const query = params.toString();
        const path = '/items' + (query ? `?${query}` : '');
        const items = await this._fetch(path);

        if (Array.isArray(items)) {
            await Promise.all(items.map(item => this._resolveItemImageUrl(item)));
        }

        return items;
    },

    /** Get a single item by ID, resolving its pre-signed image URL */
    async getItem(itemId) {
        const item = await this._fetch(`/items/${encodeURIComponent(itemId)}`);
        return this._resolveItemImageUrl(item);
    },

    /** Create a new item and resolve its image URL if applicable */
    async createItem(itemData) {
        const created = await this._fetch('/items', {
            method: 'POST',
            body: JSON.stringify(itemData),
        });
        return this._resolveItemImageUrl(created);
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

    /**
     * Get a viewable image URL (pre-signed download URL).
     * Caches URLs in memory to avoid repeated network calls.
     * Fails gracefully and returns null if the image cannot be resolved.
     */
    async getImageUrl(imageKey) {
        if (!imageKey) return null;
        if (this._imageCache && this._imageCache[imageKey]) {
            return this._imageCache[imageKey];
        }
        try {
            const data = await this._fetch(`/images/${encodeURIComponent(imageKey)}`);
            if (data && data.imageUrl) {
                if (!this._imageCache) this._imageCache = {};
                this._imageCache[imageKey] = data.imageUrl;
                return data.imageUrl;
            }
        } catch (err) {
            console.warn(`[AwsAdapter] Image lookup failed for key "${imageKey}":`, err.message);
        }
        return null;
    },

    /** Confirm collection (organiser-only) */
    async confirmCollection(itemId, claimantName, organiser) {
        // Note: organiser info is derived from JWT on the backend.
        // We only send claimantName in the request body.
        // Deployed API Gateway route: POST /items/{itemId} (Cognito authorizer configured)
        const path = `/items/${encodeURIComponent(itemId)}`;
        try {
            return await this._fetch(path, {
                method: 'POST',
                body: JSON.stringify({ claimantName }),
            });
        } catch (err) {
            // Fallback in case route is mounted under /items/{itemId}/collect
            if (err.message && (err.message.includes('404') || err.message.includes('Missing Authentication Token'))) {
                return await this._fetch(`/items/${encodeURIComponent(itemId)}/collect`, {
                    method: 'POST',
                    body: JSON.stringify({ claimantName }),
                });
            }
            throw err;
        }
    },

    /** Get collection history */
    async getCollectionHistory() {
        return this._fetch('/collection-history');
    },

    /** Get summary stats (calculated from raw items without image fetches) */
    async getStats() {
        const items = await this._fetch('/items');
        const list = Array.isArray(items) ? items : [];
        return {
            total: list.length,
            lost: list.filter(i => i.reportType === 'LOST').length,
            found: list.filter(i => i.reportType === 'FOUND').length,
            collected: list.filter(i => i.collectionStatus === 'COLLECTED').length,
        };
    },
};
