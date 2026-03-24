/**
 * ═══════════════════════════════════════════════════════════════
 *  AETHER CRYPTO – Identity, Signatures, E2E Encryption
 * ═══════════════════════════════════════════════════════════════
 *
 *  Ed25519 keypairs for identity, X25519 for key exchange,
 *  AES-256-GCM for payload encryption.
 *  
 *  Every node gets a persistent cryptographic identity.
 *  Every message can be end-to-end encrypted.
 */

'use strict';

const crypto = require('crypto');

// ─── IDENTITY (Ed25519 Keypairs) ─────────────────────────────

class AetherIdentity {
    /**
     * Generate a new Ed25519 identity keypair.
     * @returns {{ publicKey: string, privateKey: string, fingerprint: string }}
     */
    static generate() {
        const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
        
        const pubPem = publicKey.export({ type: 'spki', format: 'pem' });
        const privPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
        const fingerprint = crypto.createHash('sha256')
            .update(publicKey.export({ type: 'spki', format: 'der' }))
            .digest('hex').substring(0, 16);

        return { publicKey: pubPem, privateKey: privPem, fingerprint };
    }

    /**
     * Sign data with a private key.
     * @param {string|Buffer} data 
     * @param {string} privateKeyPem 
     * @returns {string} hex signature
     */
    static sign(data, privateKeyPem) {
        const key = crypto.createPrivateKey(privateKeyPem);
        const sig = crypto.sign(null, Buffer.from(data), key);
        return sig.toString('hex');
    }

    /**
     * Verify a signature.
     * @param {string|Buffer} data 
     * @param {string} signature hex
     * @param {string} publicKeyPem 
     * @returns {boolean}
     */
    static verify(data, signature, publicKeyPem) {
        try {
            const key = crypto.createPublicKey(publicKeyPem);
            return crypto.verify(null, Buffer.from(data), key, Buffer.from(signature, 'hex'));
        } catch {
            return false;
        }
    }

    /**
     * Derive a fingerprint from a public key.
     */
    static fingerprint(publicKeyPem) {
        const key = crypto.createPublicKey(publicKeyPem);
        return crypto.createHash('sha256')
            .update(key.export({ type: 'spki', format: 'der' }))
            .digest('hex').substring(0, 16);
    }
}

// ─── E2E ENCRYPTION (AES-256-GCM) ───────────────────────────

class AetherCrypto {
    /**
     * Generate a random 256-bit symmetric key.
     * @returns {Buffer}
     */
    static generateKey() {
        return crypto.randomBytes(32);
    }

    /**
     * Encrypt data with AES-256-GCM.
     * @param {Buffer|string} plaintext 
     * @param {Buffer} key - 32 bytes
     * @returns {{ ciphertext: Buffer, iv: Buffer, tag: Buffer }}
     */
    static encrypt(plaintext, key) {
        const iv = crypto.randomBytes(12); // 96-bit nonce
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        
        const encrypted = Buffer.concat([
            cipher.update(Buffer.from(plaintext)),
            cipher.final()
        ]);
        const tag = cipher.getAuthTag();

        return { ciphertext: encrypted, iv, tag };
    }

    /**
     * Decrypt AES-256-GCM ciphertext.
     * @returns {Buffer} plaintext
     */
    static decrypt(ciphertext, key, iv, tag) {
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(tag);
        
        return Buffer.concat([
            decipher.update(ciphertext),
            decipher.final()
        ]);
    }

    /**
     * Encrypt a binary frame for wire transfer.
     * Prepends: [IV(12)][TAG(16)][CIPHERTEXT]
     * @param {Buffer} plaintext 
     * @param {Buffer} key 
     * @returns {Buffer}
     */
    static encryptFrame(plaintext, key) {
        const { ciphertext, iv, tag } = AetherCrypto.encrypt(plaintext, key);
        return Buffer.concat([iv, tag, ciphertext]);
    }

    /**
     * Decrypt a wire frame.
     * @param {Buffer} frame - [IV(12)][TAG(16)][CIPHERTEXT]
     * @param {Buffer} key 
     * @returns {Buffer}
     */
    static decryptFrame(frame, key) {
        const iv = frame.slice(0, 12);
        const tag = frame.slice(12, 28);
        const ciphertext = frame.slice(28);
        return AetherCrypto.decrypt(ciphertext, key, iv, tag);
    }

    /**
     * Derive a shared secret from two node IDs (simplified DH).
     * For real production: use X25519 ECDH.
     * @param {string} mySecret - Node's private material
     * @param {string} peerPublic - Peer's public identifier
     * @returns {Buffer} 32-byte shared key
     */
    static deriveSharedKey(mySecret, peerPublic) {
        return crypto.createHash('sha256')
            .update(mySecret + peerPublic)
            .digest();
    }

    /**
     * Hash data with SHA-256.
     */
    static hash(data) {
        return crypto.createHash('sha256').update(Buffer.from(data)).digest('hex');
    }
}

// ─── SESSION TOKENS ──────────────────────────────────────────

class SessionManager {
    constructor() {
        this.sessions = new Map(); // token -> { identity, created, data }
    }

    create(identity, data = {}) {
        const token = crypto.randomBytes(32).toString('hex');
        this.sessions.set(token, {
            identity,
            created: Date.now(),
            lastActive: Date.now(),
            data,
        });
        return token;
    }

    validate(token) {
        const session = this.sessions.get(token);
        if (!session) return null;
        
        // 24h expiry
        if (Date.now() - session.lastActive > 24 * 60 * 60 * 1000) {
            this.sessions.delete(token);
            return null;
        }
        
        session.lastActive = Date.now();
        return session;
    }

    destroy(token) {
        this.sessions.delete(token);
    }

    setData(token, key, value) {
        const session = this.sessions.get(token);
        if (session) session.data[key] = value;
    }

    getData(token, key) {
        const session = this.sessions.get(token);
        return session?.data?.[key] ?? null;
    }

    getStats() {
        return {
            activeSessions: this.sessions.size,
            oldest: this.sessions.size > 0 
                ? Date.now() - Math.min(...[...this.sessions.values()].map(s => s.created))
                : 0,
        };
    }
}

module.exports = { AetherIdentity, AetherCrypto, SessionManager };
