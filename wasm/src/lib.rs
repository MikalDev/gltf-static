//! WASM module for SIMD-optimized vertex lighting
//!
//! This module provides high-performance lighting calculations using
//! WebAssembly SIMD to process 4 vertices in parallel.

use wasm_bindgen::prelude::*;

mod lighting;
mod simd;

// Maximum supported vertices (pre-allocated buffers)
static mut MAX_VERTICES: usize = 0;

// Working buffers (allocated once, reused)
static mut POSITIONS: Vec<f32> = Vec::new();
static mut NORMALS: Vec<f32> = Vec::new();
static mut COLORS: Vec<f32> = Vec::new();

// Light configuration
static mut AMBIENT: [f32; 3] = [0.2, 0.2, 0.2];
static mut DIRECTIONAL_LIGHTS: [lighting::DirectionalLight; 4] = [lighting::DirectionalLight::DISABLED; 4];
static mut SPOTLIGHTS: [lighting::SpotLight; 8] = [lighting::SpotLight::DISABLED; 8];
static mut HEMISPHERE: lighting::HemisphereLight = lighting::HemisphereLight::DISABLED;
static mut SPECULAR: lighting::SpecularConfig = lighting::SpecularConfig::DEFAULT;
static mut CAMERA_POS: [f32; 3] = [0.0, 0.0, 0.0];

/// Initialize the module with maximum vertex capacity
#[wasm_bindgen]
pub fn init(max_vertices: u32) -> bool {
    unsafe {
        MAX_VERTICES = max_vertices as usize;
        POSITIONS = vec![0.0; max_vertices as usize * 3];
        NORMALS = vec![0.0; max_vertices as usize * 3];
        COLORS = vec![0.0; max_vertices as usize * 4];
    }
    true
}

/// Get pointer to positions buffer for direct memory access
#[wasm_bindgen]
pub fn get_positions_ptr() -> *mut f32 {
    unsafe { POSITIONS.as_mut_ptr() }
}

/// Get pointer to normals buffer for direct memory access
#[wasm_bindgen]
pub fn get_normals_ptr() -> *mut f32 {
    unsafe { NORMALS.as_mut_ptr() }
}

/// Get pointer to output colors buffer
#[wasm_bindgen]
pub fn get_colors_ptr() -> *const f32 {
    unsafe { COLORS.as_ptr() }
}

/// Set ambient light color
#[wasm_bindgen]
pub fn set_ambient(r: f32, g: f32, b: f32) {
    unsafe {
        AMBIENT = [r, g, b];
    }
}

/// Configure a directional light (up to 4)
#[wasm_bindgen]
pub fn set_directional_light(
    index: u32,
    enabled: bool,
    dir_x: f32, dir_y: f32, dir_z: f32,
    r: f32, g: f32, b: f32,
    intensity: f32,
    specular_enabled: bool,
) {
    if index >= 4 { return; }
    unsafe {
        DIRECTIONAL_LIGHTS[index as usize] = lighting::DirectionalLight {
            enabled,
            direction: [dir_x, dir_y, dir_z],
            color: [r, g, b],
            intensity,
            specular_enabled,
        };
    }
}

/// Configure a spotlight (up to 8)
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
    falloff: f32,
    range: f32,
    specular_enabled: bool,
) {
    if index >= 8 { return; }
    unsafe {
        SPOTLIGHTS[index as usize] = lighting::SpotLight {
            enabled,
            position: [pos_x, pos_y, pos_z],
            direction: [dir_x, dir_y, dir_z],
            color: [r, g, b],
            intensity,
            inner_cos: inner_angle.cos(),
            outer_cos: outer_angle.cos(),
            falloff,
            range,
            specular_enabled,
        };
    }
}

/// Configure hemisphere light
#[wasm_bindgen]
pub fn set_hemisphere(
    enabled: bool,
    sky_r: f32, sky_g: f32, sky_b: f32,
    ground_r: f32, ground_g: f32, ground_b: f32,
    intensity: f32,
) {
    unsafe {
        HEMISPHERE = lighting::HemisphereLight {
            enabled,
            sky_color: [sky_r, sky_g, sky_b],
            ground_color: [ground_r, ground_g, ground_b],
            intensity,
        };
    }
}

/// Configure specular settings
#[wasm_bindgen]
pub fn set_specular(shininess: f32, intensity: f32) {
    unsafe {
        SPECULAR = lighting::SpecularConfig { shininess, intensity };
    }
}

/// Set camera position for specular calculations
#[wasm_bindgen]
pub fn set_camera(x: f32, y: f32, z: f32) {
    unsafe {
        CAMERA_POS = [x, y, z];
    }
}

/// Calculate lighting for vertices
///
/// Data should be written to positions/normals buffers via pointers.
/// Results are written to colors buffer.
///
/// model_matrix: pointer to 16 f32s (column-major 4x4), or null
#[wasm_bindgen]
pub fn calculate_lighting(vertex_count: u32) -> bool {
    let count = vertex_count as usize;

    unsafe {
        if count > MAX_VERTICES {
            return false;
        }

        lighting::calculate_lighting_simd(
            &POSITIONS[..count * 3],
            &NORMALS[..count * 3],
            &mut COLORS[..count * 4],
            count,
            &AMBIENT,
            &DIRECTIONAL_LIGHTS,
            &SPOTLIGHTS,
            &HEMISPHERE,
            &SPECULAR,
            &CAMERA_POS,
        );
    }

    true
}
