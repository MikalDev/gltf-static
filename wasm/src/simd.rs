//! SIMD helper functions for WASM
//!
//! Provides optimized vector operations using WebAssembly SIMD.

#[cfg(target_arch = "wasm32")]
use std::arch::wasm32::*;

/// Load 4 vec3s from AOS (Array of Structures) layout to SOA (Structure of Arrays)
/// Input:  [x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3]
/// Output: (x0x1x2x3, y0y1y2y3, z0z1z2z3)
#[cfg(target_arch = "wasm32")]
#[inline]
pub fn load_vec3x4_aos(data: &[f32]) -> (v128, v128, v128) {
    // Load 12 floats (4 vec3s)
    let x = f32x4(data[0], data[3], data[6], data[9]);
    let y = f32x4(data[1], data[4], data[7], data[10]);
    let z = f32x4(data[2], data[5], data[8], data[11]);
    (x, y, z)
}

/// Store 4 RGBA values from SOA to AOS layout
/// Input:  r0r1r2r3, g0g1g2g3, b0b1b2b3, a0a1a2a3
/// Output: [r0,g0,b0,a0, r1,g1,b1,a1, r2,g2,b2,a2, r3,g3,b3,a3]
#[cfg(target_arch = "wasm32")]
#[inline]
pub fn store_rgba4_aos(out: &mut [f32], r: v128, g: v128, b: v128, a: v128) {
    // Extract individual floats and interleave
    // This is not ideal but works - could optimize with shuffle
    out[0] = f32x4_extract_lane::<0>(r);
    out[1] = f32x4_extract_lane::<0>(g);
    out[2] = f32x4_extract_lane::<0>(b);
    out[3] = f32x4_extract_lane::<0>(a);

    out[4] = f32x4_extract_lane::<1>(r);
    out[5] = f32x4_extract_lane::<1>(g);
    out[6] = f32x4_extract_lane::<1>(b);
    out[7] = f32x4_extract_lane::<1>(a);

    out[8] = f32x4_extract_lane::<2>(r);
    out[9] = f32x4_extract_lane::<2>(g);
    out[10] = f32x4_extract_lane::<2>(b);
    out[11] = f32x4_extract_lane::<2>(a);

    out[12] = f32x4_extract_lane::<3>(r);
    out[13] = f32x4_extract_lane::<3>(g);
    out[14] = f32x4_extract_lane::<3>(b);
    out[15] = f32x4_extract_lane::<3>(a);
}

/// Dot product of two vec3 (4 parallel computations)
#[cfg(target_arch = "wasm32")]
#[inline]
pub fn dot3(ax: v128, ay: v128, az: v128, bx: v128, by: v128, bz: v128) -> v128 {
    let xx = f32x4_mul(ax, bx);
    let yy = f32x4_mul(ay, by);
    let zz = f32x4_mul(az, bz);
    f32x4_add(f32x4_add(xx, yy), zz)
}

/// Normalize vec3 (4 parallel computations)
#[cfg(target_arch = "wasm32")]
#[inline]
pub fn normalize3(x: v128, y: v128, z: v128) -> (v128, v128, v128) {
    let len_sq = dot3(x, y, z, x, y, z);
    let len = f32x4_sqrt(len_sq);

    // Avoid division by zero
    let epsilon = f32x4_splat(0.0001);
    let safe_len = f32x4_max(len, epsilon);

    let inv_len = f32x4_div(f32x4_splat(1.0), safe_len);

    (
        f32x4_mul(x, inv_len),
        f32x4_mul(y, inv_len),
        f32x4_mul(z, inv_len),
    )
}

/// Fast power approximation for specular (4 parallel)
/// Uses exp(y * ln(x)) approximation
#[cfg(target_arch = "wasm32")]
#[inline]
pub fn pow4(base: v128, exp: f32) -> v128 {
    // For specular, base is typically in [0, 1]
    // Simple approximation: base^n ≈ base * base * ... (for small integer n)
    // For arbitrary exp, use repeated squaring or exp/log

    // Simple approximation that works reasonably for typical shininess values
    // This is a rough approximation - can be improved
    let exp_v = f32x4_splat(exp);

    // Approximate pow using exp2(exp * log2(base))
    // For now, use a simpler repeated multiplication approach
    // that works well for typical shininess (16, 32, 64)

    let mut result = base;
    let mut n = exp as i32;

    // Handle powers of 2 efficiently
    while n > 1 {
        if n % 2 == 1 {
            // For odd powers, this is an approximation
            result = f32x4_mul(result, base);
            n -= 1;
        }
        result = f32x4_mul(result, result);
        n /= 2;
    }

    result
}

// Helper to create f32x4
#[cfg(target_arch = "wasm32")]
#[inline]
fn f32x4(a: f32, b: f32, c: f32, d: f32) -> v128 {
    f32x4_replace_lane::<3>(
        f32x4_replace_lane::<2>(
            f32x4_replace_lane::<1>(
                f32x4_splat(a),
                b
            ),
            c
        ),
        d
    )
}
