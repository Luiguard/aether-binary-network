/**
 * ═══════════════════════════════════════════════════════════════
 *  ZERO-TRUST ENGINE – Decentralized Reputation System
 * ═══════════════════════════════════════════════════════════════
 * 
 *  No central authority. Trust emerges from mathematical proofs.
 *  Every node calculates and broadcasts trust adjustments based
 *  on verifiable behavior (hash matches, latency, poisoned data).
 */

'use strict';

const crypto = require('crypto');

// ─── CONFIG ──────────────────────────────────────────────────

const TRUST_CONFIG = {
    BASE_SCORE:           100,
    MAX_SCORE:            1000,
    ISOLATION_THRESHOLD:  50,
    
    // Proof of Work (Anti-Sybil)
    POW_DIFFICULTY:       3,     // Leading zeros in SHA-256
    POW_PREFIX:           'AETHER_BINARY_',
    
    // Score adjustments
    REWARD_VALID_CHUNK:   +2,
    REWARD_RELAY:         +1,
    PENALTY_POISONED:     -50,
    PENALTY_SYBIL:        -80,
    PENALTY_INVALID_MSG:  -10,
    PENALTY_TIMEOUT:      -5,
};

// ─── PROOF OF WORK ───────────────────────────────────────────

function generateChallenge() {
    return TRUST_CONFIG.POW_PREFIX + crypto.randomUUID();
}

function verifyPoW(challenge, nonce) {
    const hash = crypto.createHash('sha256')
        .update(challenge + String(nonce))
        .digest('hex');
    return hash.startsWith('0'.repeat(TRUST_CONFIG.POW_DIFFICULTY));
}

// ─── TRUST LEDGER ────────────────────────────────────────────

class TrustLedger {
    constructor() {
        this.scores = new Map();   // nodeId -> score
        this.isolated = new Set(); // Set of isolated node IDs
        this.history = [];         // Audit trail (last 1000 events)
    }
    
    /**
     * Register a new node with base trust.
     */
    register(nodeId) {
        this.scores.set(nodeId, TRUST_CONFIG.BASE_SCORE);
    }
    
    /**
     * Get trust score for a node.
     */
    getScore(nodeId) {
        return this.scores.get(nodeId) ?? 0;
    }
    
    /**
     * Adjust trust score. Returns new score.
     */
    adjust(nodeId, delta, reason = '') {
        if (this.isolated.has(nodeId)) return 0;
        
        const current = this.scores.get(nodeId) ?? TRUST_CONFIG.BASE_SCORE;
        const newScore = Math.max(0, Math.min(TRUST_CONFIG.MAX_SCORE, current + delta));
        this.scores.set(nodeId, newScore);
        
        // Audit log
        this._log(nodeId, delta, reason, newScore);
        
        // Auto-isolation check
        if (newScore < TRUST_CONFIG.ISOLATION_THRESHOLD) {
            this.isolate(nodeId);
        }
        
        return newScore;
    }
    
    /**
     * Isolate a malicious node.
     */
    isolate(nodeId) {
        this.isolated.add(nodeId);
        this._log(nodeId, 0, 'AUTO_ISOLATION', this.getScore(nodeId));
        return true;
    }
    
    /**
     * Check if a node is isolated.
     */
    isIsolated(nodeId) {
        return this.isolated.has(nodeId);
    }
    
    /**
     * Check if a node is trustworthy enough for operations.
     */
    isTrusted(nodeId) {
        return !this.isolated.has(nodeId) && 
               this.getScore(nodeId) >= TRUST_CONFIG.ISOLATION_THRESHOLD;
    }
    
    /**
     * Remove a node entirely (on disconnect).
     */
    remove(nodeId) {
        this.scores.delete(nodeId);
        this.isolated.delete(nodeId);
    }
    
    /**
     * Validate a trust report (anti-manipulation of reporters).
     * @param {string} reporterId 
     * @param {string} targetId 
     * @param {Set<string>} activeSessions – Set of session keys
     */
    validateReport(reporterId, targetId, activeSessions) {
        // Anti-Sybil: Reporter must have an active session with the target
        const sessionKey = [reporterId, targetId].sort().join('_');
        if (!activeSessions.has(sessionKey)) {
            // Fake report – penalize the reporter
            this.adjust(reporterId, -100, 'SYBIL_FAKE_REPORT');
            return false;
        }
        return true;
    }
    
    /**
     * Get all trusted node IDs.
     */
    getTrustedNodes() {
        const trusted = [];
        for (const [id, score] of this.scores) {
            if (!this.isolated.has(id) && score >= TRUST_CONFIG.ISOLATION_THRESHOLD) {
                trusted.push({ id, score });
            }
        }
        return trusted;
    }
    
    /**
     * Get statistics.
     */
    getStats() {
        return {
            totalNodes: this.scores.size,
            isolatedNodes: this.isolated.size,
            avgScore: this.scores.size > 0 
                ? Math.round([...this.scores.values()].reduce((a, b) => a + b, 0) / this.scores.size) 
                : 0,
            recentEvents: this.history.slice(-10),
        };
    }
    
    _log(nodeId, delta, reason, newScore) {
        const entry = {
            ts: Date.now(),
            nodeId: nodeId.substring(0, 8),
            delta,
            reason,
            newScore,
        };
        this.history.push(entry);
        if (this.history.length > 1000) this.history.shift();
    }
    
    /**
     * Persist memory to disk.
     */
    persist(filePath) {
        try {
            const fs = require('fs');
            const data = {
                scores: Array.from(this.scores.entries()),
                isolated: Array.from(this.isolated)
            };
            fs.writeFileSync(filePath, JSON.stringify(data));
        } catch (err) {}
    }
    
    /**
     * Restore memory from disk.
     */
    load(filePath) {
        try {
            const fs = require('fs');
            if (!fs.existsSync(filePath)) return;
            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            if (data.scores) this.scores = new Map(data.scores);
            if (data.isolated) this.isolated = new Set(data.isolated);
            console.log(`[TRUST] Memory restored: ${this.scores.size} identities, ${this.isolated.size} isolated.`);
        } catch (err) {}
    }
}

module.exports = { TrustLedger, TRUST_CONFIG, generateChallenge, verifyPoW };
