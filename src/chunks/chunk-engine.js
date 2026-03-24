/**
 * ═══════════════════════════════════════════════════════════════
 *  AETHER CHUNK ENGINE – Real File Splitting & Reassembly
 * ═══════════════════════════════════════════════════════════════
 *
 *  Splits files into 256KB chunks, generates SHA-256 hashes,
 *  creates manifests, and reassembles on the receiver side.
 */

'use strict';

const crypto = require('crypto');
const { encodeChunk, encodeParity } = require('../protocol/binary-codec');

const CHUNK_SIZE = 256 * 1024; // 256 KB

class ChunkEngine {
    constructor() {
        this.store = new Map();     // chunkHash -> Buffer
        this.manifests = new Map(); // contentId -> manifest
    }

    /**
     * Split a Buffer into chunks and generate a manifest.
     * @param {Buffer} data - Raw file data
     * @param {string} contentId - Unique content identifier
     * @returns {{ manifest: Object, chunks: Array<{index, hash, data}> }}
     */
    split(data, contentId) {
        const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
        const chunks = [];

        for (let i = 0; i < totalChunks; i++) {
            const start = i * CHUNK_SIZE;
            const end = Math.min(start + CHUNK_SIZE, data.length);
            const slice = data.slice(start, end);
            const hash = crypto.createHash('sha256').update(slice).digest('hex').substring(0, 16);

            chunks.push({ index: i, hash, data: slice });
            this.store.set(hash, slice);
        }

        // Generate XOR parity chunks (simple FEC)
        const parityChunks = this._generateParity(chunks);

        const manifest = {
            contentId,
            totalSize: data.length,
            chunkSize: CHUNK_SIZE,
            totalChunks,
            parityChunks: parityChunks.length,
            integrity: crypto.createHash('sha256').update(data).digest('hex'),
            chunks: chunks.map(c => ({ index: c.index, hash: c.hash, size: c.data.length })),
            parity: parityChunks.map(p => ({ index: p.index, hash: p.hash, covers: p.covers })),
            created: Date.now(),
        };

        this.manifests.set(contentId, manifest);

        // Store parity chunks too
        parityChunks.forEach(p => this.store.set(p.hash, p.data));

        return { manifest, chunks, parityChunks };
    }

    /**
     * Reassemble chunks back into original data using a manifest.
     * @param {string} contentId
     * @param {Map<string, Buffer>} chunkMap - hash -> data
     * @returns {Buffer|null}
     */
    reassemble(contentId, chunkMap) {
        const manifest = this.manifests.get(contentId);
        if (!manifest) return null;

        const buffers = [];
        let missing = [];

        for (const chunkInfo of manifest.chunks) {
            const data = chunkMap.get(chunkInfo.hash) || this.store.get(chunkInfo.hash);
            if (data) {
                buffers.push(data);
            } else {
                missing.push(chunkInfo);
            }
        }

        // Attempt FEC recovery for missing chunks
        if (missing.length > 0 && missing.length <= manifest.parityChunks) {
            for (const m of missing) {
                const recovered = this._recoverChunk(m, manifest, chunkMap);
                if (recovered) {
                    buffers[m.index] = recovered;
                    missing = missing.filter(x => x.index !== m.index);
                }
            }
        }

        if (missing.length > 0) {
            return null; // Cannot recover
        }

        const result = Buffer.concat(buffers);
        
        // Verify integrity
        const hash = crypto.createHash('sha256').update(result).digest('hex');
        if (hash !== manifest.integrity) {
            console.error('[CHUNK] Integrity check FAILED');
            return null;
        }

        return result;
    }

    /**
     * Get a chunk by hash.
     */
    getChunk(hash) {
        return this.store.get(hash) || null;
    }

    /**
     * Get a manifest by contentId.
     */
    getManifest(contentId) {
        return this.manifests.get(contentId) || null;
    }

    /**
     * Encode a chunk for wire transfer using the binary protocol.
     */
    encodeForWire(index, data) {
        return encodeChunk(index, data);
    }

    /**
     * Generate XOR parity chunks for forward error correction.
     * Groups chunks in pairs and XORs them together.
     */
    _generateParity(chunks) {
        const parityChunks = [];
        
        for (let i = 0; i < chunks.length - 1; i += 2) {
            const a = chunks[i].data;
            const b = chunks[i + 1].data;
            const maxLen = Math.max(a.length, b.length);
            const parity = Buffer.alloc(maxLen);

            for (let j = 0; j < maxLen; j++) {
                parity[j] = (a[j] || 0) ^ (b[j] || 0);
            }

            const hash = crypto.createHash('sha256').update(parity).digest('hex').substring(0, 16);
            parityChunks.push({
                index: parityChunks.length,
                hash,
                data: parity,
                covers: [chunks[i].index, chunks[i + 1].index],
            });
        }

        return parityChunks;
    }

    /**
     * Recover a missing chunk using parity data.
     */
    _recoverChunk(missingChunkInfo, manifest, chunkMap) {
        const parityInfo = manifest.parity.find(p => p.covers.includes(missingChunkInfo.index));
        if (!parityInfo) return null;

        const parityData = chunkMap.get(parityInfo.hash) || this.store.get(parityInfo.hash);
        if (!parityData) return null;

        const otherIndex = parityInfo.covers.find(i => i !== missingChunkInfo.index);
        const otherHash = manifest.chunks[otherIndex]?.hash;
        const otherData = chunkMap.get(otherHash) || this.store.get(otherHash);
        if (!otherData) return null;

        // XOR parity with the other chunk to recover the missing one
        const recovered = Buffer.alloc(parityData.length);
        for (let j = 0; j < parityData.length; j++) {
            recovered[j] = parityData[j] ^ (otherData[j] || 0);
        }

        return recovered;
    }

    /**
     * Stats for monitoring.
     */
    getStats() {
        return {
            storedChunks: this.store.size,
            manifests: this.manifests.size,
            totalStoredBytes: [...this.store.values()].reduce((sum, b) => sum + b.length, 0),
        };
    }
}

module.exports = { ChunkEngine, CHUNK_SIZE };
