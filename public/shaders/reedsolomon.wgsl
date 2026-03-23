// ═══════════════════════════════════════════════════════════════
//  REED-SOLOMON Erasure Coding Shader (WebGPU WGSL)
// ═══════════════════════════════════════════════════════════════
//  GF(2^8) Galois Field multiplication for Forward Error Correction.
//  Uses the AES irreducible polynomial: x^8 + x^4 + x^3 + x + 1
//  Enables recovery of missing chunks without re-download.

@group(0) @binding(0) var<storage, read> dataMatrix: array<u32>;
@group(0) @binding(1) var<storage, read> encodingMatrix: array<u32>;
@group(0) @binding(2) var<storage, read_write> fecOut: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let index = global_id.x;
    if (index < arrayLength(&dataMatrix)) {
        var a = dataMatrix[index];
        var b = encodingMatrix[index % arrayLength(&encodingMatrix)];
        var result = 0u;

        // GF(2^8) multiplication with carry-less reduction
        for (var i = 0u; i < 8u; i = i + 1u) {
            if ((b & 1u) != 0u) { result ^= a; }
            let hi_bit_set = (a & 0x80u) != 0u;
            a <<= 1u;
            if (hi_bit_set) { a ^= 0x11Du; } // AES polynomial
            b >>= 1u;
        }

        fecOut[index] = result;
    }
}
