/* ===================================================================
   Campus Lost & Found — Main Application Controller
   
   This is the "brain" of the app. It:
   1. Initialises the data adapter
   2. Handles page navigation
   3. Renders item cards, stats, forms, and modals
   4. Manages search/filter interactions
   5. Handles form submissions (report lost/found, collection confirm)
   6. Manages organiser login/logout
   7. Shows toast notifications
   
   HOW IT'S ORGANISED (for beginners):
   - The App object at the top is the main controller.
   - Helper functions (renderItemCard, showToast, etc.) are below.
   - Everything runs when the page loads (DOMContentLoaded event).
   =================================================================== */

const App = {
    currentPage: 'dashboard',
    currentModalItemId: null,

    /** -------- INITIALISE -------- */
    async init() {
        console.log('[App] Initialising Campus Lost & Found...');

        // 1. Initialise data adapter (local or AWS)
        await DataAdapter.init();

        // 2. Bind event listeners
        this.bindNavigation();
        this.bindSearch();
        this.bindForms();
        this.bindModal();
        this.bindAuth();
        this.bindMobileMenu();
        this.bindScrollEffects();

        // 3. Set today's date as default for report forms
        const today = new Date().toISOString().split('T')[0];
        document.getElementById('lost-date').value = today;
        document.getElementById('found-date').value = today;
        document.getElementById('lost-date').max = today;
        document.getElementById('found-date').max = today;

        // 4. Update banner for AWS connection status
        this.updateModeBanner();

        // 5. Load dashboard
        await this.loadDashboard();

        console.log('[App] Ready!');
    },

    /** Update banner and credentials notice when connected to AWS */
    updateModeBanner() {
        const banner = document.getElementById('demo-banner');
        if (banner && AppConfig.mode === 'AWS') {
            banner.style.background = 'linear-gradient(90deg, #ecfdf5, #d1fae5)';
            banner.style.borderBottomColor = '#6ee7b7';
            banner.style.color = '#065f46';
            const region = AppConfig.aws.region || 'ap-southeast-2';
            banner.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#059669" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
                <span><strong>AWS CONNECTED (${escapeHtml(region)})</strong> — Live API Gateway: <code style="background:rgba(0,0,0,0.06);padding:2px 6px;border-radius:4px">${escapeHtml(AppConfig.aws.apiBaseUrl)}</code></span>
            `;

            // If Cognito is not fully configured, update the login notice
            const demoCreds = document.querySelector('.demo-credentials');
            if (demoCreds) {
                if (!AppConfig.aws.cognitoClientId) {
                    demoCreds.innerHTML = `
                        <p><strong>AWS Cognito Status:</strong></p>
                        <p>User Pool ID: <code style="font-size:0.75rem">${escapeHtml(AppConfig.aws.cognitoUserPoolId || 'Not set')}</code></p>
                        <p style="color:var(--amber-700)">App Client ID pending: Set <code>cognitoClientId</code> in <code>js/env.js</code> to enable organiser sign-in.</p>
                        <p><small>Public browsing &amp; reporting remain active without login.</small></p>
                    `;
                } else {
                    demoCreds.innerHTML = `
                        <p><strong>AWS Cognito Authentication:</strong></p>
                        <p>Sign in with your Cognito User Pool account (must belong to the <code>Organisers</code> group).</p>
                    `;
                }
            }
        }
    },

    /* ================================================================
       NAVIGATION
       ================================================================ */

    bindNavigation() {
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const page = link.dataset.page;
                this.navigateTo(page);
            });
        });

        // Brand logo → dashboard
        document.getElementById('nav-brand').addEventListener('click', () => {
            this.navigateTo('dashboard');
        });
    },

    navigateTo(pageName) {
        // Handle organiser nav — if logged in, show panel; else show login
        if (pageName === 'organiser-login') {
            if (Auth.isLoggedIn()) {
                pageName = 'organiser-dashboard';
            }
        }

        // Hide all pages
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));

        // Show target page
        const target = document.getElementById(`page-${pageName}`);
        if (target) {
            target.classList.add('active');
        }

        // Update nav link active state
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        const activeNav = document.querySelector(`.nav-link[data-page="${pageName}"]`) ||
                          document.querySelector(`.nav-link[data-page="organiser-login"]`);
        if (activeNav) activeNav.classList.add('active');

        // Close mobile menu
        document.getElementById('nav-links').classList.remove('open');
        document.getElementById('mobile-menu-btn').classList.remove('active');

        this.currentPage = pageName;

        // Load page-specific data
        if (pageName === 'dashboard') this.loadDashboard();
        if (pageName === 'collection-history') this.loadCollectionHistory();
        if (pageName === 'organiser-dashboard') this.loadOrganiserDashboard();

        // Scroll to top
        window.scrollTo({ top: 0, behavior: 'smooth' });
    },

    /* ================================================================
       DASHBOARD — Stats + Item Cards
       ================================================================ */

    async loadDashboard() {
        // Show loading
        document.getElementById('loading-state').classList.remove('hidden');
        document.getElementById('items-grid').innerHTML = '';
        document.getElementById('empty-state').classList.add('hidden');

        try {
            // Load stats
            const stats = await DataAdapter.getStats();
            this.renderStats(stats);

            // Load items with current filters
            const filters = this.getFilters();
            const items = await DataAdapter.getItems(filters);

            // Hide loading
            document.getElementById('loading-state').classList.add('hidden');

            if (items.length === 0) {
                document.getElementById('empty-state').classList.remove('hidden');
            } else {
                this.renderItemCards(items, 'items-grid');
            }
        } catch (err) {
            document.getElementById('loading-state').classList.add('hidden');
            showToast('Failed to load items: ' + err.message, 'error');
            console.error('[App] Dashboard load error:', err);
        }
    },

    renderStats(stats) {
        const animate = (el, target) => {
            const num = el;
            let current = 0;
            const step = Math.max(1, Math.ceil(target / 20));
            const interval = setInterval(() => {
                current = Math.min(current + step, target);
                num.textContent = current;
                if (current >= target) clearInterval(interval);
            }, 30);
        };

        animate(document.getElementById('count-total'), stats.total);
        animate(document.getElementById('count-lost'), stats.lost);
        animate(document.getElementById('count-found'), stats.found);
        animate(document.getElementById('count-collected'), stats.collected);
    },

    renderItemCards(items, containerId) {
        const grid = document.getElementById(containerId);
        grid.innerHTML = '';

        items.forEach((item, index) => {
            const card = document.createElement('div');
            card.className = `item-card${item.collectionStatus === 'COLLECTED' ? ' collected' : ''}`;
            card.dataset.category = item.category;
            card.dataset.itemId = item.itemId;
            card.style.setProperty('--delay', `${index * 60}ms`);

            // Add organiser-card class if in organiser view
            if (containerId === 'organiser-items-grid') {
                card.classList.add('organiser-card');
            }

            const imageHtml = item.imageUrl
                ? `<div class="item-card-image"><img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.itemName)}" onerror="this.onerror=null; this.parentElement.className='item-card-no-image'; this.parentElement.innerHTML='<svg width=\\'32\\' height=\\'32\\' viewBox=\\'0 0 24 24\\' fill=\\'none\\' stroke=\\'currentColor\\' stroke-width=\\'1.5\\'><rect x=\\'3\\' y=\\'3\\' width=\\'18\\' height=\\'18\\' rx=\\'2\\' ry=\\'2\\'></rect><circle cx=\\'8.5\\' cy=\\'8.5\\' r=\\'1.5\\'></circle><polyline points=\\'21 15 16 10 5 21\\'></polyline></svg><p>No photo</p>';"></div>`
                : `<div class="item-card-no-image">
                       <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                       <p>No photo</p>
                   </div>`;

            const reportBadge = item.reportType === 'LOST'
                ? '<span class="badge badge-lost">Lost</span>'
                : '<span class="badge badge-found">Found</span>';

            const statusBadge = item.collectionStatus === 'COLLECTED'
                ? '<span class="badge badge-collected">Collected</span>'
                : '<span class="badge badge-pending">Pending</span>';

            const demoLabel = item.isDemo
                ? '<span class="demo-label">Demo Data</span>'
                : '';

            card.innerHTML = `
                ${imageHtml}
                <div class="item-card-body">
                    <div class="item-card-badges">${reportBadge}${statusBadge}</div>
                    <h3 class="item-card-title">${escapeHtml(item.itemName)}</h3>
                    <p class="item-card-desc">${escapeHtml(item.description)}</p>
                    <div class="item-card-meta">
                        <span>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                            ${escapeHtml(item.location)}
                        </span>
                        <span>${formatDate(item.reportDate)}</span>
                    </div>
                </div>
                ${demoLabel}
            `;

            card.addEventListener('click', () => this.openItemModal(item.itemId));
            grid.appendChild(card);
        });
    },

    /* ================================================================
       SEARCH & FILTERS
       ================================================================ */

    bindSearch() {
        const searchInput = document.getElementById('search-input');
        const categoryFilter = document.getElementById('filter-category');
        const statusFilter = document.getElementById('filter-status');
        const collectionFilter = document.getElementById('filter-collection');

        // Debounced search
        let searchTimeout;
        searchInput.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => this.loadDashboard(), 300);
        });

        categoryFilter.addEventListener('change', () => this.loadDashboard());
        statusFilter.addEventListener('change', () => this.loadDashboard());
        collectionFilter.addEventListener('change', () => this.loadDashboard());
    },

    getFilters() {
        return {
            search: document.getElementById('search-input').value.trim(),
            category: document.getElementById('filter-category').value,
            reportType: document.getElementById('filter-status').value,
            collectionStatus: document.getElementById('filter-collection').value,
        };
    },

    /* ================================================================
       REPORT FORMS (Lost / Found)
       ================================================================ */

    bindForms() {
        // Lost form
        document.getElementById('form-report-lost').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleReportSubmit('lost');
        });

        // Found form
        document.getElementById('form-report-found').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleReportSubmit('found');
        });

        // Image upload previews
        this.bindImageUpload('lost');
        this.bindImageUpload('found');

        // Lost item suggestions on found form
        this.bindLostItemSuggestions();

        // Form reset handlers
        document.getElementById('btn-reset-lost').addEventListener('click', () => {
            setTimeout(() => {
                document.getElementById('lost-image-preview').classList.add('hidden');
                document.getElementById('lost-upload-area').classList.remove('hidden');
            }, 0);
        });
        document.getElementById('btn-reset-found').addEventListener('click', () => {
            setTimeout(() => {
                document.getElementById('found-image-preview').classList.add('hidden');
                document.getElementById('found-upload-area').classList.remove('hidden');
                this._clearMatchedItem();
            }, 0);
        });
    },

    /* ================================================================
       LOST ITEM SUGGESTIONS (on Report Found form)
       Shows a live dropdown of existing lost items so the reporter
       can quickly match what they found to a lost report.
       ================================================================ */

    _matchedLostItem: null,   // stores the currently selected lost item

    bindLostItemSuggestions() {
        const input = document.getElementById('found-item-name');
        const dropdown = document.getElementById('found-suggestions-dropdown');
        let debounceTimer;
        let activeIndex = -1;

        // Show suggestions as user types
        input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => this._showSuggestions(input.value), 200);
        });

        // Show all lost items on focus if field is empty
        input.addEventListener('focus', () => {
            if (input.value.trim().length === 0) {
                this._showSuggestions('');
            }
        });

        // Keyboard navigation (arrow keys + Enter)
        input.addEventListener('keydown', (e) => {
            const items = dropdown.querySelectorAll('.suggestion-item');
            if (dropdown.classList.contains('hidden') || items.length === 0) return;

            if (e.key === 'ArrowDown') {
                e.preventDefault();
                activeIndex = Math.min(activeIndex + 1, items.length - 1);
                this._highlightSuggestion(items, activeIndex);
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                activeIndex = Math.max(activeIndex - 1, 0);
                this._highlightSuggestion(items, activeIndex);
            } else if (e.key === 'Enter' && activeIndex >= 0) {
                e.preventDefault();
                items[activeIndex].click();
            } else if (e.key === 'Escape') {
                dropdown.classList.add('hidden');
                activeIndex = -1;
            }
        });

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('#found-suggestions-wrapper')) {
                dropdown.classList.add('hidden');
                activeIndex = -1;
            }
        });
    },

    async _showSuggestions(query) {
        const dropdown = document.getElementById('found-suggestions-dropdown');

        try {
            // Fetch only LOST + PENDING items
            const lostItems = await DataAdapter.getItems({
                reportType: 'LOST',
                collectionStatus: 'PENDING',
            });

            // Filter by query (name match)
            const q = query.toLowerCase().trim();
            const matches = q.length === 0
                ? lostItems.slice(0, 10)  // show first 10 when empty
                : lostItems.filter(item =>
                    item.itemName.toLowerCase().includes(q) ||
                    item.description.toLowerCase().includes(q) ||
                    item.category.toLowerCase().includes(q)
                );

            if (matches.length === 0 && q.length > 0) {
                dropdown.innerHTML = `
                    <div class="suggestion-header">Reported Lost Items</div>
                    <div class="suggestion-no-match">
                        No matching lost items found — you can still type a custom name
                    </div>`;
            } else if (matches.length === 0) {
                dropdown.innerHTML = `
                    <div class="suggestion-no-match">
                        No lost items reported yet
                    </div>`;
            } else {
                dropdown.innerHTML = `
                    <div class="suggestion-header">
                        ${q.length > 0 ? `${matches.length} matching lost item${matches.length !== 1 ? 's' : ''}` : 'Recently reported lost items'}
                    </div>
                    ${matches.map(item => `
                        <div class="suggestion-item" data-item-id="${item.itemId}">
                            <div class="suggestion-item-name">
                                ${escapeHtml(item.itemName)}
                                <span class="badge badge-lost">Lost</span>
                                ${item.isDemo ? '<span class="badge badge-demo">Demo</span>' : ''}
                            </div>
                            <div class="suggestion-item-meta">
                                <span>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect></svg>
                                    ${escapeHtml(item.category)}
                                </span>
                                <span>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                                    ${escapeHtml(item.location)}
                                </span>
                                <span>${formatDate(item.reportDate)}</span>
                            </div>
                        </div>
                    `).join('')}`;
            }

            // Bind click on each suggestion
            dropdown.querySelectorAll('.suggestion-item').forEach(el => {
                el.addEventListener('click', () => {
                    const itemId = el.dataset.itemId;
                    const selectedItem = matches.find(i => i.itemId === itemId);
                    if (selectedItem) this._selectLostItem(selectedItem);
                });
            });

            dropdown.classList.remove('hidden');
        } catch (err) {
            console.error('[App] Failed to fetch lost items for suggestions:', err);
        }
    },

    _highlightSuggestion(items, index) {
        items.forEach((el, i) => {
            el.classList.toggle('active', i === index);
            if (i === index) el.scrollIntoView({ block: 'nearest' });
        });
    },

    _selectLostItem(item) {
        // Auto-fill the found form fields
        document.getElementById('found-item-name').value = item.itemName;
        document.getElementById('found-category').value = item.category;
        document.getElementById('found-description').value = item.description;

        // Store matched item reference
        this._matchedLostItem = item;

        // Hide dropdown
        document.getElementById('found-suggestions-dropdown').classList.add('hidden');

        // Show matched banner
        this._showMatchedBanner(item);

        showToast(`Matched to lost item: "${item.itemName}" — category and description auto-filled!`, 'success');
    },

    _showMatchedBanner(item) {
        // Remove existing banner if any
        this._clearMatchedBanner();

        const wrapper = document.getElementById('found-suggestions-wrapper');
        const banner = document.createElement('div');
        banner.className = 'matched-item-banner';
        banner.id = 'matched-item-banner';
        banner.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>
            <span>Matched to lost report: <strong>${escapeHtml(item.itemName)}</strong> (${escapeHtml(item.category)}, ${formatDate(item.reportDate)})</span>
            <button type="button" class="btn-clear-match" id="btn-clear-match">Clear</button>
        `;
        wrapper.appendChild(banner);

        // Clear button handler
        document.getElementById('btn-clear-match').addEventListener('click', () => {
            this._clearMatchedItem();
        });
    },

    _clearMatchedBanner() {
        const existing = document.getElementById('matched-item-banner');
        if (existing) existing.remove();
    },

    _clearMatchedItem() {
        this._matchedLostItem = null;
        this._clearMatchedBanner();
    },

    bindImageUpload(type) {
        const input = document.getElementById(`${type}-image`);
        const area = document.getElementById(`${type}-upload-area`);
        const preview = document.getElementById(`${type}-image-preview`);
        const previewImg = document.getElementById(`${type}-preview-img`);
        const removeBtn = document.getElementById(`${type}-remove-image`);

        input.addEventListener('change', () => {
            const file = input.files[0];
            if (!file) return;

            // Validate file type
            if (!AppConfig.allowedImageTypes.includes(file.type)) {
                showToast('Please upload a JPG, PNG, or WebP image.', 'error');
                input.value = '';
                return;
            }

            // Validate file size
            if (file.size > AppConfig.maxImageSizeMB * 1024 * 1024) {
                showToast(`Image must be under ${AppConfig.maxImageSizeMB} MB.`, 'error');
                input.value = '';
                return;
            }

            // Show preview
            const reader = new FileReader();
            reader.onload = () => {
                previewImg.src = reader.result;
                preview.classList.remove('hidden');
                area.classList.add('hidden');
            };
            reader.readAsDataURL(file);
        });

        // Drag and drop
        area.addEventListener('dragover', (e) => { e.preventDefault(); area.style.borderColor = 'var(--primary-400)'; });
        area.addEventListener('dragleave', () => { area.style.borderColor = ''; });
        area.addEventListener('drop', (e) => {
            e.preventDefault();
            area.style.borderColor = '';
            if (e.dataTransfer.files.length) {
                input.files = e.dataTransfer.files;
                input.dispatchEvent(new Event('change'));
            }
        });

        // Remove image
        removeBtn.addEventListener('click', () => {
            input.value = '';
            preview.classList.add('hidden');
            area.classList.remove('hidden');
        });
    },

    async handleReportSubmit(type) {
        const form = document.getElementById(`form-report-${type}`);
        const btn = document.getElementById(`btn-submit-${type}`);

        // Validate
        const itemName = document.getElementById(`${type}-item-name`).value.trim();
        const category = document.getElementById(`${type}-category`).value;
        const description = document.getElementById(`${type}-description`).value.trim();
        const location = document.getElementById(`${type}-location`).value.trim();
        const reportDate = document.getElementById(`${type}-date`).value;

        let valid = true;

        valid = validateField(`${type}-item-name`, itemName, 'Item name is required') && valid;
        valid = validateField(`${type}-category`, category, 'Please select a category') && valid;
        valid = validateField(`${type}-description`, description, 'Description is required') && valid;
        valid = validateField(`${type}-location`, location, 'Location is required') && valid;
        valid = validateField(`${type}-date`, reportDate, 'Date is required') && valid;

        if (!valid) {
            showToast('Please fix the errors in the form.', 'warning');
            return;
        }

        // Disable button, show loading
        btn.classList.add('loading');
        btn.disabled = true;

        try {
            // Handle image upload
            let imageKey = null;
            let imageUrl = null;
            const imageInput = document.getElementById(`${type}-image`);
            if (imageInput.files[0]) {
                const result = await DataAdapter.uploadImage(imageInput.files[0]);
                imageKey = result.imageKey;
                imageUrl = result.imageUrl;
            }

            // Create item
            const newItem = await DataAdapter.createItem({
                itemName,
                category,
                description,
                location,
                reportDate,
                reportType: type.toUpperCase(),
                imageKey,
                imageUrl,
            });

            showToast(`${type === 'lost' ? 'Lost' : 'Found'} item reported successfully!`, 'success');

            // Reset form
            form.reset();
            document.getElementById(`${type}-image-preview`).classList.add('hidden');
            document.getElementById(`${type}-upload-area`).classList.remove('hidden');

            // Clear matched lost item banner (found form only)
            if (type === 'found') this._clearMatchedItem();

            // Set today's date again
            const today = new Date().toISOString().split('T')[0];
            document.getElementById(`${type}-date`).value = today;

            // Navigate to dashboard
            this.navigateTo('dashboard');

        } catch (err) {
            showToast('Failed to report item: ' + err.message, 'error');
            console.error('[App] Report submit error:', err);
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    },

    /* ================================================================
       ITEM DETAIL MODAL
       ================================================================ */

    bindModal() {
        document.getElementById('modal-close').addEventListener('click', () => this.closeModal());
        document.getElementById('modal-overlay').addEventListener('click', (e) => {
            if (e.target === document.getElementById('modal-overlay')) {
                this.closeModal();
            }
        });

        // Escape key closes modal
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') this.closeModal();
        });

        // Collection form submit
        document.getElementById('form-collection').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleCollectionConfirm();
        });
    },

    async openItemModal(itemId) {
        try {
            const item = await DataAdapter.getItem(itemId);
            this.currentModalItemId = itemId;

            // Set image
            const imgEl = document.getElementById('modal-item-image');
            const noImgEl = document.getElementById('modal-no-image');

            // If item has imageKey but imageUrl is not yet populated, resolve it
            if (!item.imageUrl && item.imageKey) {
                try {
                    item.imageUrl = await DataAdapter.getImageUrl(item.imageKey);
                } catch {
                    item.imageUrl = null;
                }
            }

            imgEl.onerror = () => {
                imgEl.classList.add('hidden');
                noImgEl.classList.remove('hidden');
            };

            if (item.imageUrl) {
                imgEl.src = item.imageUrl;
                imgEl.classList.remove('hidden');
                noImgEl.classList.add('hidden');
            } else {
                imgEl.classList.add('hidden');
                noImgEl.classList.remove('hidden');
            }

            // Set badges
            const typeBadge = document.getElementById('modal-report-type');
            typeBadge.textContent = item.reportType;
            typeBadge.className = `badge badge-${item.reportType.toLowerCase()}`;

            const statusBadge = document.getElementById('modal-collection-status');
            statusBadge.textContent = item.collectionStatus;
            statusBadge.className = `badge badge-${item.collectionStatus.toLowerCase()}`;

            // Set info
            document.getElementById('modal-item-name').textContent = item.itemName;
            document.getElementById('modal-description').textContent = item.description;
            document.getElementById('modal-category').textContent = item.category;
            document.getElementById('modal-location').textContent = item.location;
            document.getElementById('modal-date').textContent = formatDate(item.reportDate);
            document.getElementById('modal-item-id').textContent = item.itemId;

            // Collection info (for collected items)
            const collectionInfo = document.getElementById('modal-collection-info');
            if (item.collectionStatus === 'COLLECTED') {
                collectionInfo.classList.remove('hidden');
                document.getElementById('modal-claimant').textContent = item.claimantName;
                document.getElementById('modal-organiser').textContent = item.organiserName;
                document.getElementById('modal-organiser-id').textContent = item.organiserId;
                document.getElementById('modal-collection-date').textContent = formatDateTime(item.collectionTimestamp);
            } else {
                collectionInfo.classList.add('hidden');
            }

            // Collection form (organiser only, FOUND items that are still PENDING)
            // SECURITY NOTE: This is a UI convenience only. The backend Lambda
            // independently verifies reportType === 'FOUND' and cognito:groups === 'Organisers'.
            const collectionFormSection = document.getElementById('modal-collection-form-section');
            if (Auth.isLoggedIn() && Auth.isOrganiser() && item.collectionStatus === 'PENDING' && item.reportType === 'FOUND') {
                collectionFormSection.classList.remove('hidden');
                const org = Auth.getOrganiser();
                document.getElementById('collection-organiser-name').textContent = org.name;
                document.getElementById('collection-organiser-id').textContent = org.id;
                document.getElementById('collection-claimant').value = '';
                document.getElementById('error-collection-claimant').textContent = '';
            } else {
                collectionFormSection.classList.add('hidden');
            }

            // Show modal
            document.getElementById('modal-overlay').classList.remove('hidden');
            document.body.style.overflow = 'hidden';

        } catch (err) {
            showToast('Failed to load item details: ' + err.message, 'error');
        }
    },

    closeModal() {
        document.getElementById('modal-overlay').classList.add('hidden');
        document.body.style.overflow = '';
        this.currentModalItemId = null;
    },

    /* ================================================================
       COLLECTION CONFIRMATION
       ================================================================ */

    async handleCollectionConfirm() {
        if (!Auth.isLoggedIn() || !Auth.isOrganiser()) {
            showToast('Access denied: You must be logged in as an authorised organiser.', 'error');
            return;
        }

        const claimantName = document.getElementById('collection-claimant').value.trim();
        if (!claimantName) {
            document.getElementById('error-collection-claimant').textContent = 'Claimant name is required';
            document.getElementById('collection-claimant').classList.add('invalid');
            return;
        }

        // Get organiser identity from Auth (NOT from a form field)
        const organiser = Auth.getOrganiser();

        // Show confirmation dialog
        const confirmed = await showConfirmDialog(
            'Confirm Collection',
            `Are you sure "${claimantName}" is collecting this item?\n\nThis action cannot be undone.`
        );

        if (!confirmed) return;

        const btn = document.getElementById('btn-confirm-collection');
        btn.classList.add('loading');
        btn.disabled = true;

        try {
            const result = await DataAdapter.confirmCollection(
                this.currentModalItemId,
                claimantName,
                organiser
            );

            showToast('Item collection confirmed successfully!', 'success');
            this.closeModal();

            // Reload current page
            if (this.currentPage === 'organiser-dashboard') {
                this.loadOrganiserDashboard();
            } else {
                this.loadDashboard();
            }

        } catch (err) {
            showToast(err.message || 'Failed to confirm collection.', 'error');
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    },

    /* ================================================================
       COLLECTION HISTORY
       ================================================================ */

    async loadCollectionHistory() {
        try {
            const history = await DataAdapter.getCollectionHistory();
            const tbody = document.getElementById('history-tbody');
            const emptyState = document.getElementById('history-empty');
            const tableWrapper = document.getElementById('history-table-wrapper');

            if (history.length === 0) {
                tableWrapper.classList.add('hidden');
                emptyState.classList.remove('hidden');
                return;
            }

            tableWrapper.classList.remove('hidden');
            emptyState.classList.add('hidden');

            tbody.innerHTML = history.map(record => {
                const isRedacted = record.redacted === true;
                const redactedBadge = isRedacted ? '<span class="badge badge-demo" style="margin-left:6px" title="Login as organiser to see full details">Redacted</span>' : '';
                return `
                <tr${isRedacted ? ' class="redacted-row"' : ''}>
                    <td>
                        <strong>${escapeHtml(record.itemName)}</strong>
                        ${record.isDemo ? '<span class="badge badge-demo" style="margin-left:6px">Demo</span>' : ''}
                        ${redactedBadge}
                        <br><small class="mono">${escapeHtml(record.itemId)}</small>
                    </td>
                    <td>${escapeHtml(record.category)}</td>
                    <td>${escapeHtml(record.claimantName)}</td>
                    <td>${escapeHtml(record.organiserName)}</td>
                    <td class="mono">${escapeHtml(record.organiserId)}</td>
                    <td>${formatDateTime(record.collectionTimestamp)}</td>
                    <td><span class="badge badge-collected">${record.status}</span></td>
                </tr>`;
            }).join('');

        } catch (err) {
            showToast('Failed to load collection history.', 'error');
        }
    },

    /* ================================================================
       ORGANISER LOGIN / LOGOUT / DASHBOARD
       ================================================================ */

    bindAuth() {
        document.getElementById('form-organiser-login').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        document.getElementById('btn-org-logout').addEventListener('click', () => {
            this.handleLogout();
        });
    },

    async handleLogin() {
        const username = document.getElementById('org-username').value.trim();
        const password = document.getElementById('org-password').value;

        let valid = true;
        valid = validateField('org-username', username, 'Username is required') && valid;
        valid = validateField('org-password', password, 'Password is required') && valid;

        if (!valid) return;

        const btn = document.getElementById('btn-org-login');
        btn.classList.add('loading');
        btn.disabled = true;

        try {
            const organiser = await Auth.login(username, password);
            showToast(`Welcome, ${organiser.name}!`, 'success');

            // Update nav
            document.getElementById('nav-organiser-text').textContent = organiser.name;
            document.getElementById('organiser-name-display').textContent = organiser.name;

            // Navigate to organiser dashboard
            this.navigateTo('organiser-dashboard');

        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            btn.classList.remove('loading');
            btn.disabled = false;
        }
    },

    handleLogout() {
        Auth.logout();
        document.getElementById('nav-organiser-text').textContent = 'Organiser';
        showToast('Signed out successfully.', 'info');
        this.navigateTo('organiser-login');
    },

    async loadOrganiserDashboard() {
        if (!Auth.isLoggedIn() || !Auth.isOrganiser()) {
            showToast('Access restricted: Organiser sign-in required.', 'warning');
            this.navigateTo('organiser-login');
            return;
        }

        try {
            // Show only PENDING items for organiser workflow
            const items = await DataAdapter.getItems({ collectionStatus: 'PENDING' });
            const grid = document.getElementById('organiser-items-grid');
            const emptyState = document.getElementById('organiser-empty');

            if (items.length === 0) {
                grid.innerHTML = '';
                emptyState.classList.remove('hidden');
            } else {
                emptyState.classList.add('hidden');
                this.renderItemCards(items, 'organiser-items-grid');
            }
        } catch (err) {
            showToast('Failed to load pending items.', 'error');
        }
    },

    /* ================================================================
       MOBILE MENU & SCROLL EFFECTS
       ================================================================ */

    bindMobileMenu() {
        const btn = document.getElementById('mobile-menu-btn');
        const links = document.getElementById('nav-links');

        btn.addEventListener('click', () => {
            btn.classList.toggle('active');
            links.classList.toggle('open');
        });
    },

    bindScrollEffects() {
        window.addEventListener('scroll', () => {
            const navbar = document.getElementById('navbar');
            if (window.scrollY > 10) {
                navbar.classList.add('scrolled');
            } else {
                navbar.classList.remove('scrolled');
            }
        });
    },
};


/* ===================================================================
   HELPER FUNCTIONS
   =================================================================== */

/**
 * Validate a single form field and show/hide error message.
 */
function validateField(fieldId, value, errorMsg) {
    const field = document.getElementById(fieldId);
    const errorSpan = document.getElementById(`error-${fieldId}`);

    if (!value) {
        if (field) field.classList.add('invalid');
        if (errorSpan) errorSpan.textContent = errorMsg;
        return false;
    } else {
        if (field) field.classList.remove('invalid');
        if (errorSpan) errorSpan.textContent = '';
        return true;
    }
}

/**
 * Escape HTML to prevent XSS.
 */
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

/**
 * Format date string to readable format.
 */
function formatDate(dateStr) {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    } catch {
        return dateStr;
    }
}

/**
 * Format datetime string to readable format.
 */
function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    try {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-IN', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    } catch {
        return dateStr;
    }
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {'success'|'error'|'info'|'warning'} type
 */
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    const icons = {
        success: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg>',
        error: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
        info: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
        warning: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>',
    };

    toast.innerHTML = `${icons[type] || icons.info}<span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    // Auto-remove after duration
    setTimeout(() => {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
    }, AppConfig.toastDurationMs);
}

/**
 * Show a confirmation dialog. Returns a Promise<boolean>.
 */
function showConfirmDialog(title, message) {
    return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.className = 'confirm-dialog-overlay';
        overlay.innerHTML = `
            <div class="confirm-dialog">
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(message)}</p>
                <div class="confirm-dialog-actions">
                    <button class="btn btn-outline" id="confirm-cancel">Cancel</button>
                    <button class="btn btn-success" id="confirm-yes">Confirm</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        overlay.querySelector('#confirm-cancel').addEventListener('click', () => {
            overlay.remove();
            resolve(false);
        });

        overlay.querySelector('#confirm-yes').addEventListener('click', () => {
            overlay.remove();
            resolve(true);
        });

        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) {
                overlay.remove();
                resolve(false);
            }
        });
    });
}


/* ===================================================================
   BOOT — Start the app when the page finishes loading
   =================================================================== */
document.addEventListener('DOMContentLoaded', () => {
    App.init().catch(err => {
        console.error('[App] Initialisation failed:', err);
        showToast('Application failed to start. Check console for details.', 'error');
    });
});
