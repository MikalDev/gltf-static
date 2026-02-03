#!/bin/bash
# Build WASM module with SIMD support

set -e

echo "Building WASM module..."

# Ensure wasm-pack is installed
if ! command -v wasm-pack &> /dev/null; then
    echo "Installing wasm-pack..."
    cargo install wasm-pack
fi

# Build with SIMD enabled
RUSTFLAGS='-C target-feature=+simd128' wasm-pack build \
    --target web \
    --out-dir ../c3runtime/wasm \
    --release

echo "Build complete: ../c3runtime/wasm/"
echo ""
echo "Files generated:"
ls -la ../c3runtime/wasm/

echo ""
echo "To use in worker, add to TransformWorkerPool.ts:"
echo "  import init, { calculate_lighting, ... } from './wasm/gltf_lighting.js';"
