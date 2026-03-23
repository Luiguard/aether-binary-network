/**
 * ═══════════════════════════════════════════════════════════════════════
 *  AETHER BINARY NETWORK – Unified Signaling & Edge Server
 * ═══════════════════════════════════════════════════════════════════════
 * 
 *  The single entry point for the entire system.
 *  Combines:
 *    - WebSocket Signaling (Swarm handshake relay)
 *    - Kademlia DHT (GDPR-compliant node discovery)
 *    - Zero-Trust Engine (PoW + reputation)
 *    - Resource Governor (0.3% enforcement)
 *    - Binary Protocol (MsgPack wire format)
 *    - REST API for stats/admin
 *    - Static file serving for the dashboard UI
 * 
 *  Usage: node src/server.js
 *  Port:  8080 (configurable via PORT env)
 */

'use strict';

const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// ─── INTERNAL MODULES ────────────────────────────────────────
const { encodeControl, decode, MSG_TYPE } = require('./protocol/binary-codec');
const { ResourceGovernor }                = require('./limiter/resource-governor');
const { TrustLedger, TRUST_CONFIG, generateChallenge, verifyPoW } = require('./trust/zero-trust');
const { KademliaDHT }                     = require('./swarm/kademlia-dht');
const { assignRole, getRoleInfo, ROLES }  = require('./swarm/role-evaluator');

// ─── STATE ───────────────────────────────────────────────────
const nodes = new Map();       // nodeId -> { ws, role, verified, geoHash, challenge }
const sessions = new Set();    // Set of "idA_idB" session keys
const dht = new KademliaDHT();
const trust = new TrustLedger();
const governor = new ResourceGovernor();

// ─── MIME TYPES ──────────────────────────────────────────────
const MIME = {
    '.html': 'text/html',
    '.js':   'application/javascript',
    '.css':  'text/css',
    '.json': 'application/json',
    '.wgsl': 'text/plain',
    '.png':  'image/png',
    '.svg':  'image/svg+xml',
    '.ico':  'image/x-icon',
    '.woff2':'font/woff2',
};

// ─── HTTP SERVER (Static + API) ──────────────────────────────

const publicDir = path.join(__dirname, '..', 'public');

const server = http.createServer((req, res) => {
    // API Routes
    if (req.url === '/api/stats') {
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        });
        return res.end(JSON.stringify({
            swarm: {
                totalNodes: nodes.size,
                verifiedNodes: [...nodes.values()].filter(n => n.verified).length,
                roles: {
                    nexus: [...nodes.values()].filter(n => n.role === ROLES.NEXUS).length,
                    sigma: [...nodes.values()].filter(n => n.role === ROLES.SIGMA).length,
                    alpha: [...nodes.values()].filter(n => n.role === ROLES.ALPHA).length,
                    omega: [...nodes.values()].filter(n => n.role === ROLES.OMEGA).length,
                },
            },
            dht: dht.getStats(),
            trust: trust.getStats(),
            governor: governor.getSnapshot(),
            uptime: process.uptime(),
        }));
    }
    
    if (req.url === '/api/protocol') {
        res.writeHead(200, { 
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        });
        return res.end(JSON.stringify({
            name: 'Aether Binary Protocol',
            version: '1.0.0',
            magic: '0xAE',
            types: { CONTROL: 0x01, CHUNK: 0x02, PARITY: 0x03, TRUST: 0x04 },
            encoding: 'MessagePack',
            transport: 'WebSocket/Binary + WebRTC DataChannel',
            limits: governor.profile.limits,
        }));
    }
    
    // Static file serving
    let filePath = req.url === '/' ? '/index.html' : req.url;
    filePath = path.join(publicDir, filePath);
    
    // Security: prevent path traversal
    if (!filePath.startsWith(publicDir)) {
        res.writeHead(403);
        return res.end('Forbidden');
    }
    
    const ext = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            return res.end('Not Found');
        }
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
});

// ─── WEBSOCKET SIGNALING ─────────────────────────────────────

const wss = new WebSocketServer({ server });

function broadcastBinary(msg, excludeId = null) {
    const frame = encodeControl(msg);
    nodes.forEach((node, id) => {
        if (id !== excludeId && node.verified && !trust.isIsolated(id) && node.ws.readyState === 1) {
            node.ws.send(frame);
        }
    });
}

function sendBinary(ws, msg) {
    if (ws.readyState === 1) {
        ws.send(encodeControl(msg));
    }
}

wss.on('connection', (ws) => {
    const id = crypto.randomUUID();
    const challenge = generateChallenge();
    
    // Register node
    nodes.set(id, {
        ws,
        role: ROLES.OMEGA,
        verified: false,
        geoHash: null,
        challenge,
    });
    trust.register(id);
    
    // Send challenge (binary encoded)
    sendBinary(ws, {
        type: 'challenge',
        id,
        challenge,
        difficulty: TRUST_CONFIG.POW_DIFFICULTY,
    });
    
    console.log(`[CONNECT] Node ${id.substring(0, 8)}... | Nodes: ${nodes.size}`);
    
    ws.on('message', (raw) => {
        try {
            // Decode incoming (supports both binary & legacy JSON)
            let msg;
            if (raw instanceof Buffer || raw instanceof Uint8Array) {
                const decoded = decode(raw);
                if (!decoded) return;
                msg = decoded.payload;
            } else {
                msg = JSON.parse(raw.toString());
            }
            
            const sender = nodes.get(id);
            if (!sender || trust.isIsolated(id)) return;
            
            // PoW Verification
            if (msg.type === 'verify_pow') {
                if (verifyPoW(sender.challenge, msg.nonce)) {
                    sender.verified = true;
                    sendBinary(ws, { type: 'welcome', id });
                    console.log(`[VERIFIED] Node ${id.substring(0, 8)}... passed PoW`);
                } else {
                    console.warn(`[REJECTED] Node ${id.substring(0, 8)}... failed PoW`);
                    ws.close();
                }
                return;
            }
            
            // Everything below requires verification
            if (!sender.verified) return;
            
            switch (msg.type) {
                case 'telemetry': {
                    // Resource governor check
                    const endOp = governor.cpu.startOp();
                    
                    sender.role = assignRole(msg.payload);
                    sender.geoHash = msg.payload.geo || 'u33d';
                    
                    // Register in DHT
                    dht.register(id, sender.geoHash);
                    
                    const roleInfo = getRoleInfo(sender.role);
                    sendBinary(ws, { 
                        type: 'role', 
                        role: sender.role, 
                        roleInfo,
                        geo: sender.geoHash,
                        governor: governor.getSnapshot(),
                    });
                    
                    // Kademlia DHT swarm node matching
                    const matchedPeers = dht.findPeers(id, sender.geoHash, 
                        (peerId) => !trust.isIsolated(peerId) && nodes.get(peerId)?.verified
                    );
                    
                    // Inform new node about matched swarm neighbors
                    matchedPeers.forEach(peerId => {
                        const peerNode = nodes.get(peerId);
                        if (!peerNode) return;
                        
                        sendBinary(ws, { 
                            type: 'peer_join', 
                            id: peerId, 
                            role: peerNode.role,
                            score: trust.getScore(peerId),
                        });
                        
                        // Inform neighbor about new node
                        sendBinary(peerNode.ws, { 
                            type: 'peer_join', 
                            id: id, 
                            role: sender.role,
                            score: trust.getScore(id),
                        });
                    });
                    
                    const elapsed = endOp();
                    console.log(`[DHT] ${id.substring(0, 8)} → [${sender.geoHash}] ${roleInfo.emoji} ${roleInfo.name} | ${matchedPeers.length} peers | ${elapsed.toFixed(1)}ms`);
                    break;
                }
                
                case 'offer':
                case 'answer':
                case 'ice': {
                    const target = nodes.get(msg.target);
                    if (target && target.verified && !trust.isIsolated(msg.target) && target.ws.readyState === 1) {
                        msg.from = id;
                        sendBinary(target.ws, msg);
                        
                        // Register session
                        const sessKey = [id, msg.target].sort().join('_');
                        sessions.add(sessKey);
                    }
                    break;
                }
                
                case 'report_trust': {
                    if (trust.validateReport(id, msg.targetId, sessions)) {
                        if (msg.rule === 'hash_match') {
                            trust.adjust(msg.targetId, TRUST_CONFIG.REWARD_VALID_CHUNK, 'VALID_CHUNK');
                            trust.adjust(id, TRUST_CONFIG.REWARD_RELAY, 'REPORTER_REWARD');
                        } else if (msg.rule === 'poisoned_chunk') {
                            const newScore = trust.adjust(msg.targetId, TRUST_CONFIG.PENALTY_POISONED, 'POISONED_DATA');
                            if (trust.isIsolated(msg.targetId)) {
                                broadcastBinary({ type: 'isolation', malId: msg.targetId }, null);
                                dht.remove(msg.targetId);
                                console.warn(`[ISOLATED] Node ${msg.targetId.substring(0, 8)} | Score: ${newScore}`);
                            }
                        } else if (msg.rule === 'sybil_spam') {
                            trust.adjust(msg.targetId, TRUST_CONFIG.PENALTY_SYBIL, 'SYBIL_ATTACK');
                        }
                    }
                    break;
                }
                
                case 'request_manifest': {
                    // Binary manifest for content distribution
                    sendBinary(ws, {
                        type: 'manifest_delivery',
                        manifest: {
                            contentId: msg.contentId || 'default',
                            layers: 2,
                            chunkSize: 256 * 1024,
                            chunks: [
                                { id: 'C_001', hash: 'fb8e20fc', type: 'Data' },
                                { id: 'C_002', hash: 'a52f9b12', type: 'Data' },
                                { id: 'P_001', hash: '3d8f1e5a', type: 'Parity' },
                            ],
                        },
                    });
                    break;
                }
            }
        } catch (err) {
            trust.adjust(id, TRUST_CONFIG.PENALTY_INVALID_MSG, 'PARSE_ERROR');
            console.error(`[ERROR] Node ${id.substring(0, 8)}: ${err.message}`);
        }
    });
    
    ws.on('close', () => {
        dht.remove(id);
        trust.remove(id);
        
        // Cleanup sessions
        for (const key of sessions) {
            if (key.includes(id)) sessions.delete(key);
        }
        
        nodes.delete(id);
        broadcastBinary({ type: 'peer_leave', id });
        console.log(`[DISCONNECT] Node ${id.substring(0, 8)}... | Remaining: ${nodes.size}`);
    });
    
    ws.on('error', () => {});
});

// ─── START ───────────────────────────────────────────────────

// ─── GENESIS ─────────────────────────────────────────────
// Conceived by Benjamin Leimer. A gift to humanity.
// May this protocol serve as the foundation for a free,
// decentralized internet – owned by no one, shared by all.
// ─────────────────────────────────────────────────────────

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    const gov = governor.getSnapshot();
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  🌐 AETHER BINARY NETWORK v1.0.0');
    console.log('  Das Binäre Internet – Massentauglicher Swarm');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  📡 Server:       http://localhost:${PORT}`);
    console.log(`  📊 API Stats:    http://localhost:${PORT}/api/stats`);
    console.log(`  📐 Protocol:     http://localhost:${PORT}/api/protocol`);
    console.log('───────────────────────────────────────────────────────────');
    console.log(`  ⚡ CPU Budget:    ${gov.cpu.budgetMs} ms/sec (0.3%)`);
    console.log(`  🧠 RAM Budget:    ${gov.ram.budgetMB} MB (0.3%)`);
    console.log(`  📶 BW Budget:     ${gov.bw.budgetKBps} KB/s (0.3%)`);
    console.log(`  💾 Chunk Cache:   max ${gov.chunkCacheLimit} chunks`);
    console.log('───────────────────────────────────────────────────────────');
    console.log('  🛡️  Zero-Trust PoW:     ACTIVE');
    console.log('  🌍 Kademlia DHT:        ACTIVE');
    console.log('  📦 Binary Protocol:     MsgPack (0xAE)');
    console.log('  🔒 GDPR Compliance:     ENFORCED');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
});
