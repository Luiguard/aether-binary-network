/**
 * ═══════════════════════════════════════════════════════════════
 *  AETHER SECURITY MODULE – Hardened Middleware & Protections
 * ═══════════════════════════════════════════════════════════════
 *
 *  1. Rate Limiting per IP (DDoS protection)
 *  2. Input Validation & Sanitization
 *  3. AST Sanitizer (prevents XSS in renderer)
 *  4. API Authentication via Bearer tokens
 *  5. Security Headers
 *  6. Auto-TLS Generation (self-signed for local dev)
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// ─── RATE LIMITER ────────────────────────────────────────────

class RateLimiter {
    constructor(windowMs = 60000, maxRequests = 100) {
        this.windowMs = windowMs;
        this.maxRequests = maxRequests;
        this.clients = new Map(); // hashedIP -> { count, resetTime }
    }

    /**
     * Check if a request should be allowed.
     * @param {string} ip - Client IP (will be hashed for GDPR)
     * @returns {{ allowed: boolean, remaining: number, retryAfter?: number }}
     */
    check(ip) {
        const hash = this._hashIP(ip);
        const now = Date.now();
        let client = this.clients.get(hash);

        if (!client || now > client.resetTime) {
            client = { count: 0, resetTime: now + this.windowMs };
            this.clients.set(hash, client);
        }

        client.count++;

        if (client.count > this.maxRequests) {
            return {
                allowed: false,
                remaining: 0,
                retryAfter: Math.ceil((client.resetTime - now) / 1000),
            };
        }

        return { allowed: true, remaining: this.maxRequests - client.count };
    }

    // GDPR: Never store raw IPs
    _hashIP(ip) {
        return crypto.createHash('sha256').update(ip + 'aether-salt-2024').digest('hex').substring(0, 12);
    }

    // Cleanup expired entries every 5min
    startCleanup() {
        setInterval(() => {
            const now = Date.now();
            for (const [hash, client] of this.clients) {
                if (now > client.resetTime) this.clients.delete(hash);
            }
        }, 5 * 60 * 1000);
    }
}

// ─── AST SANITIZER (prevents XSS in Binary Renderer) ────────

const ALLOWED_COMPONENTS = new Set([
    'Button', 'Text', 'Input', 'TextInput', 'Image', 'Icon',
    'Row', 'Col', 'Panel', 'Nav', 'NavItem', 'Alert', 'Badge',
    'Table', 'ProgressBar', 'Slider', 'Form', 'Grid', 'List',
    'ListItem', 'Switch', 'Checkbox', 'Select', 'Option',
    'Divider', 'Carousel', 'Card', 'Container', 'View',
    'VideoPlayer', 'Msg', 'MessageBubble', 'Graph', 'Stepper', 'Slot',
]);

const DANGEROUS_PROPS = [
    'onclick', 'onerror', 'onload', 'onmouseover', 'onfocus',
    'innerHTML', 'outerHTML', 'dangerouslySetInnerHTML',
];

const DANGEROUS_PROTOCOLS = ['javascript:', 'data:text/html', 'vbscript:'];

function sanitizeAST(ast) {
    if (!Array.isArray(ast) || ast[0] !== 1) return null;

    const [magic, componentName, props = {}, children] = ast;

    // Validate component name
    if (typeof componentName !== 'string' || !ALLOWED_COMPONENTS.has(componentName)) {
        return null;
    }

    // Sanitize props
    const cleanProps = {};
    for (const [key, value] of Object.entries(props)) {
        // Block event handlers
        if (DANGEROUS_PROPS.includes(key.toLowerCase())) continue;
        
        // Block dangerous protocols in URLs
        if (typeof value === 'string') {
            const lower = value.toLowerCase().trim();
            if (DANGEROUS_PROTOCOLS.some(p => lower.startsWith(p))) continue;
        }
        
        // Block excessively long values (DoS)
        if (typeof value === 'string' && value.length > 10000) continue;
        
        cleanProps[key] = value;
    }

    // Recursively sanitize children
    let cleanChildren = null;
    if (Array.isArray(children)) {
        cleanChildren = children
            .map(child => sanitizeAST(child))
            .filter(Boolean);
    }

    return [1, componentName, cleanProps, cleanChildren];
}

// ─── INPUT VALIDATION ────────────────────────────────────────

function validateNameInput(name) {
    if (typeof name !== 'string') return 'Name must be a string';
    if (name.length < 2) return 'Name too short (min 2 chars)';
    if (name.length > 64) return 'Name too long (max 64 chars)';
    if (/[^a-zA-Z0-9\-_.]/.test(name)) return 'Name contains invalid characters';
    return null;
}

function validateContentId(id) {
    if (typeof id !== 'string') return 'Invalid content ID';
    if (id.length < 4 || id.length > 64) return 'Content ID wrong length';
    if (/[^a-fA-F0-9]/.test(id)) return 'Content ID must be hex';
    return null;
}

function validateUploadSize(bytes, maxMB = 100) {
    if (bytes > maxMB * 1024 * 1024) return `File too large (max ${maxMB} MB)`;
    return null;
}

// ─── SECURITY HEADERS ────────────────────────────────────────

function securityHeaders() {
    return {
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:",
        'Referrer-Policy': 'no-referrer',
        'Permissions-Policy': 'geolocation=(), camera=(), microphone=()',
    };
}

// ─── TLS CERTIFICATE GENERATION ──────────────────────────────

function generateSelfSignedCert(certDir) {
    const certPath = path.join(certDir, 'aether.crt');
    const keyPath = path.join(certDir, 'aether.key');

    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        return { cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) };
    }

    // Generate using Node.js crypto (self-signed)
    const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Self-signed certificate (simplified – production should use Let's Encrypt)
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(keyPath, privateKey);

    // Note: For a proper X.509 cert we'd need openssl or a library like node-forge
    // For now, save the key and indicate that manual cert setup is needed for HTTPS
    console.log(`[SECURITY] RSA-2048 key generated at: ${keyPath}`);
    console.log('[SECURITY] For HTTPS: provide your own cert or use: npx devcert-cli generate aether');

    return { key: privateKey, certPath, keyPath };
}

// ─── API TOKEN AUTH ──────────────────────────────────────────

class APIKeyStore {
    constructor(storePath) {
        this.storePath = storePath;
        this.keys = new Map(); // keyHash -> { name, permissions, created }
        this._load();
    }

    generate(name, permissions = ['read', 'write']) {
        const key = 'ae_' + crypto.randomBytes(24).toString('hex');
        const hash = crypto.createHash('sha256').update(key).digest('hex');
        this.keys.set(hash, { name, permissions, created: Date.now() });
        this._save();
        return { key, name, permissions }; // Key shown once, only hash stored
    }

    validate(bearerToken) {
        if (!bearerToken || !bearerToken.startsWith('ae_')) return null;
        const hash = crypto.createHash('sha256').update(bearerToken).digest('hex');
        return this.keys.get(hash) || null;
    }

    hasPermission(bearerToken, perm) {
        const info = this.validate(bearerToken);
        return info && info.permissions.includes(perm);
    }

    _load() {
        try {
            if (fs.existsSync(this.storePath)) {
                const data = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
                this.keys = new Map(Object.entries(data));
            }
        } catch {}
    }

    _save() {
        fs.writeFileSync(this.storePath, JSON.stringify(Object.fromEntries(this.keys), null, 2));
    }
}

// ─── FEDERATION AUTHENTICATOR ────────────────────────────────

class FederationAuth {
    constructor() {
        this.trustedPeers = new Map(); // peerId -> publicKey
        this.ourKeyPair = null;
    }

    init() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        this.ourKeyPair = {
            publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
            privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
        };
        return this.ourKeyPair.publicKey;
    }

    signChallenge(challenge) {
        const key = crypto.createPrivateKey(this.ourKeyPair.privateKey);
        return crypto.sign(null, Buffer.from(challenge), key).toString('hex');
    }

    verifyPeer(peerId, challenge, signature, publicKeyPem) {
        try {
            const key = crypto.createPublicKey(publicKeyPem);
            const valid = crypto.verify(null, Buffer.from(challenge), key, Buffer.from(signature, 'hex'));
            if (valid) this.trustedPeers.set(peerId, publicKeyPem);
            return valid;
        } catch {
            return false;
        }
    }

    isTrusted(peerId) {
        return this.trustedPeers.has(peerId);
    }
}

module.exports = {
    RateLimiter,
    sanitizeAST,
    ALLOWED_COMPONENTS,
    validateNameInput,
    validateContentId,
    validateUploadSize,
    securityHeaders,
    generateSelfSignedCert,
    APIKeyStore,
    FederationAuth,
};
