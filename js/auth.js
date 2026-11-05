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
    _token: null,          // Primary token for API requests (Cognito Access Token in AWS mode)
    _accessToken: null,    // Cognito Access Token (for Authorization header)
    _idToken: null,        // Cognito ID Token (for identity claims)
    _refreshToken: null,
    _groups: [],

    // Demo credentials — ONLY for local testing
    _demoCredentials: {
        username: 'admin@campus.edu',
        password: 'demo123',
        organiser: {
            name: 'Dr. Priya Patel',
            id: 'ORG-101',
            email: 'admin@campus.edu',
            role: 'organiser',
            groups: ['Organisers'],
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
            this._groups = ['Organisers'];
            this._token = 'demo-access-token';
            this._accessToken = 'demo-access-token';
            this._idToken = 'demo-id-token';
            console.log('[Auth] Demo login successful as', this._organiser.name);
            return this._organiser;
        } else {
            throw new Error('Invalid credentials. Use the demo credentials shown below the form.');
        }
    },

    /**
     * AWS Cognito login using InitiateAuth API.
     * Uses the USER_PASSWORD_AUTH flow (no client secret needed for SPA app clients).
     * 
     * HOW IT WORKS:
     * 1. Validates that Cognito User Pool ID and Client ID are configured in js/env.js.
     * 2. Sends username + password to Cognito's public REST endpoint.
     * 3. Cognito validates credentials and returns JWT tokens (AccessToken, IdToken).
     * 4. Decodes token payloads and checks the 'cognito:groups' claim.
     * 5. Enforces that only users in the 'Organisers' group can authenticate as organisers.
     * 6. Stores the Cognito Access Token for API Gateway collection verification.
     */
    async _cognitoLogin(username, password) {
        const region = AppConfig.aws.region || 'ap-southeast-2';
        const clientId = AppConfig.aws.cognitoClientId;
        const userPoolId = AppConfig.aws.cognitoUserPoolId;

        const missing = [];
        if (!userPoolId) missing.push('cognitoUserPoolId');
        if (!clientId) missing.push('cognitoClientId');

        if (missing.length > 0) {
            throw new Error(
                `Cognito configuration missing: ${missing.join(', ')} must be provided in js/env.js ` +
                `to log in as an organiser with AWS Cognito.`
            );
        }

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
                if (data.__type && data.__type.includes('NewPasswordRequired')) {
                    throw new Error('Password change required. Please set a new permanent password in AWS Cognito Console first.');
                }
                throw new Error(msg);
            }

            const tokens = data.AuthenticationResult;
            if (!tokens || (!tokens.IdToken && !tokens.AccessToken)) {
                throw new Error('Unexpected Cognito response — no authentication tokens received.');
            }

            // Safe JWT payload decoder (works in browser and Node)
            const parseJwt = (tokenStr) => {
                if (!tokenStr || typeof tokenStr !== 'string') return {};
                try {
                    const parts = tokenStr.split('.');
                    if (parts.length < 2) return {};
                    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
                    const jsonStr = typeof atob === 'function'
                        ? decodeURIComponent(escape(atob(base64)))
                        : Buffer.from(base64, 'base64').toString('utf8');
                    return JSON.parse(jsonStr);
                } catch {
                    return {};
                }
            };

            const idPayload = parseJwt(tokens.IdToken);
            const accessPayload = parseJwt(tokens.AccessToken);

            // Extract cognito:groups claim from ID token or Access token
            const rawGroups = idPayload['cognito:groups'] || accessPayload['cognito:groups'] || [];
            const groups = Array.isArray(rawGroups)
                ? rawGroups
                : (typeof rawGroups === 'string'
                    ? rawGroups.replace(/^\[|\]$/g, '').split(',').map(s => s.trim())
                    : []);

            const isOrganiser = groups.some(g => String(g).toLowerCase() === 'organisers');
            if (!isOrganiser) {
                throw new Error('Access denied: You must be a member of the "Organisers" Cognito group to sign in as an organiser.');
            }

            this._accessToken = tokens.AccessToken || null;
            this._idToken = tokens.IdToken || null;
            this._token = tokens.AccessToken || tokens.IdToken;
            this._refreshToken = tokens.RefreshToken || null;
            this._groups = groups;
            this._isLoggedIn = true;
            this._organiser = {
                name: idPayload.name || idPayload['cognito:username'] || accessPayload.username || idPayload.email || username,
                id: idPayload.sub || accessPayload.sub || 'ORG-COGNITO',
                email: idPayload.email || username,
                role: 'organiser',
                groups: groups,
            };

            console.log('[Auth] Cognito organiser login successful as', this._organiser.name);
            return this._organiser;

        } catch (err) {
            console.error('[Auth] Cognito login failed:', err);
            if (err.message && err.message.includes('Failed to fetch')) {
                throw new Error('Cannot reach AWS Cognito. Check your network connection and AWS region.');
            }
            throw err;
        }
    },

    /** Log out the current organiser */
    logout() {
        this._isLoggedIn = false;
        this._organiser = null;
        this._token = null;
        this._accessToken = null;
        this._idToken = null;
        this._refreshToken = null;
        this._groups = [];
        console.log('[Auth] Logged out');
    },

    /** Check if an organiser is currently logged in */
    isLoggedIn() {
        return this._isLoggedIn;
    },

    /**
     * Check if the authenticated user is explicitly an Organiser.
     * Enforces requirement that only Organisers-group users can verify collection.
     */
    isOrganiser() {
        if (!this._isLoggedIn) return false;
        if (this._groups && this._groups.length > 0) {
            return this._groups.some(g => String(g).toLowerCase() === 'organisers');
        }
        return Boolean(this._organiser && this._organiser.role === 'organiser');
    },

    /**
     * Get the Cognito Access Token for API Gateway Authorization.
     * Used in Authorization header for collection verification.
     */
    getAccessToken() {
        return this._accessToken || this._token;
    },

    /**
     * Get the JWT token for API Gateway requests.
     * AwsAdapter calls this to set the Authorization header.
     */
    getToken() {
        return this._accessToken || this._token;
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
