/* ===================================================================
   Campus Lost & Found — Environment Configuration EXAMPLE
   
   INSTRUCTIONS:
   1. Copy this file and rename it to "env.js"
   2. Fill in your actual AWS values
   3. Add env.js to .gitignore (NEVER commit real config)
   4. Add <script src="js/env.js"></script> to index.html BEFORE config.js
   
   This file sets window.__AWS_CONFIG__ which config.js reads
   to switch from LOCAL mode to AWS mode.
   
   IMPORTANT: This file does NOT contain secret keys.
   These are public-facing identifiers (pool IDs, API URLs).
   AWS secret keys must NEVER appear in browser JavaScript.
   =================================================================== */

window.__AWS_CONFIG__ = {
    // API Gateway invoke URL (get this from API Gateway → Stages → prod)
    apiBaseUrl: 'https://YOUR_API_ID.execute-api.us-east-1.amazonaws.com/prod',
    
    // Cognito User Pool ID (get from Cognito → User Pools → Your Pool)
    cognitoUserPoolId: 'us-east-1_XXXXXXXXX',
    
    // Cognito App Client ID (get from Cognito → App clients)
    cognitoClientId: 'XXXXXXXXXXXXXXXXXXXXXXXXXX',
    
    // AWS Region
    region: 'us-east-1',
    
    // S3 bucket name for images (bucket must have Block Public Access ON)
    s3Bucket: 'campus-lost-found-images-YOURID',
};
