/**
 * ═══════════════════════════════════════════════════════════════
 *  AETHER TELEMETRY & COMMERCE BROKER
 * ═══════════════════════════════════════════════════════════════
 *
 *  Verarbeitet legitime, kommerzielle Telemetrie-Daten (Abrechnung,
 *  Werbe-Klicks, Impressionen), um ein funktionierendes,
 *  profitables Ökosystem für Publisher und Konzerne zu schaffen.
 *
 *  Features:
 *  - Anti-Fraud: Verifiziert kryptografische Klick-Beweise (Proof-of-Click)
 *  - Analytics: Aggregiert legitime Nutzungsdaten
 *  - Identity: Verknüpft Telemetrie mit verifizierten Aether-Identitäten
 */

'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class TelemetryBroker {
    constructor(dataDir) {
        this.analyticsDbPath = path.join(dataDir, 'analytics.json');
        this.adFraudDbPath = path.join(dataDir, 'ad-fraud.json');
        
        // In-memory aggregations
        this.metrics = {
            impressions: {},   // componentId -> count
            clicks: {},        // componentId -> count
            demographics: {},  // cohort -> count
            fraudAttempts: 0
        };

        // Track seen signatures to prevent Replay-Attacks (Ad Fraud)
        this.seenSignatures = new Set();
        
        this.load();
    }

    /**
     * Ingests a signed telemetry packet from a client.
     * @param {Object} payload 
     * @param {string} payload.type - 'impression' | 'click' | 'conversion'
     * @param {string} payload.target - The ID/Hash of the ad or component
     * @param {Object} payload.profile - Opt-in demographic profile (e.g. { age: '25-34', segment: 'tech' })
     * @param {number} payload.timestamp
     * @param {string} signature - Ed25519 signature of the payload by the client
     * @param {string} publicKey - The client's verified public key
     */
    ingest(payload, signature, publicKey) {
        // 1. Anti-Fraud Readiness (Replay Attack Prevention)
        if (this.seenSignatures.has(signature)) {
            this.metrics.fraudAttempts++;
            return { error: 'Duplicate telemetry signature. Potential Ad-Fraud blocked.' };
        }

        // 2. Validate Timestamp (max 5 minutes old)
        const now = Date.now();
        if (Math.abs(now - payload.timestamp) > 5 * 60 * 1000) {
            this.metrics.fraudAttempts++;
            return { error: 'Invalid timestamp. Potential replay attack.' };
        }

        // 3. Cryptographic Verification (Proof of View/Click)
        // Ensure that a real, signed client generated this event, not a bot script.
        const msg = JSON.stringify(payload);
        try {
            const key = crypto.createPublicKey(publicKey);
            const isValid = crypto.verify(null, Buffer.from(msg), key, Buffer.from(signature, 'hex'));
            
            if (!isValid) {
                this.metrics.fraudAttempts++;
                return { error: 'Invalid signature. Telemetry discarded.' };
            }
        } catch (e) {
            return { error: 'Cryptographic failure during verification.' };
        }

        // Mark as seen
        this.seenSignatures.add(signature);
        if (this.seenSignatures.size > 100000) this.seenSignatures.clear(); // Basic rotation

        // 4. Record the verified clean data
        this._record(payload);

        // 5. Trigger Billing/Clearing if necessary (Mocked for now)
        if (payload.type === 'click' && payload.isAd) {
            console.log(`[COMMERCE] Billable click generated on ${payload.target} by user ${publicKey.substring(0, 16)}...`);
        }

        return { success: true, status: 'Verified & Logged' };
    }

    _record(payload) {
        const target = payload.target || 'unknown';
        
        if (payload.type === 'impression') {
            this.metrics.impressions[target] = (this.metrics.impressions[target] || 0) + 1;
        } else if (payload.type === 'click') {
            this.metrics.clicks[target] = (this.metrics.clicks[target] || 0) + 1;
        }

        // Aggregate demographic data for advertisers
        if (payload.profile && payload.profile.segment) {
            const seg = payload.profile.segment;
            this.metrics.demographics[seg] = (this.metrics.demographics[seg] || 0) + 1;
        }

        this.save();
    }

    getReport() {
        return this.metrics;
    }

    save() {
        fs.writeFileSync(this.analyticsDbPath, JSON.stringify(this.metrics, null, 2));
    }

    load() {
        try {
            if (fs.existsSync(this.analyticsDbPath)) {
                this.metrics = JSON.parse(fs.readFileSync(this.analyticsDbPath, 'utf8'));
            }
        } catch (e) {
            console.error('[TELEMETRY] Failed to load analytics DB.', e);
        }
    }
}

module.exports = { TelemetryBroker };
