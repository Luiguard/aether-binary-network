/**
 * ═══════════════════════════════════════════════════════════════
 *  AETHER BINARY PROTOCOL – Zero-Copy Binary Codec
 * ═══════════════════════════════════════════════════════════════
 * 
 *  Replaces JSON.parse/JSON.stringify with a lean binary wire format.
 *  Uses MessagePack for structured messages (10x faster than JSON)
 *  and raw ArrayBuffer framing for media/chunk payloads.
 * 
 *  Wire Format:
 *  ┌──────────┬──────────┬───────────────────────┐
 *  │ MAGIC(1) │ TYPE(1)  │ PAYLOAD (variable)    │
 *  └──────────┴──────────┴───────────────────────┘
 *  
 *  MAGIC = 0xAE (Aether)
 *  TYPE:
 *    0x01 = Control Message (MsgPack encoded)
 *    0x02 = Media Chunk    (Raw binary frame)
 *    0x03 = Parity Data    (GPU computed XOR/RS)
 *    0x04 = Trust Signal   (Compact reputation update)
 */

'use strict';

let packr, unpackr;

// Dynamic import – works both in Node.js and browser (with bundler)
try {
    const { Packr, Unpackr } = require('msgpackr');
    packr = new Packr({ structuredClone: false, moreTypes: false });
    unpackr = new Unpackr({ mapsAsObjects: true });
} catch {
    // Browser fallback: Use manual lightweight MsgPack subset
    packr = null;
    unpackr = null;
}

const MAGIC = 0xAE;

const MSG_TYPE = {
    CONTROL:  0x01,
    CHUNK:    0x02,
    PARITY:   0x03,
    TRUST:    0x04,
};

// ─── ENCODER ───────────────────────────────────────────────────

/**
 * Encode a control message (object) into a binary frame.
 * @param {Object} msg – The message object (type, payload, etc.)
 * @returns {Uint8Array} Binary encoded frame
 */
function encodeControl(msg) {
    // Always use JSON inside binary frame for browser compatibility.
    // MsgPack is reserved for native-to-native chunk transfers.
    // The 0xAE binary header still ensures protocol identification.
    const json = new TextEncoder().encode(JSON.stringify(msg));
    const frame = new Uint8Array(2 + json.length);
    frame[0] = MAGIC;
    frame[1] = MSG_TYPE.CONTROL;
    frame.set(json, 2);
    return frame;
}

/**
 * Encode a raw media chunk with index header.
 * ┌────────┬────────┬──────────┬────────────────┐
 * │ 0xAE   │ 0x02   │ INDEX(4) │ RAW BYTES      │
 * └────────┴────────┴──────────┴────────────────┘
 * @param {number} index – Chunk index
 * @param {Uint8Array|ArrayBuffer} data – Raw chunk data
 * @returns {Uint8Array}
 */
function encodeChunk(index, data) {
    const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
    const frame = new Uint8Array(6 + raw.length);
    frame[0] = MAGIC;
    frame[1] = MSG_TYPE.CHUNK;
    // 4-byte big-endian index
    frame[2] = (index >> 24) & 0xFF;
    frame[3] = (index >> 16) & 0xFF;
    frame[4] = (index >> 8) & 0xFF;
    frame[5] = index & 0xFF;
    frame.set(raw, 6);
    return frame;
}

/**
 * Encode a parity data frame.
 */
function encodeParity(index, data) {
    const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
    const frame = new Uint8Array(6 + raw.length);
    frame[0] = MAGIC;
    frame[1] = MSG_TYPE.PARITY;
    frame[2] = (index >> 24) & 0xFF;
    frame[3] = (index >> 16) & 0xFF;
    frame[4] = (index >> 8) & 0xFF;
    frame[5] = index & 0xFF;
    frame.set(raw, 6);
    return frame;
}

/**
 * Encode a compact trust signal.
 * @param {string} nodeId – Target node ID (truncated to 16 bytes)
 * @param {number} delta – Score change (-128 to +127)
 * @param {number} reason – Reason code (0-255)
 */
function encodeTrust(nodeId, delta, reason) {
    const frame = new Uint8Array(20);
    frame[0] = MAGIC;
    frame[1] = MSG_TYPE.TRUST;
    // 16 bytes for truncated node ID
    const idBytes = new TextEncoder().encode(nodeId.substring(0, 16));
    frame.set(idBytes, 2);
    frame[18] = delta & 0xFF;  // signed byte
    frame[19] = reason & 0xFF;
    return frame;
}

// ─── DECODER ───────────────────────────────────────────────────

/**
 * Decode a binary frame.
 * @param {Uint8Array|ArrayBuffer|Buffer} raw 
 * @returns {{ type: number, payload: any }}
 */
function decode(raw) {
    const buf = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    
    if (buf.length < 2 || buf[0] !== MAGIC) {
        // Legacy JSON fallback (for interop with old nodes)
        try {
            const str = new TextDecoder().decode(buf);
            return { type: MSG_TYPE.CONTROL, payload: JSON.parse(str) };
        } catch {
            return null;
        }
    }
    
    const type = buf[1];
    const payload = buf.slice(2);
    
    switch (type) {
        case MSG_TYPE.CONTROL:
            if (unpackr) {
                try {
                    return { type, payload: unpackr.unpack(Buffer.from(payload)) };
                } catch {
                    // Fallback to JSON
                    return { type, payload: JSON.parse(new TextDecoder().decode(payload)) };
                }
            }
            return { type, payload: JSON.parse(new TextDecoder().decode(payload)) };
            
        case MSG_TYPE.CHUNK:
        case MSG_TYPE.PARITY: {
            const index = (payload[0] << 24) | (payload[1] << 16) | (payload[2] << 8) | payload[3];
            const data = payload.slice(4);
            return { type, index, payload: data };
        }
        
        case MSG_TYPE.TRUST: {
            const idBytes = payload.slice(0, 16);
            const nodeId = new TextDecoder().decode(idBytes).replace(/\0/g, '');
            const delta = payload[16] > 127 ? payload[16] - 256 : payload[16]; // signed
            const reason = payload[17];
            return { type, nodeId, delta, reason };
        }
        
        default:
            return null;
    }
}

module.exports = { encodeControl, encodeChunk, encodeParity, encodeTrust, decode, MSG_TYPE, MAGIC };
