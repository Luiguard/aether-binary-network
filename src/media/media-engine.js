/**
 * ═══════════════════════════════════════════════════════════════
 *  AETHER MEDIA STREAMING – Binary Chunk-based Media Delivery
 * ═══════════════════════════════════════════════════════════════
 *
 *  Streams video/audio as binary chunks over the swarm.
 *  Supports HTTP Range requests for seeking.
 *  Integrates with ChunkEngine for FEC-protected delivery.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STREAM_CHUNK = 512 * 1024; // 512KB for streaming

const MEDIA_TYPES = {
    '.mp4':  'video/mp4',
    '.webm': 'video/webm',
    '.mp3':  'audio/mpeg',
    '.ogg':  'audio/ogg',
    '.wav':  'audio/wav',
    '.flac': 'audio/flac',
    '.png':  'image/png',
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.svg':  'image/svg+xml',
    '.pdf':  'application/pdf',
};

class MediaEngine {
    constructor(chunkEngine, store) {
        this.chunkEngine = chunkEngine;
        this.store = store;
        this.mediaDir = path.join(store.baseDir, 'media');
        fs.mkdirSync(this.mediaDir, { recursive: true });
        this.catalog = new Map(); // contentId -> media meta
        this._loadCatalog();
    }

    /**
     * Ingest a media file: chunk it, store it, and catalog it.
     * @param {Buffer} data - Raw file data
     * @param {string} filename - Original filename
     * @param {Object} meta - Additional metadata (title, description)
     * @returns {Object} Ingest result
     */
    ingest(data, filename, meta = {}) {
        const ext = path.extname(filename).toLowerCase();
        const mimeType = MEDIA_TYPES[ext] || 'application/octet-stream';
        const contentId = crypto.createHash('sha256').update(data).digest('hex').substring(0, 12);

        // Split into chunks with FEC
        const { manifest, chunks, parityChunks } = this.chunkEngine.split(data, contentId);

        // Store all chunks persistently
        for (const chunk of chunks) {
            this.store.saveChunk(chunk.hash, chunk.data);
        }
        for (const parity of parityChunks) {
            this.store.saveChunk(parity.hash, parity.data);
        }

        // Enrich manifest with media metadata
        manifest.meta = {
            filename,
            mimeType,
            title: meta.title || filename,
            description: meta.description || '',
            tags: meta.tags || '',
            type: mimeType.startsWith('video') ? 'video' : 
                  mimeType.startsWith('audio') ? 'audio' :
                  mimeType.startsWith('image') ? 'image' : 'file',
        };

        // Save manifest and raw file for streaming
        this.store.saveManifest(contentId, manifest);
        fs.writeFileSync(path.join(this.mediaDir, contentId + ext), data);
        
        this.catalog.set(contentId, manifest.meta);

        console.log(`[MEDIA] Ingested: ${filename} (${mimeType}) → ${contentId} | ${chunks.length} chunks`);

        return {
            contentId,
            url: `/api/media/stream/${contentId}`,
            mimeType,
            totalSize: data.length,
            chunks: chunks.length,
            parity: parityChunks.length,
        };
    }

    /**
     * Handle an HTTP Range request for media streaming.
     * @param {string} contentId 
     * @param {Object} req - HTTP request
     * @param {Object} res - HTTP response
     */
    stream(contentId, req, res) {
        const manifest = this.store.getManifest(contentId);
        if (!manifest) {
            res.writeHead(404);
            return res.end('Media not found');
        }

        // Find the actual file on disk
        const ext = path.extname(manifest.meta.filename).toLowerCase();
        const filePath = path.join(this.mediaDir, contentId + ext);
        
        if (!fs.existsSync(filePath)) {
            res.writeHead(404);
            return res.end('Media file missing');
        }

        const stat = fs.statSync(filePath);
        const fileSize = stat.size;
        const mimeType = manifest.meta.mimeType;
        const range = req.headers.range;

        if (range) {
            // Range request (seeking)
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunkSize = end - start + 1;

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': mimeType,
                'Access-Control-Allow-Origin': '*',
            });

            fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
            // Full file
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': mimeType,
                'Accept-Ranges': 'bytes',
                'Access-Control-Allow-Origin': '*',
            });

            fs.createReadStream(filePath).pipe(res);
        }
    }

    /**
     * Get media catalog.
     */
    getCatalog() {
        return [...this.catalog.entries()].map(([id, meta]) => ({
            contentId: id,
            url: `/api/media/stream/${id}`,
            ...meta,
        }));
    }

    _loadCatalog() {
        for (const [id, manifest] of this.store.manifestIndex) {
            if (manifest.meta?.mimeType) {
                this.catalog.set(id, manifest.meta);
            }
        }
    }
}

module.exports = { MediaEngine, MEDIA_TYPES };
