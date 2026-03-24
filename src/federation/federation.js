/**
 * ═══════════════════════════════════════════════════════════════
 *  AETHER FEDERATION – Multi-Server Mesh
 * ═══════════════════════════════════════════════════════════════
 *
 *  Connects multiple Aether servers into a federated mesh.
 *  No single point of failure. Each server can discover and
 *  sync with peers. Content is replicated across federation.
 */

'use strict';

const WebSocket = require('ws');
const crypto = require('crypto');

class FederationManager {
    constructor(store, serverId) {
        this.store = store;
        this.serverId = serverId || crypto.randomUUID().substring(0, 8);
        this.peers = new Map();       // peerId -> { ws, url, connected, lastSeen }
        this.knownServers = new Set(); // URLs of known federation members
        this.syncInterval = null;
    }

    /**
     * Add a federation peer by URL.
     * @param {string} url - WebSocket URL of the peer server, e.g. "ws://192.168.1.100:8080"
     */
    addPeer(url) {
        if (this.knownServers.has(url)) return;
        this.knownServers.add(url);

        const ws = new WebSocket(url);
        const peerId = crypto.createHash('sha256').update(url).digest('hex').substring(0, 8);

        ws.on('open', () => {
            this.peers.set(peerId, { ws, url, connected: true, lastSeen: Date.now() });
            // Announce ourselves
            ws.send(JSON.stringify({
                type: 'federation_hello',
                serverId: this.serverId,
                manifests: this.store.listManifests().map(m => m.contentId),
                names: this.store.listNames().map(n => n.name),
            }));
            console.log(`[FEDERATION] Connected to peer: ${url} (${peerId})`);
        });

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                this._handlePeerMessage(peerId, msg);
            } catch {}
        });

        ws.on('close', () => {
            const peer = this.peers.get(peerId);
            if (peer) peer.connected = false;
            console.log(`[FEDERATION] Lost peer: ${url}`);
            // Reconnect after 30s
            setTimeout(() => this._reconnect(url, peerId), 30000);
        });

        ws.on('error', () => {});
    }

    /**
     * Handle incoming federation WebSocket connection (from another server).
     * @param {WebSocket} ws 
     */
    acceptPeer(ws) {
        const tempId = crypto.randomUUID().substring(0, 8);
        
        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                
                if (msg.type === 'federation_hello') {
                    const peerId = msg.serverId;
                    this.peers.set(peerId, { ws, url: null, connected: true, lastSeen: Date.now() });
                    
                    // Reply with our catalogs
                    ws.send(JSON.stringify({
                        type: 'federation_hello',
                        serverId: this.serverId,
                        manifests: this.store.listManifests().map(m => m.contentId),
                        names: this.store.listNames().map(n => n.name),
                    }));

                    // Sync missing content
                    this._syncWithPeer(peerId, msg);
                    console.log(`[FEDERATION] Accepted peer: ${peerId} | ${msg.manifests?.length || 0} manifests`);
                } else {
                    this._handlePeerMessage(tempId, msg);
                }
            } catch {}
        });
    }

    /**
     * Broadcast a manifest to all federation peers.
     */
    broadcastManifest(manifest) {
        const msg = JSON.stringify({
            type: 'federation_manifest',
            serverId: this.serverId,
            manifest,
        });
        for (const [id, peer] of this.peers) {
            if (peer.connected && peer.ws.readyState === 1) {
                peer.ws.send(msg);
            }
        }
    }

    /**
     * Broadcast a name registration to all peers.
     */
    broadcastName(nameRecord) {
        const msg = JSON.stringify({
            type: 'federation_name',
            serverId: this.serverId,
            name: nameRecord,
        });
        for (const [id, peer] of this.peers) {
            if (peer.connected && peer.ws.readyState === 1) {
                peer.ws.send(msg);
            }
        }
    }

    /**
     * Request a chunk from federation peers.
     */
    requestChunk(hash, callback) {
        let responded = false;
        const msg = JSON.stringify({ type: 'federation_chunk_request', hash, serverId: this.serverId });
        
        for (const [id, peer] of this.peers) {
            if (peer.connected && peer.ws.readyState === 1) {
                peer.ws.send(msg);
            }
        }

        // Set timeout for federation chunk requests
        setTimeout(() => {
            if (!responded) callback(null);
        }, 5000);
    }

    getStats() {
        return {
            serverId: this.serverId,
            totalPeers: this.peers.size,
            connectedPeers: [...this.peers.values()].filter(p => p.connected).length,
            knownServers: this.knownServers.size,
            peers: [...this.peers.entries()].map(([id, p]) => ({
                id,
                url: p.url,
                connected: p.connected,
                lastSeen: p.lastSeen,
            })),
        };
    }

    // Start periodic sync
    startSync(intervalMs = 60000) {
        this.syncInterval = setInterval(() => {
            for (const [id, peer] of this.peers) {
                if (peer.connected && peer.ws.readyState === 1) {
                    peer.ws.send(JSON.stringify({
                        type: 'federation_sync',
                        serverId: this.serverId,
                        manifests: this.store.listManifests().map(m => m.contentId),
                    }));
                }
                peer.lastSeen = Date.now();
            }
        }, intervalMs);
    }

    stop() {
        if (this.syncInterval) clearInterval(this.syncInterval);
        for (const [id, peer] of this.peers) {
            if (peer.ws.readyState === 1) peer.ws.close();
        }
    }

    // ─── INTERNALS ──────────────────────────────────────────

    _handlePeerMessage(peerId, msg) {
        switch (msg.type) {
            case 'federation_manifest': {
                if (!this.store.getManifest(msg.manifest.contentId)) {
                    this.store.saveManifest(msg.manifest.contentId, msg.manifest);
                    console.log(`[FEDERATION] Replicated manifest: ${msg.manifest.contentId}`);
                }
                break;
            }
            case 'federation_name': {
                const existing = this.store.resolveName(msg.name.name);
                if (!existing) {
                    this.store.registerName(msg.name.name, msg.name.contentId, msg.name.owner);
                    console.log(`[FEDERATION] Replicated name: aether://${msg.name.name}.ae`);
                }
                break;
            }
            case 'federation_chunk_request': {
                const chunk = this.store.getChunk(msg.hash);
                const peer = this.peers.get(peerId);
                if (chunk && peer?.ws.readyState === 1) {
                    peer.ws.send(JSON.stringify({
                        type: 'federation_chunk_response',
                        hash: msg.hash,
                        data: chunk.toString('base64'),
                    }));
                }
                break;
            }
            case 'federation_chunk_response': {
                const data = Buffer.from(msg.data, 'base64');
                this.store.saveChunk(msg.hash, data);
                break;
            }
            case 'federation_sync': {
                // Check which manifests the peer is missing
                for (const [contentId, manifest] of this.store.manifestIndex) {
                    if (!msg.manifests.includes(contentId)) {
                        const peer = this.peers.get(peerId);
                        if (peer?.ws.readyState === 1) {
                            peer.ws.send(JSON.stringify({
                                type: 'federation_manifest',
                                serverId: this.serverId,
                                manifest,
                            }));
                        }
                    }
                }
                break;
            }
        }
    }

    _syncWithPeer(peerId, helloMsg) {
        // Request manifests we don't have
        for (const contentId of (helloMsg.manifests || [])) {
            if (!this.store.getManifest(contentId)) {
                const peer = this.peers.get(peerId);
                if (peer?.ws.readyState === 1) {
                    peer.ws.send(JSON.stringify({
                        type: 'federation_request_manifest',
                        contentId,
                    }));
                }
            }
        }
    }

    _reconnect(url, peerId) {
        const peer = this.peers.get(peerId);
        if (peer && !peer.connected) {
            this.knownServers.delete(url);
            this.peers.delete(peerId);
            this.addPeer(url);
        }
    }
}

module.exports = { FederationManager };
