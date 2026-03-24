/**
 * ═══════════════════════════════════════════════════════════════
 *  AETHER NAMING SERVICE (ANS)
 * ═══════════════════════════════════════════════════════════════
 *
 *  aether://name → contentId resolution
 *  Like DNS but decentralized, content-addressed, and immutable.
 *  
 *  Names are verified by Ed25519 signatures from their owner.
 *  Format: aether://my-site.ae
 */

'use strict';

const crypto = require('crypto');
const { AetherIdentity } = require('../crypto/aether-crypto');

class AetherNamingService {
    constructor(store) {
        this.store = store; // PersistentStore instance
    }

    /**
     * Register a name pointing to a contentId.
     * @param {string} name - e.g. "my-site" (becomes my-site.ae)
     * @param {string} contentId - Hash of the content
     * @param {string} ownerFingerprint - Ed25519 fingerprint of owner
     * @param {string} signature - Signature of "name:contentId" by owner
     * @param {string} publicKey - Owner's public key PEM
     * @returns {Object} registration result
     */
    register(name, contentId, ownerFingerprint, signature, publicKey) {
        const sanitized = this._sanitize(name);
        
        if (sanitized.length < 2 || sanitized.length > 64) {
            return { error: 'Name must be 2-64 characters' };
        }

        // Reserved names
        const reserved = ['admin', 'system', 'aether', 'api', 'root', 'node'];
        if (reserved.includes(sanitized)) {
            return { error: 'Name is reserved' };
        }

        // Verify signature
        const message = `${sanitized}:${contentId}`;
        if (publicKey && signature) {
            const valid = AetherIdentity.verify(message, signature, publicKey);
            if (!valid) {
                return { error: 'Invalid signature' };
            }
        }

        // Check existing ownership
        const existing = this.store.resolveName(sanitized);
        if (existing && existing.owner !== ownerFingerprint) {
            return { error: 'Name already owned by another identity' };
        }

        const result = this.store.registerName(sanitized, contentId, ownerFingerprint);
        
        console.log(`[ANS] Registered: aether://${sanitized}.ae → ${contentId}`);
        return { 
            success: true, 
            url: `aether://${sanitized}.ae`,
            contentId,
            owner: ownerFingerprint,
        };
    }

    /**
     * Resolve an aether:// URL to a contentId.
     * @param {string} url - e.g. "aether://my-site.ae" or just "my-site"
     * @returns {Object|null}
     */
    resolve(url) {
        let name = url;
        
        // Strip protocol
        if (name.startsWith('aether://')) name = name.substring(9);
        // Strip .ae suffix
        if (name.endsWith('.ae')) name = name.substring(0, name.length - 3);
        
        const sanitized = this._sanitize(name);
        const record = this.store.resolveName(sanitized);
        
        if (record) {
            return {
                url: `aether://${sanitized}.ae`,
                contentId: record.contentId,
                owner: record.owner,
                registered: record.registered,
            };
        }
        
        return null;
    }

    /**
     * List all registered names.
     */
    list() {
        return this.store.listNames().map(r => ({
            url: `aether://${r.name}.ae`,
            contentId: r.contentId,
            owner: r.owner,
            registered: r.registered,
        }));
    }

    /**
     * Transfer ownership (requires signature from current owner).
     */
    transfer(name, newOwner, currentOwnerSig, currentOwnerPubKey) {
        const sanitized = this._sanitize(name);
        const existing = this.store.resolveName(sanitized);
        if (!existing) return { error: 'Name not found' };

        const message = `transfer:${sanitized}:${newOwner}`;
        if (!AetherIdentity.verify(message, currentOwnerSig, currentOwnerPubKey)) {
            return { error: 'Invalid transfer signature' };
        }

        existing.owner = newOwner;
        this.store.registerName(sanitized, existing.contentId, newOwner);
        return { success: true, newOwner };
    }

    _sanitize(name) {
        return name.toLowerCase().replace(/[^a-z0-9\-_.]/g, '');
    }
}

module.exports = { AetherNamingService };
