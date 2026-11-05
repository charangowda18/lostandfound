/* ===================================================================
   Campus Lost & Found — Configuration
   
   Decides whether to run in LOCAL DEMO mode or AWS mode.
   
   HOW IT WORKS (for beginners):
   - By default, the app runs in LOCAL DEMO mode — no AWS needed.
   - When you're ready to connect to AWS, create a file called 
     `env.js` in the `js/` folder with your AWS settings.
   - The app checks if AWS config exists. If not → demo mode.
   =================================================================== */

const AppConfig = {
    // ---- Mode detection ----
    // 'LOCAL' = demo mode with fake data in browser memory
    // 'AWS'   = real AWS services (needs env.js configuration)
    mode: 'LOCAL',

    // ---- AWS settings (only used when mode = 'AWS') ----
    aws: {
        apiBaseUrl: '',          // API Gateway URL, e.g. https://abc123.execute-api.us-east-1.amazonaws.com/prod
        cognitoUserPoolId: '',   // Cognito User Pool ID
        cognitoClientId: '',     // Cognito App Client ID
        region: '',              // AWS region, e.g. 'us-east-1'
        s3Bucket: '',            // S3 bucket name for images
    },

    // ---- App constants ----
    maxImageSizeMB: 5,
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    toastDurationMs: 4000,

    // ---- Categories (single source of truth) ----
    categories: [
        'Electronics',
        'Books & Stationery',
        'Clothing',
        'ID Cards & Documents',
        'Keys',
        'Bags & Wallets',
        'Sports Equipment',
        'Other',
    ],
};

/*
 * Try to load AWS config from env.js (loaded separately).
 * If window.__AWS_CONFIG__ is defined with an apiBaseUrl, switch to AWS mode.
 *
 * IMPORTANT: env.js should NEVER be committed to Git.
 * It contains only public-facing identifiers (pool IDs, API URLs),
 * NOT secret keys. Secret keys must never appear in browser code.
 */
(function detectMode() {
    if (typeof window.__AWS_CONFIG__ === 'object' && window.__AWS_CONFIG__ !== null) {
        const cfg = window.__AWS_CONFIG__;
        if (cfg.apiBaseUrl) {
            AppConfig.mode = 'AWS';
            AppConfig.aws = { ...AppConfig.aws, ...cfg };
            console.log(`[Config] AWS mode activated (API: ${cfg.apiBaseUrl}, Region: ${cfg.region || 'ap-southeast-2'})`);

            const missing = [];
            if (!cfg.cognitoUserPoolId) missing.push('cognitoUserPoolId');
            if (!cfg.cognitoClientId) missing.push('cognitoClientId');
            if (missing.length > 0) {
                console.warn(`[Config] Note: Missing Cognito values: ${missing.join(', ')}. Organiser login requires these values.`);
            }
        } else {
            console.warn('[Config] __AWS_CONFIG__ present but apiBaseUrl is empty — staying in LOCAL demo mode.');
        }
    } else {
        console.log('[Config] No AWS config found — running in LOCAL DEMO mode.');
    }
})();
