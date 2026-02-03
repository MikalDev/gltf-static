@echo off
REM Build WASM module with SIMD support (Windows)

echo Building WASM module...

REM Check if wasm-pack is installed
where wasm-pack >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo Installing wasm-pack...
    cargo install wasm-pack
)

REM Build with SIMD enabled
set RUSTFLAGS=-C target-feature=+simd128
wasm-pack build --target web --out-dir ../c3runtime/wasm --release

echo.
echo Build complete: ../c3runtime/wasm/
echo.
echo To use in worker, add to TransformWorkerPool.ts:
echo   import init, { calculate_lighting, ... } from './wasm/gltf_lighting.js';
