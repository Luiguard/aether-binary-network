/**
 * ═══════════════════════════════════════════════════════════════
 *  RESOURCE GOVERNOR – Hard 0.3% Enforcement
 * ═══════════════════════════════════════════════════════════════
 * 
 *  Enforces the iron rule: each node contributes at most
 *  0.3% CPU, 0.3% RAM, 0.3% GPU, 0.3% Bandwidth.
 * 
 *  Server-Side: Monitors and throttles per-node resource claims.
 *  Client-Side: Self-limits via requestIdleCallback, RAM caps,
 *               GPU compute budget, and transfer rate limiting.
 */

'use strict';

const os = require('os');

// ─── CONFIGURATION ────────────────────────────────────────────

const LIMITS = {
    CPU_PERCENT:   0.3,   // Max 0.3% of system CPU
    RAM_PERCENT:   0.3,   // Max 0.3% of system RAM
    GPU_PERCENT:   0.3,   // Max 0.3% of GPU compute
    BW_PERCENT:    0.3,   // Max 0.3% of measured bandwidth
};

// Absolute boundaries (floor values for minimal systems)
const ABSOLUTE_MIN = {
    RAM_BYTES:       8 * 1024 * 1024,   // 8 MB floor
    BW_BYTES_SEC:    32 * 1024,         // 32 KB/s floor
    CHUNK_CACHE:     50,                // Min 50 cached chunks
};

// ─── SYSTEM PROFILER ──────────────────────────────────────────

function profileSystem() {
    const totalRAM = os.totalmem();
    const cpuCount = os.cpus().length;
    const cpuModel = os.cpus()[0]?.model || 'Unknown';
    
    // Calculate hard limits based on 0.3%
    const ramBudget = Math.max(
        Math.floor(totalRAM * LIMITS.RAM_PERCENT / 100),
        ABSOLUTE_MIN.RAM_BYTES
    );
    
    // CPU budget: fraction of one core's time
    // On 8-core system: 0.3% of total = 0.024 core equivalent
    const cpuBudgetMs = Math.floor((LIMITS.CPU_PERCENT / 100) * cpuCount * 1000); // ms per second
    
    // Chunk cache limit based on RAM budget (each chunk ~256KB)
    const chunkCacheLimit = Math.max(
        Math.floor(ramBudget / (256 * 1024)),
        ABSOLUTE_MIN.CHUNK_CACHE
    );
    
    return {
        totalRAM,
        cpuCount,
        cpuModel,
        ramBudget,
        cpuBudgetMs,
        chunkCacheLimit,
        limits: { ...LIMITS },
    };
}

// ─── BANDWIDTH THROTTLE ──────────────────────────────────────

class BandwidthThrottle {
    constructor(maxBytesPerSecond) {
        this.maxBps = maxBytesPerSecond;
        this.bytesThisWindow = 0;
        this.windowStart = Date.now();
        this.windowMs = 1000; // 1-second sliding window
    }
    
    /**
     * Check if transfer of `bytes` is allowed in current window.
     * @param {number} bytes 
     * @returns {boolean}
     */
    canTransfer(bytes) {
        this._resetWindowIfNeeded();
        return (this.bytesThisWindow + bytes) <= this.maxBps;
    }
    
    /**
     * Record a transfer.
     */
    record(bytes) {
        this._resetWindowIfNeeded();
        this.bytesThisWindow += bytes;
    }
    
    /**
     * Get milliseconds to wait before next transfer is possible.
     */
    getWaitMs() {
        const elapsed = Date.now() - this.windowStart;
        return Math.max(0, this.windowMs - elapsed);
    }
    
    /**
     * Current utilization as percentage.
     */
    getUtilization() {
        this._resetWindowIfNeeded();
        return this.maxBps > 0 ? (this.bytesThisWindow / this.maxBps) * 100 : 0;
    }
    
    _resetWindowIfNeeded() {
        const now = Date.now();
        if (now - this.windowStart >= this.windowMs) {
            this.bytesThisWindow = 0;
            this.windowStart = now;
        }
    }
}

// ─── CPU BUDGET TRACKER ──────────────────────────────────────

class CpuBudget {
    constructor(budgetMsPerSecond) {
        this.budgetMs = budgetMsPerSecond;
        this.usedMs = 0;
        this.windowStart = Date.now();
    }
    
    /**
     * Start a timed operation.
     * @returns {Function} Call this function when operation completes.
     */
    startOp() {
        const start = process.hrtime.bigint();
        return () => {
            const elapsed = Number(process.hrtime.bigint() - start) / 1e6; // ms
            this._resetIfNeeded();
            this.usedMs += elapsed;
            return elapsed;
        };
    }
    
    /**
     * Check if budget still available.
     */
    hasCapacity() {
        this._resetIfNeeded();
        return this.usedMs < this.budgetMs;
    }
    
    getUtilization() {
        this._resetIfNeeded();
        return this.budgetMs > 0 ? (this.usedMs / this.budgetMs) * 100 : 0;
    }
    
    _resetIfNeeded() {
        const now = Date.now();
        if (now - this.windowStart >= 1000) {
            this.usedMs = 0;
            this.windowStart = now;
        }
    }
}

// ─── RAM MONITOR ─────────────────────────────────────────────

class RamMonitor {
    constructor(budgetBytes) {
        this.budgetBytes = budgetBytes;
        this.allocations = new Map(); // key -> bytes
    }
    
    /**
     * Register an allocation.
     */
    alloc(key, bytes) {
        this.allocations.set(key, bytes);
        return this.isWithinBudget();
    }
    
    /**
     * Free an allocation.
     */
    free(key) {
        this.allocations.delete(key);
    }
    
    /**
     * Current usage in bytes.
     */
    getUsed() {
        let total = 0;
        for (const v of this.allocations.values()) total += v;
        return total;
    }
    
    isWithinBudget() {
        return this.getUsed() <= this.budgetBytes;
    }
    
    getUtilization() {
        return this.budgetBytes > 0 ? (this.getUsed() / this.budgetBytes) * 100 : 0;
    }
}

// ─── UNIFIED GOVERNOR ────────────────────────────────────────

class ResourceGovernor {
    constructor(measuredBandwidthBps = 12500000 /* 100 Mbit default */) {
        const profile = profileSystem();
        this.profile = profile;
        
        const bwBudget = Math.max(
            Math.floor(measuredBandwidthBps * LIMITS.BW_PERCENT / 100),
            ABSOLUTE_MIN.BW_BYTES_SEC
        );
        
        this.cpu = new CpuBudget(profile.cpuBudgetMs);
        this.ram = new RamMonitor(profile.ramBudget);
        this.bw = new BandwidthThrottle(bwBudget);
        
        this.stats = {
            totalChunksProcessed: 0,
            totalBytesTransferred: 0,
            throttleEvents: 0,
        };
    }
    
    /**
     * Pre-flight check: Can we handle this operation?
     */
    canProcess(bytes = 0) {
        const cpuOk = this.cpu.hasCapacity();
        const ramOk = this.ram.isWithinBudget();
        const bwOk = this.bw.canTransfer(bytes);
        
        if (!cpuOk || !ramOk || !bwOk) {
            this.stats.throttleEvents++;
        }
        
        return cpuOk && ramOk && bwOk;
    }
    
    /**
     * Get a snapshot of current utilization.
     */
    getSnapshot() {
        return {
            cpu: {
                budgetMs: this.profile.cpuBudgetMs,
                utilization: this.cpu.getUtilization().toFixed(2) + '%',
            },
            ram: {
                budgetMB: (this.profile.ramBudget / 1024 / 1024).toFixed(1),
                usedMB: (this.ram.getUsed() / 1024 / 1024).toFixed(1),
                utilization: this.ram.getUtilization().toFixed(2) + '%',
            },
            bw: {
                budgetKBps: (this.bw.maxBps / 1024).toFixed(1),
                utilization: this.bw.getUtilization().toFixed(2) + '%',
            },
            chunkCacheLimit: this.profile.chunkCacheLimit,
            stats: { ...this.stats },
        };
    }
}

module.exports = { ResourceGovernor, BandwidthThrottle, CpuBudget, RamMonitor, profileSystem, LIMITS };
