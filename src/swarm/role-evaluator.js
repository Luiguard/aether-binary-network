/**
 * ═══════════════════════════════════════════════════════════════
 *  ROLE EVALUATOR – Dynamic Swarm Role Assignment
 * ═══════════════════════════════════════════════════════════════
 * 
 *  Assigns one of four roles based on device telemetry:
 * 
 *  🟣 NEXUS   – High BW + High stability + AC power → Full relay
 *  🔵 SIGMA   – Strong GPU + not on battery → Parity compute
 *  🟢 ALPHA   – Moderate BW → Standard seeding
 *  ⚪ OMEGA   – Low resources → Consumer only (0% contribution)
 *  
 *  "Inclusive Heuristics": Low-end devices are never penalized.
 *  They consume content freely. Powerful devices donate 0.3%.
 */

'use strict';

const ROLES = {
    NEXUS: 'nexus',  // Full relay + storage + compute
    SIGMA: 'sigma',  // GPU parity calculations
    ALPHA: 'alpha',  // Standard data seeding
    OMEGA: 'omega',  // Consumer (contributes nothing)
};

/**
 * Evaluate telemetry payload and assign a role.
 * @param {Object} t – Telemetry object
 * @param {number} t.bw – Bandwidth in Mbps
 * @param {number} t.gpu – GPU capability 0.0 - 1.0
 * @param {number} t.st – Connection stability 0.0 - 1.0
 * @param {boolean} t.ac – On AC power
 * @param {boolean} t.battLow – Battery below 20%
 * @param {number} [t.mem] – Available memory in GB
 * @param {number} [t.cores] – CPU core count
 * @returns {string} Role identifier
 */
function assignRole(t) {
    // Mobile or battery-critical → Never demand resources
    if (t.battLow) return ROLES.OMEGA;
    
    // Top-tier: enterprise/desktop relay node
    if (t.bw > 100 && t.st > 0.95 && t.ac) return ROLES.NEXUS;
    
    // GPU-strong: parity and Reed-Solomon compute
    if (t.gpu > 0.7 && !t.battLow) return ROLES.SIGMA;
    
    // Decent bandwidth: data seeder
    if (t.bw > 20) return ROLES.ALPHA;
    
    // Everything else: consumer
    return ROLES.OMEGA;
}

/**
 * Get human-readable role info.
 */
function getRoleInfo(role) {
    const info = {
        [ROLES.NEXUS]: {
            name: 'Nexus Relay',
            emoji: '🟣',
            desc: 'Full relay node – routes traffic, stores chunks, computes parity',
            contribution: { cpu: 0.3, ram: 0.3, gpu: 0.3, bw: 0.3 },
        },
        [ROLES.SIGMA]: {
            name: 'Sigma Compute',
            emoji: '🔵',
            desc: 'GPU parity node – runs Reed-Solomon & XOR calculations',
            contribution: { cpu: 0.1, ram: 0.2, gpu: 0.3, bw: 0.1 },
        },
        [ROLES.ALPHA]: {
            name: 'Alpha Seeder',
            emoji: '🟢',
            desc: 'Standard data node – seeds chunks to requesting nodes',
            contribution: { cpu: 0.1, ram: 0.1, gpu: 0.0, bw: 0.3 },
        },
        [ROLES.OMEGA]: {
            name: 'Omega Consumer',
            emoji: '⚪',
            desc: 'Consumer node – no resource contribution required',
            contribution: { cpu: 0.0, ram: 0.0, gpu: 0.0, bw: 0.0 },
        },
    };
    return info[role] || info[ROLES.OMEGA];
}

module.exports = { assignRole, getRoleInfo, ROLES };
