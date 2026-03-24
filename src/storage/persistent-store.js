/**
 * ═══════════════════════════════════════════════════════════════
 *  AETHER PERSISTENT STORAGE – Disk-backed Chunk & Manifest Store
 * ═══════════════════════════════════════════════════════════════
 *
 *  Survives server restarts. Data lives on disk, indexed in memory.
 *  Uses flat-file storage with SHA-256 hash as filename.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class PersistentStore {
    constructor(baseDir) {
        this.baseDir = baseDir;
        this.chunksDir = path.join(baseDir, 'chunks');
        this.manifestsDir = path.join(baseDir, 'manifests');
        this.namesDir = path.join(baseDir, 'names');
        this.identitiesDir = path.join(baseDir, 'identities');
        this.stateDir = path.join(baseDir, 'state');
        this.indexDir = path.join(baseDir, 'index');

        // Create all directories
        [this.chunksDir, this.manifestsDir, this.namesDir, 
         this.identitiesDir, this.stateDir, this.indexDir].forEach(d => {
            fs.mkdirSync(d, { recursive: true });
        });

        // In-memory indexes (loaded from disk on startup)
        this.manifestIndex = new Map();  // contentId -> manifest
        this.nameIndex = new Map();      // name -> contentId
        this.searchIndex = new Map();    // keyword -> Set<contentId>

        this._loadIndexes();
    }

    // ─── CHUNKS ──────────────────────────────────────────────
    
    saveChunk(hash, data) {
        const filePath = path.join(this.chunksDir, hash);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, data);
        }
        return filePath;
    }

    getChunk(hash) {
        const filePath = path.join(this.chunksDir, hash);
        if (fs.existsSync(filePath)) {
            return fs.readFileSync(filePath);
        }
        return null;
    }

    hasChunk(hash) {
        return fs.existsSync(path.join(this.chunksDir, hash));
    }

    // ─── MANIFESTS ───────────────────────────────────────────

    saveManifest(contentId, manifest) {
        const filePath = path.join(this.manifestsDir, contentId + '.json');
        fs.writeFileSync(filePath, JSON.stringify(manifest, null, 2));
        this.manifestIndex.set(contentId, manifest);
        
        // Auto-index for search
        if (manifest.meta) {
            this._indexContent(contentId, manifest.meta);
        }
    }

    getManifest(contentId) {
        if (this.manifestIndex.has(contentId)) {
            return this.manifestIndex.get(contentId);
        }
        const filePath = path.join(this.manifestsDir, contentId + '.json');
        if (fs.existsSync(filePath)) {
            const manifest = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            this.manifestIndex.set(contentId, manifest);
            return manifest;
        }
        return null;
    }

    listManifests() {
        return [...this.manifestIndex.entries()].map(([id, m]) => ({
            contentId: id,
            totalSize: m.totalSize,
            totalChunks: m.totalChunks,
            created: m.created,
            meta: m.meta || {},
        }));
    }

    // ─── NAMING SYSTEM ──────────────────────────────────────

    registerName(name, contentId, owner) {
        const sanitized = name.toLowerCase().replace(/[^a-z0-9\-_.]/g, '');
        if (this.nameIndex.has(sanitized)) {
            const existing = this.nameIndex.get(sanitized);
            if (existing.owner !== owner) return { error: 'Name already taken' };
        }
        const record = { name: sanitized, contentId, owner, registered: Date.now() };
        fs.writeFileSync(path.join(this.namesDir, sanitized + '.json'), JSON.stringify(record));
        this.nameIndex.set(sanitized, record);
        return record;
    }

    resolveName(name) {
        const sanitized = name.toLowerCase().replace(/[^a-z0-9\-_.]/g, '');
        return this.nameIndex.get(sanitized) || null;
    }

    listNames() {
        return [...this.nameIndex.values()];
    }

    // ─── IDENTITIES ─────────────────────────────────────────

    saveIdentity(publicKey, meta) {
        const id = crypto.createHash('sha256').update(publicKey).digest('hex').substring(0, 16);
        const record = { id, publicKey, meta, created: Date.now() };
        fs.writeFileSync(path.join(this.identitiesDir, id + '.json'), JSON.stringify(record));
        return record;
    }

    getIdentity(id) {
        const filePath = path.join(this.identitiesDir, id + '.json');
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        }
        return null;
    }

    // ─── STATE (Sessions, App State) ────────────────────────

    saveState(key, value) {
        const filePath = path.join(this.stateDir, encodeURIComponent(key) + '.json');
        fs.writeFileSync(filePath, JSON.stringify({ key, value, updated: Date.now() }));
    }

    getState(key) {
        const filePath = path.join(this.stateDir, encodeURIComponent(key) + '.json');
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf-8')).value;
        }
        return null;
    }

    deleteState(key) {
        const filePath = path.join(this.stateDir, encodeURIComponent(key) + '.json');
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    // ─── SEARCH INDEX ───────────────────────────────────────

    search(query) {
        const keywords = query.toLowerCase().split(/\s+/);
        const scores = new Map(); // contentId -> score

        for (const kw of keywords) {
            for (const [indexed, contentIds] of this.searchIndex) {
                if (indexed.includes(kw)) {
                    for (const cid of contentIds) {
                        scores.set(cid, (scores.get(cid) || 0) + 1);
                    }
                }
            }
        }

        return [...scores.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 50)
            .map(([contentId, score]) => ({
                contentId,
                score,
                manifest: this.manifestIndex.get(contentId),
            }));
    }

    // ─── STATS ──────────────────────────────────────────────

    getStats() {
        let chunkCount = 0, totalBytes = 0;
        try {
            const files = fs.readdirSync(this.chunksDir);
            chunkCount = files.length;
            for (const f of files) {
                totalBytes += fs.statSync(path.join(this.chunksDir, f)).size;
            }
        } catch {}

        return {
            chunks: chunkCount,
            manifests: this.manifestIndex.size,
            names: this.nameIndex.size,
            searchTerms: this.searchIndex.size,
            totalStoredBytes: totalBytes,
            totalStoredMB: (totalBytes / 1024 / 1024).toFixed(2),
        };
    }

    // ─── INTERNALS ──────────────────────────────────────────

    _loadIndexes() {
        // Load manifests
        try {
            for (const f of fs.readdirSync(this.manifestsDir)) {
                if (f.endsWith('.json')) {
                    const contentId = f.replace('.json', '');
                    const manifest = JSON.parse(fs.readFileSync(path.join(this.manifestsDir, f), 'utf-8'));
                    this.manifestIndex.set(contentId, manifest);
                    if (manifest.meta) this._indexContent(contentId, manifest.meta);
                }
            }
        } catch {}

        // Load names
        try {
            for (const f of fs.readdirSync(this.namesDir)) {
                if (f.endsWith('.json')) {
                    const record = JSON.parse(fs.readFileSync(path.join(this.namesDir, f), 'utf-8'));
                    this.nameIndex.set(record.name, record);
                }
            }
        } catch {}

        console.log(`[STORAGE] Loaded: ${this.manifestIndex.size} manifests, ${this.nameIndex.size} names`);
    }

    _indexContent(contentId, meta) {
        const text = [meta.title, meta.description, meta.tags].filter(Boolean).join(' ').toLowerCase();
        const words = text.split(/\s+/).filter(w => w.length > 2);
        for (const word of words) {
            if (!this.searchIndex.has(word)) this.searchIndex.set(word, new Set());
            this.searchIndex.get(word).add(contentId);
        }
    }
}

module.exports = { PersistentStore };
