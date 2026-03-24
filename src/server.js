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
const { encodeControl, encodeChunk: encodeChunkFrame, decode, MSG_TYPE } = require('./protocol/binary-codec');
const { ResourceGovernor }                = require('./limiter/resource-governor');
const { TrustLedger, TRUST_CONFIG, generateChallenge, verifyPoW } = require('./trust/zero-trust');
const { KademliaDHT }                     = require('./swarm/kademlia-dht');
const { assignRole, getRoleInfo, ROLES }  = require('./swarm/role-evaluator');
const { ChunkEngine }                     = require('./chunks/chunk-engine');
const { PersistentStore }                 = require('./storage/persistent-store');
const { AetherIdentity, AetherCrypto, SessionManager } = require('./crypto/aether-crypto');
const { AetherNamingService }             = require('./naming/naming-service');
const { MediaEngine }                     = require('./media/media-engine');
const { FederationManager }               = require('./federation/federation');

// ─── STATE ───────────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '..', 'data');
const store = new PersistentStore(DATA_DIR);
const nodes = new Map();
const peerSessions = new Set();
const dht = new KademliaDHT();
const trust = new TrustLedger();
const governor = new ResourceGovernor();
const chunkEngine = new ChunkEngine();
const sessionMgr = new SessionManager();
const naming = new AetherNamingService(store);
const media = new MediaEngine(chunkEngine, store);
const federation = new FederationManager(store);

// Setup persistence
const TRUST_DB = path.join(__dirname, '..', 'trust-ledger.dat');
trust.load(TRUST_DB);

// Periodic auto-save (every 5 mins)
setInterval(() => {
    trust.persist(TRUST_DB);
}, 5 * 60 * 1000);

// Graceful shutdown
function shutdown() {
    console.log('\n[SERVER] Graceful shutdown initiated. Saving state...');
    trust.persist(TRUST_DB);
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

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
            version: '2.0.0',
            magic: '0xAE',
            types: { CONTROL: 0x01, CHUNK: 0x02, PARITY: 0x03, TRUST: 0x04 },
            encoding: 'MessagePack',
            transport: 'WebSocket/Binary + WebRTC DataChannel',
            limits: governor.profile.limits,
            chunks: chunkEngine.getStats(),
        }));
    }
    
    const CORS = { 'Access-Control-Allow-Origin': '*' };
    const JSON_CORS = { 'Content-Type': 'application/json', ...CORS };
    
    function jsonRes(code, data) { res.writeHead(code, JSON_CORS); res.end(JSON.stringify(data, null, 2)); }
    function readBody(cb) { const p=[]; req.on('data', c=>p.push(c)); req.on('end', ()=> cb(Buffer.concat(p))); }
    function readJSON(cb) { readBody(b => { try { cb(JSON.parse(b.toString())); } catch { jsonRes(400, {error:'Invalid JSON'}); } }); }
    
    // ─── UPLOAD: Split file into chunks and persist ───
    if (req.url === '/api/upload' && req.method === 'POST') {
        return readBody(body => {
            const contentId = crypto.randomUUID().substring(0, 8);
            const result = chunkEngine.split(body, contentId);
            // Persist all chunks + manifest
            result.chunks.forEach(c => store.saveChunk(c.hash, c.data));
            result.parityChunks.forEach(p => store.saveChunk(p.hash, p.data));
            store.saveManifest(contentId, result.manifest);
            broadcastBinary({ type: 'manifest_delivery', manifest: result.manifest });
            federation.broadcastManifest(result.manifest);
            console.log(`[UPLOAD] ${contentId} | ${result.chunks.length} chunks + ${result.parityChunks.length} parity | ${body.length} bytes`);
            jsonRes(200, { contentId, totalChunks: result.chunks.length, parityChunks: result.parityChunks.length, totalSize: body.length, manifest: result.manifest });
        });
    }
    
    // ─── DOWNLOAD ───
    if (req.url.startsWith('/api/download/')) {
        const contentId = req.url.split('/api/download/')[1];
        const manifest = store.getManifest(contentId) || chunkEngine.getManifest(contentId);
        if (!manifest) return jsonRes(404, { error: 'Content not found' });
        const reassembled = chunkEngine.reassemble(contentId, new Map());
        if (!reassembled) return jsonRes(500, { error: 'Reassembly failed' });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', ...CORS });
        return res.end(reassembled);
    }
    
    // ─── CHUNK ───
    if (req.url.startsWith('/api/chunk/')) {
        const hash = req.url.split('/api/chunk/')[1];
        const chunk = store.getChunk(hash) || chunkEngine.getChunk(hash);
        if (!chunk) return jsonRes(404, { error: 'Chunk not found' });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', ...CORS });
        return res.end(chunk);
    }
    
    // ─── NAMING: Register name ───
    if (req.url === '/api/names' && req.method === 'POST') {
        return readJSON(body => {
            const result = naming.register(body.name, body.contentId, body.owner || 'anon', body.signature, body.publicKey);
            if (result.success) federation.broadcastName(result);
            jsonRes(result.error ? 400 : 200, result);
        });
    }
    
    // ─── NAMING: Resolve ───
    if (req.url.startsWith('/api/resolve/')) {
        const name = decodeURIComponent(req.url.split('/api/resolve/')[1]);
        const result = naming.resolve(name);
        return jsonRes(result ? 200 : 404, result || { error: 'Name not found' });
    }
    
    // ─── NAMING: List all ───
    if (req.url === '/api/names') return jsonRes(200, naming.list());
    
    // ─── IDENTITY: Generate keypair ───
    if (req.url === '/api/identity/generate' && req.method === 'POST') {
        const identity = AetherIdentity.generate();
        store.saveIdentity(identity.fingerprint, { created: Date.now() });
        return jsonRes(200, identity);
    }
    
    // ─── IDENTITY: Sign data ───
    if (req.url === '/api/identity/sign' && req.method === 'POST') {
        return readJSON(body => {
            const sig = AetherIdentity.sign(body.data, body.privateKey);
            jsonRes(200, { signature: sig });
        });
    }
    
    // ─── IDENTITY: Verify ───
    if (req.url === '/api/identity/verify' && req.method === 'POST') {
        return readJSON(body => {
            const valid = AetherIdentity.verify(body.data, body.signature, body.publicKey);
            jsonRes(200, { valid });
        });
    }
    
    // ─── SEARCH ───
    if (req.url.startsWith('/api/search?')) {
        const q = new URL(req.url, 'http://localhost').searchParams.get('q') || '';
        return jsonRes(200, store.search(q));
    }
    
    // ─── MEDIA: Upload ───
    if (req.url === '/api/media/upload' && req.method === 'POST') {
        return readBody(body => {
            const filename = req.headers['x-filename'] || 'upload.bin';
            const title = req.headers['x-title'] || filename;
            const result = media.ingest(body, filename, { title });
            jsonRes(200, result);
        });
    }
    
    // ─── MEDIA: Stream ───
    if (req.url.startsWith('/api/media/stream/')) {
        const contentId = req.url.split('/api/media/stream/')[1];
        return media.stream(contentId, req, res);
    }
    
    // ─── MEDIA: Catalog ───
    if (req.url === '/api/media/catalog') return jsonRes(200, media.getCatalog());
    
    // ─── SESSION: Create ───
    if (req.url === '/api/session' && req.method === 'POST') {
        return readJSON(body => {
            const token = sessionMgr.create(body.identity || 'anonymous', body.data || {});
            jsonRes(200, { token });
        });
    }
    
    // ─── SESSION: Get/Set state ───
    if (req.url.startsWith('/api/state/') && req.method === 'GET') {
        const key = decodeURIComponent(req.url.split('/api/state/')[1]);
        return jsonRes(200, { key, value: store.getState(key) });
    }
    if (req.url.startsWith('/api/state/') && req.method === 'POST') {
        const key = decodeURIComponent(req.url.split('/api/state/')[1]);
        return readJSON(body => { store.saveState(key, body.value); jsonRes(200, { saved: true }); });
    }
    
    // ─── STORAGE STATS ───
    if (req.url === '/api/storage') return jsonRes(200, store.getStats());
    
    // ─── FEDERATION: Add peer ───
    if (req.url === '/api/federation/add' && req.method === 'POST') {
        return readJSON(body => { federation.addPeer(body.url); jsonRes(200, { added: body.url }); });
    }
    if (req.url === '/api/federation') return jsonRes(200, federation.getStats());
    
    // ─── AI PROXY ───
    if (req.url === '/api/ai/generate' && req.method === 'POST') {
        return readBody(body => {
            const aiReq = http.request({ hostname: '127.0.0.1', port: 5050, path: '/generate', method: 'POST', headers: { 'Content-Type': 'application/json' } }, (aiRes) => {
                const parts = []; aiRes.on('data', c => parts.push(c));
                aiRes.on('end', () => { res.writeHead(aiRes.statusCode, JSON_CORS); res.end(Buffer.concat(parts)); });
            });
            aiReq.on('error', () => jsonRes(503, { error: 'AI Inference Server offline. Starte: python ai/serve.py' }));
            aiReq.write(body); aiReq.end();
        });
    }
    
    // ─── CORS preflight ───
    if (req.method === 'OPTIONS') {
        res.writeHead(200, { ...CORS, 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,X-Filename,X-Title,Authorization' });
        return res.end();
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
                    const manifest = chunkEngine.getManifest(msg.contentId);
                    if (manifest) {
                        sendBinary(ws, { type: 'manifest_delivery', manifest });
                    } else {
                        sendBinary(ws, { type: 'error', reason: 'Content not found', contentId: msg.contentId });
                    }
                    break;
                }
                
                case 'request_chunk': {
                    const chunkData = chunkEngine.getChunk(msg.hash);
                    if (chunkData && governor.canProcess(chunkData.length)) {
                        governor.bw.record(chunkData.length);
                        ws.send(encodeChunkFrame(msg.index, chunkData));
                        trust.adjust(id, 1, 'CHUNK_SERVED');
                    }
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

// Federation peer connections from env
if (process.env.FEDERATION_PEERS) {
    process.env.FEDERATION_PEERS.split(',').forEach(url => federation.addPeer(url.trim()));
}
federation.startSync(60000);

server.listen(PORT, () => {
    const gov = governor.getSnapshot();
    const st = store.getStats();
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('  🌐 AETHER BINARY NETWORK v3.0.0');
    console.log('  Das Binäre Internet – Vollständig');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(`  📡 Server:       http://localhost:${PORT}`);
    console.log(`  🔮 Builder:      http://localhost:${PORT}/builder.html`);
    console.log(`  📊 API:          http://localhost:${PORT}/api/stats`);
    console.log('───────────────────────────────────────────────────────────');
    console.log(`  ⚡ CPU Budget:    ${gov.cpu.budgetMs} ms/sec (0.3%)`);
    console.log(`  🧠 RAM Budget:    ${gov.ram.budgetMB} MB (0.3%)`);
    console.log(`  📶 BW Budget:     ${gov.bw.budgetKBps} KB/s (0.3%)`);
    console.log(`  💾 Stored:        ${st.chunks} chunks (${st.totalStoredMB} MB)`);
    console.log('───────────────────────────────────────────────────────────');
    console.log('  🛡️  Zero-Trust PoW:       ACTIVE');
    console.log('  🌍 Kademlia DHT:          ACTIVE');
    console.log('  📦 Binary Protocol:       0xAE MsgPack');
    console.log('  📂 Chunk Engine + FEC:    ACTIVE (persistent)');
    console.log('  🔐 E2E Encryption:        AES-256-GCM');
    console.log('  🪪 Identity:              Ed25519 Signatures');
    console.log('  🏷️  Naming (ANS):          aether://*.ae');
    console.log(`  📚 Names Registered:      ${st.names}`);
    console.log('  🎬 Media Engine:          Streaming + Range');
    console.log('  🌐 Federation:            Mesh Sync');
    console.log('  🤖 AI Builder:            http://localhost:5050');
    console.log('  🔒 GDPR Compliance:       ENFORCED');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
});
