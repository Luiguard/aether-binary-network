// ═══════════════════════════════════════════════════════════════
//  RAID-5 XOR Parity Compute Shader (WebGPU WGSL)
// ═══════════════════════════════════════════════════════════════
//  Hardware-accelerated bitwise XOR for parity calculation.
//  Runs on 0.3% GPU compute budget via workgroup_size(64).
//  Each invocation XORs one u32 element (4 bytes).

@group(0) @binding(0) var<storage, read> chunkA: array<u32>;
@group(0) @binding(1) var<storage, read> chunkB: array<u32>;
@group(0) @binding(2) var<storage, read_write> parityOut: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    if (index < arrayLength(&chunkA)) {
        // RAID-5 XOR parity: P = A ⊕ B
        parityOut[index] = chunkA[index] ^ chunkB[index];
    }
}
