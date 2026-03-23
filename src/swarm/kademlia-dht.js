/**
 * ═══════════════════════════════════════════════════════════════
 *  KADEMLIA DHT – Distributed Hash Table for Swarm Node Discovery
 * ═══════════════════════════════════════════════════════════════
 * 
 *  GDPR-compliant node matching. Server NEVER stores GPS/IP.
 *  Uses obfuscated 4-char GeoHash derived from timezone only.
 *  K-Bucket architecture limits connections to K closest nodes.
 */

'use strict';

const K_BUCKET_SIZE = 5; // Max nodes per geo-cell

class KademliaDHT {
    constructor() {
        this.buckets = new Map(); // geoHash -> Set<nodeId>
        this.nodeGeo = new Map(); // nodeId -> geoHash
    }
    
    /**
     * Register a node in the DHT.
     * @param {string} nodeId 
     * @param {string} geoHash – Obfuscated 4-char geo identifier
     */
    register(nodeId, geoHash) {
        if (!this.buckets.has(geoHash)) {
            this.buckets.set(geoHash, new Set());
        }
        this.buckets.get(geoHash).add(nodeId);
        this.nodeGeo.set(nodeId, geoHash);
    }
    
    /**
     * Find up to K closest swarm nodes.
     * Uses exact bucket match first, then relaxed radius.
     * @param {string} nodeId 
     * @param {string} geoHash 
     * @param {Function} filterFn – Optional filter (e.g., exclude isolated nodes)
     * @returns {string[]} Array of peer IDs
     */
    findPeers(nodeId, geoHash, filterFn = () => true) {
        const matches = [];
        
        // 1. Exact bucket match
        const cell = this.buckets.get(geoHash);
        if (cell) {
            for (const peerId of cell) {
                if (peerId !== nodeId && filterFn(peerId)) {
                    matches.push(peerId);
                    if (matches.length >= K_BUCKET_SIZE) return matches;
                }
            }
        }
        
        // 2. Relaxed radius (broader geo prefix)
        if (matches.length < K_BUCKET_SIZE && geoHash.length > 1) {
            const broadGeo = geoHash.substring(0, geoHash.length - 1);
            for (const [key, bSet] of this.buckets.entries()) {
                if (key !== geoHash && key.startsWith(broadGeo)) {
                    for (const peerId of bSet) {
                        if (peerId !== nodeId && filterFn(peerId)) {
                            matches.push(peerId);
                            if (matches.length >= K_BUCKET_SIZE) return matches;
                        }
                    }
                }
            }
        }
        
        // 3. Global fallback (if geo region is too sparse)
        if (matches.length < 2) {
            for (const [key, bSet] of this.buckets.entries()) {
                for (const peerId of bSet) {
                    if (peerId !== nodeId && filterFn(peerId) && !matches.includes(peerId)) {
                        matches.push(peerId);
                        if (matches.length >= K_BUCKET_SIZE) return matches;
                    }
                }
            }
        }
        
        return matches;
    }
    
    /**
     * Remove a node from the DHT.
     */
    remove(nodeId) {
        const geo = this.nodeGeo.get(nodeId);
        if (geo && this.buckets.has(geo)) {
            this.buckets.get(geo).delete(nodeId);
            if (this.buckets.get(geo).size === 0) {
                this.buckets.delete(geo);
            }
        }
        this.nodeGeo.delete(nodeId);
    }
    
    /**
     * Get DHT statistics.
     */
    getStats() {
        let totalNodes = 0;
        for (const bSet of this.buckets.values()) totalNodes += bSet.size;
        return {
            totalBuckets: this.buckets.size,
            totalNodes,
            bucketDistribution: Object.fromEntries(
                [...this.buckets.entries()].map(([k, v]) => [k, v.size])
            ),
        };
    }
}

module.exports = { KademliaDHT, K_BUCKET_SIZE };
