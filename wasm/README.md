# WASM Lighting & Transform Module

SIMD-optimized Rust implementation for vertex lighting and transforms.

## Goal

Replace the JavaScript lighting loop in `TransformWorkerPool.ts` with Rust WASM+SIMD to achieve 3-5x speedup for 1M+ vertex workloads.

## Target Performance

| Metric | Current (JS) | Target (WASM SIMD) |
|--------|--------------|-------------------|
| 1M vertices | ~100-200ms | ~25-50ms |
| 100K vertices | ~10-20ms | ~3-5ms |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Main Thread                          │
└─────────────────────┬───────────────────────────────────┘
                      │ postMessage (ArrayBuffers)
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  Web Worker                             │
│  ┌───────────────────────────────────────────────────┐  │
│  │              WASM Module                          │  │
│  │  ┌─────────────┐  ┌─────────────────────────┐    │  │
│  │  │ Transforms  │  │ Lighting (SIMD x4)      │    │  │
│  │  │ - skinning  │  │ - directional lights    │    │  │
│  │  │ - matrix    │  │ - spotlights            │    │  │
│  │  └─────────────┘  │ - hemisphere            │    │  │
│  │                   │ - specular (Blinn-Phong)│    │  │
│  │                   └─────────────────────────┘    │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## API Design

### Memory Layout (Structure of Arrays for SIMD)

```rust
// Input: positions as SOA for SIMD-friendly access
// [x0,x1,x2,x3, y0,y1,y2,y3, z0,z1,z2,z3, ...]
// Process 4 vertices per SIMD operation

// Output: RGBA colors (4 floats per vertex)
// [r0,g0,b0,a0, r1,g1,b1,a1, ...]
```

### Exported Functions

```rust
// Initialize module, allocate working memory
#[wasm_bindgen]
pub fn init(max_vertices: u32) -> bool;

// Set light configuration (call before calculate_lighting)
#[wasm_bindgen]
pub fn set_ambient(r: f32, g: f32, b: f32);

#[wasm_bindgen]
pub fn set_directional_light(
    index: u32,
    enabled: bool,
    dir_x: f32, dir_y: f32, dir_z: f32,
    r: f32, g: f32, b: f32,
    intensity: f32,
    specular_enabled: bool
);

#[wasm_bindgen]
pub fn set_spotlight(
    index: u32,
    enabled: bool,
    pos_x: f32, pos_y: f32, pos_z: f32,
    dir_x: f32, dir_y: f32, dir_z: f32,
    r: f32, g: f32, b: f32,
    intensity: f32,
    inner_angle: f32,
    outer_angle: f32,
    range: f32,
    specular_enabled: bool
);

#[wasm_bindgen]
pub fn set_hemisphere(
    enabled: bool,
    sky_r: f32, sky_g: f32, sky_b: f32,
    ground_r: f32, ground_g: f32, ground_b: f32,
    intensity: f32
);

#[wasm_bindgen]
pub fn set_specular(shininess: f32, intensity: f32);

#[wasm_bindgen]
pub fn set_camera(x: f32, y: f32, z: f32);

// Get pointers to WASM memory for zero-copy data transfer
#[wasm_bindgen]
pub fn get_positions_ptr() -> *mut f32;

#[wasm_bindgen]
pub fn get_normals_ptr() -> *mut f32;

#[wasm_bindgen]
pub fn get_colors_ptr() -> *const f32;

// Main calculation (operates on data at pointers)
#[wasm_bindgen]
pub fn calculate_lighting(
    vertex_count: u32,
    model_matrix_ptr: *const f32  // 16 floats, or null
) -> bool;
```

## Implementation Plan

### Phase 1: Project Setup
- [ ] Install Rust toolchain with wasm32 target
- [ ] Configure Cargo.toml with wasm-bindgen, SIMD features
- [ ] Create build script for .wasm output
- [ ] Test basic WASM instantiation in worker

### Phase 2: Core Lighting (No SIMD)
- [ ] Implement ambient lighting
- [ ] Implement directional light diffuse
- [ ] Implement hemisphere lighting
- [ ] Verify output matches JS implementation

### Phase 3: SIMD Optimization
- [ ] Convert to SOA memory layout
- [ ] Implement SIMD dot product (4 vertices parallel)
- [ ] Implement SIMD normalize
- [ ] Implement SIMD lighting accumulation
- [ ] Benchmark vs JS baseline

### Phase 4: Advanced Features
- [ ] Spotlight support with SIMD
- [ ] Specular (Blinn-Phong) with SIMD
- [ ] Matrix transform with SIMD

### Phase 5: Integration
- [ ] Modify TransformWorkerPool to load WASM
- [ ] Fallback to JS if WASM unavailable
- [ ] Zero-copy data transfer via SharedArrayBuffer or direct memory access
- [ ] Performance comparison logging

## Build Commands

```bash
# Install Rust (if not installed)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Add WASM target
rustup target add wasm32-unknown-unknown

# Install wasm-pack
cargo install wasm-pack

# Build (from wasm/ directory)
wasm-pack build --target web --out-dir ../c3runtime/wasm

# Build with SIMD (requires nightly for some features)
RUSTFLAGS='-C target-feature=+simd128' wasm-pack build --target web --out-dir ../c3runtime/wasm
```

## File Structure

```
wasm/
├── Cargo.toml          # Rust dependencies
├── README.md           # This file
├── src/
│   ├── lib.rs          # WASM entry point, exports
│   ├── lighting.rs     # Lighting calculations
│   ├── simd.rs         # SIMD helper functions
│   └── transform.rs    # Matrix/skinning transforms
└── build.sh            # Build script
```

## Key SIMD Operations

```rust
use std::arch::wasm32::*;

// Dot product of 4 vec3s in parallel
fn dot4(ax: v128, ay: v128, az: v128, bx: v128, by: v128, bz: v128) -> v128 {
    let xx = f32x4_mul(ax, bx);
    let yy = f32x4_mul(ay, by);
    let zz = f32x4_mul(az, bz);
    f32x4_add(f32x4_add(xx, yy), zz)
}

// Fast inverse sqrt (for normalization)
fn rsqrt4(v: v128) -> v128 {
    // Newton-Raphson approximation
    let half = f32x4_splat(0.5);
    let three = f32x4_splat(3.0);
    let est = f32x4_sqrt(v);  // Initial estimate
    let est_inv = f32x4_div(f32x4_splat(1.0), est);
    // One iteration: est * (3 - v * est * est) * 0.5
    f32x4_mul(f32x4_mul(est_inv, f32x4_sub(three, f32x4_mul(v, f32x4_mul(est_inv, est_inv)))), half)
}
```

## Browser Support

WASM SIMD is supported in:
- Chrome 91+ (May 2021)
- Firefox 89+ (June 2021)
- Safari 16.4+ (March 2023)
- Edge 91+

Coverage: ~95% of users (2024)

## Integration with Existing Code

The WASM module will be loaded in the worker and called from `calculateLighting()`:

```javascript
// In worker code (TransformWorkerPool.ts WORKER_CODE)
let wasmModule = null;
let wasmReady = false;

// Load WASM on worker init
async function initWasm() {
    try {
        const wasm = await import('./wasm/gltf_lighting.js');
        await wasm.default();  // Initialize
        wasm.init(1000000);    // Max 1M vertices
        wasmModule = wasm;
        wasmReady = true;
    } catch (e) {
        console.warn('WASM not available, using JS fallback');
    }
}

function calculateLighting(positions, normals, outColors, ...) {
    if (wasmReady) {
        // Copy to WASM memory, calculate, copy back
        return calculateLightingWasm(positions, normals, outColors, ...);
    }
    // Fallback to existing JS implementation
    return calculateLightingJS(positions, normals, outColors, ...);
}
```

## Performance Testing

Create benchmark with:
- 10K, 100K, 500K, 1M vertices
- 1, 2, 4 directional lights
- 0, 1, 4 spotlights
- With/without specular
- With/without hemisphere

Compare JS vs WASM SIMD execution time.
