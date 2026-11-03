/* ===================================================================
   Campus Lost & Found — Authentication Module
   
   HOW IT WORKS (for beginners):
   
   LOCAL DEMO MODE:
   - Uses hardcoded demo credentials (admin@campus.edu / demo123).
   - Simulates login/logout with a flag in memory.
   - The organiser identity (name, ID) is set by this module —
     it is NOT taken from user-typed input. This mirrors how AWS
     Cognito works: the server decides who you are based on your
     token, not what you type.
   
   AWS MODE (Phase 4):
   - Uses Amazon Cognito for real authentication.
   - JWT tokens are validated by API Gateway.
   - Organiser identity is derived from verified Cognito claims.
   =================================================================== */

const Auth = {
    _isLoggedIn: false,
    _organiser: null,
    _token: null,       // JWT token (used in AWS mode)
    _refreshToken: null,

    // Demo credentials — ONLY for local testing
    _demoCredentials: {
        username: 'admin@campus.edu',
        password: 'demo123',
        organiser: {
            name: 'Dr. Priya Patel',
            id: 'ORG-101',
            email: 'admin@campus.edu',
            role: 'organiser',
        },
    },

    /**
     * Attempt login.
     * In local mode: checks against demo credentials.
     * In AWS mode: calls Amazon Cognito USER_PASSWORD_AUTH flow.
     */
    async login(username, password) {
        if (AppConfig.mode === 'AWS') {
            return this._cognitoLogin(username, password);
        }

        // ---- LOCAL DEMO LOGIN ----
        await this._delay(600); // simulate network

        if (
            username === this._demoCredentials.username &&
            password === this._demoCredentials.password
        ) {
            this._isLoggedIn = true;
            // IMPORTANT: The organiser identity comes from the server (or here,
            // from the demo config) — NOT from user input. This prevents
            // someone from pretending to be a different organiser.
            this._organiser = { ...this._demoCredentials.organiser };
            this._token = 'demo-token';
            console.log('[Auth] Demo login successful as', this._organiser.name);
            return this._organiser;
        } else {
            throw new Error('Invalid credentials. Use the demo credentials shown below the form.');
        }
    },

    /**
     * AWS Cognito login using InitiateAuth API.
     * Uses the USER_PASSWORD_AUTH flow (no client secret needed).
     * 
     * HOW IT WORKS (for beginners):
     * 1. We send username + password to Cognito's public REST endpoint
     * 2. Cognito validates them and returns JWT tokens
     * 3. We decode the ID token to get the organiser's name, email, sub (ID)
     * 4. We store the access token for API Gateway authorization
     */
    async _cognitoLogin(username, password) {
        const region = AppConfig.aws.region;
        const clientId = AppConfig.aws.cognitoClientId;
        const endpoint = `https://cognito-idp.${region}.amazonaws.com/`;

        const body = {
            AuthFlow: 'USER_PASSWORD_AUTH',
            ClientId: clientId,
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password,
            },
        };

        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-amz-json-1.1',
                    'X-Amz-Target': 'AWSCognitoIdentityProviderService.InitiateAuth',
                },
                body: JSON.stringify(body),
            });

            const data = await response.json();

            // Handle Cognito errors
            if (data.__type || data.message) {
                const msg = data.message || 'Authentication failed';
                // Friendly error for new password required
                if (data.__type && data.__type.includes('NewPasswordRequired')) {
                    throw new Error('Password change required. Please reset your password in the AWS Cognito Console first.');
                }
                throw new Error(msg);
            }

            const tokens = data.AuthenticationResult;
            if (!tokens || !tokens.IdToken) {
                throw new Error('Unexpected Cognito response — no tokens received.');
            }

            // Decode the ID token to get user claims
            // (JWT has 3 parts separated by '.'; the middle part is the payload)
            const payload = JSON.parse(atob(tokens.IdToken.split('.')[1]));

            this._token = tokens.IdToken;
            this._refreshToken = tokens.RefreshToken || null;
            this._isLoggedIn = true;
            this._organiser = {
                name: payload.name || payload.email || 'Organiser',
                id: payload.sub,        // Cognito unique subject ID
                email: payload.email,
                role: 'organiser',
            };

            console.log('[Auth] Cognito login successful as', this._organiser.name);
            return this._organiser;

        } catch (err) {
            console.error('[Auth] Cognito login failed:', err);
            if (err.message.includes('Failed to fetch')) {
                throw new Error('Cannot reach Cognito. Check your internet connection and AWS region.');
            }
            throw err;
        }
    },

    /** Log out the current organiser */
    logout() {
        this._isLoggedIn = false;
        this._organiser = null;
        this._token = null;
        this._refreshToken = null;
        console.log('[Auth] Logged out');
    },

    /** Check if an organiser is currently logged in */
    isLoggedIn() {
        return this._isLoggedIn;
    },

    /**
     * Get the JWT token for API Gateway requests.
     * AwsAdapter calls this to set the Authorization header.
     */
    getToken() {
        return this._token;
    },

    /**
     * Get the authenticated organiser's identity.
     * This is the ONLY way to get the organiser name/ID for
     * collection confirmations. It must NOT come from a form field.
     */
    getOrganiser() {
        if (!this._isLoggedIn || !this._organiser) return null;
        return { ...this._organiser };
    },

    /** Simulate network delay */
    _delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },
};
