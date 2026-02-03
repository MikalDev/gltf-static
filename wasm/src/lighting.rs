//! Lighting calculations with SIMD optimization
//!
//! Processes 4 vertices in parallel using WASM SIMD instructions.

#[cfg(target_arch = "wasm32")]
use std::arch::wasm32::*;

use crate::simd;

#[derive(Clone, Copy)]
pub struct DirectionalLight {
    pub enabled: bool,
    pub direction: [f32; 3],  // TO light, normalized
    pub color: [f32; 3],
    pub intensity: f32,
    pub specular_enabled: bool,
}

impl DirectionalLight {
    pub const DISABLED: Self = Self {
        enabled: false,
        direction: [0.0, 1.0, 0.0],
        color: [1.0, 1.0, 1.0],
        intensity: 1.0,
        specular_enabled: false,
    };
}

#[derive(Clone, Copy)]
pub struct SpotLight {
    pub enabled: bool,
    pub position: [f32; 3],
    pub direction: [f32; 3],  // Cone axis, normalized
    pub color: [f32; 3],
    pub intensity: f32,
    pub inner_cos: f32,
    pub outer_cos: f32,
    pub falloff: f32,
    pub range: f32,
    pub specular_enabled: bool,
}

impl SpotLight {
    pub const DISABLED: Self = Self {
        enabled: false,
        position: [0.0, 0.0, 0.0],
        direction: [0.0, -1.0, 0.0],
        color: [1.0, 1.0, 1.0],
        intensity: 1.0,
        inner_cos: 0.9,
        outer_cos: 0.8,
        falloff: 1.0,
        range: 0.0,
        specular_enabled: false,
    };
}

#[derive(Clone, Copy)]
pub struct HemisphereLight {
    pub enabled: bool,
    pub sky_color: [f32; 3],
    pub ground_color: [f32; 3],
    pub intensity: f32,
}

impl HemisphereLight {
    pub const DISABLED: Self = Self {
        enabled: false,
        sky_color: [0.8, 0.9, 1.0],
        ground_color: [0.2, 0.15, 0.1],
        intensity: 1.0,
    };
}

#[derive(Clone, Copy)]
pub struct SpecularConfig {
    pub shininess: f32,
    pub intensity: f32,
}

impl SpecularConfig {
    pub const DEFAULT: Self = Self {
        shininess: 32.0,
        intensity: 1.0,
    };
}

/// Main lighting calculation with SIMD
///
/// Processes vertices in batches of 4 for SIMD efficiency.
#[cfg(target_arch = "wasm32")]
pub fn calculate_lighting_simd(
    positions: &[f32],
    normals: &[f32],
    out_colors: &mut [f32],
    vertex_count: usize,
    ambient: &[f32; 3],
    dir_lights: &[DirectionalLight; 4],
    spotlights: &[SpotLight; 8],
    hemisphere: &HemisphereLight,
    specular: &SpecularConfig,
    camera_pos: &[f32; 3],
) {
    // Process 4 vertices at a time
    let simd_count = vertex_count / 4;
    let remainder = vertex_count % 4;

    // Preload ambient as SIMD
    let ambient_r = f32x4_splat(ambient[0]);
    let ambient_g = f32x4_splat(ambient[1]);
    let ambient_b = f32x4_splat(ambient[2]);

    // Process batches of 4 vertices
    for batch in 0..simd_count {
        let base_pos = batch * 12;  // 4 vertices * 3 components
        let base_col = batch * 16;  // 4 vertices * 4 components

        // Load positions (AOS to SOA conversion)
        let (px, py, pz) = simd::load_vec3x4_aos(&positions[base_pos..]);

        // Load normals
        let (nx, ny, nz) = simd::load_vec3x4_aos(&normals[base_pos..]);

        // Start with ambient
        let mut r = ambient_r;
        let mut g = ambient_g;
        let mut b = ambient_b;

        // Hemisphere light
        if hemisphere.enabled {
            // blend = (nz + 1) * 0.5
            let one = f32x4_splat(1.0);
            let half = f32x4_splat(0.5);
            let blend = f32x4_mul(f32x4_add(nz, one), half);
            let inv_blend = f32x4_sub(one, blend);
            let intensity = f32x4_splat(hemisphere.intensity);

            // r += (ground * inv_blend + sky * blend) * intensity
            r = f32x4_add(r, f32x4_mul(f32x4_add(
                f32x4_mul(f32x4_splat(hemisphere.ground_color[0]), inv_blend),
                f32x4_mul(f32x4_splat(hemisphere.sky_color[0]), blend)
            ), intensity));
            g = f32x4_add(g, f32x4_mul(f32x4_add(
                f32x4_mul(f32x4_splat(hemisphere.ground_color[1]), inv_blend),
                f32x4_mul(f32x4_splat(hemisphere.sky_color[1]), blend)
            ), intensity));
            b = f32x4_add(b, f32x4_mul(f32x4_add(
                f32x4_mul(f32x4_splat(hemisphere.ground_color[2]), inv_blend),
                f32x4_mul(f32x4_splat(hemisphere.sky_color[2]), blend)
            ), intensity));
        }

        // Directional lights
        for light in dir_lights.iter() {
            if !light.enabled { continue; }

            let dir_x = f32x4_splat(light.direction[0]);
            let dir_y = f32x4_splat(light.direction[1]);
            let dir_z = f32x4_splat(light.direction[2]);

            // N dot L
            let ndotl = simd::dot3(nx, ny, nz, dir_x, dir_y, dir_z);

            // Clamp to positive (facing light)
            let zero = f32x4_splat(0.0);
            let ndotl_clamped = f32x4_max(ndotl, zero);

            // Diffuse contribution
            let intensity = f32x4_splat(light.intensity);
            let contrib = f32x4_mul(ndotl_clamped, intensity);

            r = f32x4_add(r, f32x4_mul(f32x4_splat(light.color[0]), contrib));
            g = f32x4_add(g, f32x4_mul(f32x4_splat(light.color[1]), contrib));
            b = f32x4_add(b, f32x4_mul(f32x4_splat(light.color[2]), contrib));

            // Specular (Blinn-Phong)
            if light.specular_enabled && specular.intensity > 0.0 {
                // View direction (vertex to camera)
                let cam_x = f32x4_splat(camera_pos[0]);
                let cam_y = f32x4_splat(camera_pos[1]);
                let cam_z = f32x4_splat(camera_pos[2]);

                let (view_x, view_y, view_z) = simd::normalize3(
                    f32x4_sub(cam_x, px),
                    f32x4_sub(cam_y, py),
                    f32x4_sub(cam_z, pz),
                );

                // Half vector
                let (half_x, half_y, half_z) = simd::normalize3(
                    f32x4_add(dir_x, view_x),
                    f32x4_add(dir_y, view_y),
                    f32x4_add(dir_z, view_z),
                );

                // N dot H
                let ndoth = simd::dot3(nx, ny, nz, half_x, half_y, half_z);
                let ndoth_clamped = f32x4_max(ndoth, zero);

                // spec = pow(NdotH, shininess) * intensity
                let spec = simd::pow4(ndoth_clamped, specular.shininess);
                let spec_contrib = f32x4_mul(f32x4_mul(spec, f32x4_splat(specular.intensity)), intensity);

                r = f32x4_add(r, f32x4_mul(f32x4_splat(light.color[0]), spec_contrib));
                g = f32x4_add(g, f32x4_mul(f32x4_splat(light.color[1]), spec_contrib));
                b = f32x4_add(b, f32x4_mul(f32x4_splat(light.color[2]), spec_contrib));
            }
        }

        // Spotlights
        for spot in spotlights.iter() {
            if !spot.enabled { continue; }

            // Light position
            let light_px = f32x4_splat(spot.position[0]);
            let light_py = f32x4_splat(spot.position[1]);
            let light_pz = f32x4_splat(spot.position[2]);

            // Vector from light to vertex
            let dx = f32x4_sub(px, light_px);
            let dy = f32x4_sub(py, light_py);
            let dz = f32x4_sub(pz, light_pz);

            // Distance
            let dist_sq = simd::dot3(dx, dy, dz, dx, dy, dz);
            let dist = f32x4_sqrt(dist_sq);

            // Skip if too close (avoid div by zero)
            let epsilon = f32x4_splat(0.0001);
            let safe_dist = f32x4_max(dist, epsilon);
            let inv_dist = f32x4_div(f32x4_splat(1.0), safe_dist);

            // Normalize direction from light to vertex
            let to_vert_x = f32x4_mul(dx, inv_dist);
            let to_vert_y = f32x4_mul(dy, inv_dist);
            let to_vert_z = f32x4_mul(dz, inv_dist);

            // Angular falloff: dot(spotDir, toVert)
            let spot_dir_x = f32x4_splat(spot.direction[0]);
            let spot_dir_y = f32x4_splat(spot.direction[1]);
            let spot_dir_z = f32x4_splat(spot.direction[2]);
            let cos_angle = simd::dot3(spot_dir_x, spot_dir_y, spot_dir_z, to_vert_x, to_vert_y, to_vert_z);

            // Cone attenuation
            let inner_cos = f32x4_splat(spot.inner_cos);
            let outer_cos = f32x4_splat(spot.outer_cos);
            let zero = f32x4_splat(0.0);
            let one = f32x4_splat(1.0);

            // t = (cos - outer) / (inner - outer), clamped to [0, 1]
            let cone_range = f32x4_sub(inner_cos, outer_cos);
            let t = f32x4_div(f32x4_sub(cos_angle, outer_cos), f32x4_max(cone_range, epsilon));
            let t_clamped = f32x4_min(f32x4_max(t, zero), one);
            let angular_atten = simd::pow4(t_clamped, spot.falloff);

            // Distance attenuation
            let dist_atten = if spot.range > 0.0 {
                let range = f32x4_splat(spot.range);
                let norm_dist = f32x4_div(dist, range);
                let range_atten = f32x4_sub(one, f32x4_mul(norm_dist, norm_dist));
                let range_atten_clamped = f32x4_max(range_atten, zero);
                f32x4_mul(range_atten_clamped, range_atten_clamped)
            } else {
                f32x4_div(one, f32x4_add(one, dist_sq))
            };

            // N dot L (light direction is negative of toVert)
            let light_dir_x = f32x4_neg(to_vert_x);
            let light_dir_y = f32x4_neg(to_vert_y);
            let light_dir_z = f32x4_neg(to_vert_z);
            let ndotl = simd::dot3(nx, ny, nz, light_dir_x, light_dir_y, light_dir_z);
            let ndotl_clamped = f32x4_max(ndotl, zero);

            // Combined attenuation
            let total_atten = f32x4_mul(f32x4_mul(angular_atten, dist_atten), f32x4_splat(spot.intensity));
            let contrib = f32x4_mul(ndotl_clamped, total_atten);

            // Add diffuse contribution
            r = f32x4_add(r, f32x4_mul(f32x4_splat(spot.color[0]), contrib));
            g = f32x4_add(g, f32x4_mul(f32x4_splat(spot.color[1]), contrib));
            b = f32x4_add(b, f32x4_mul(f32x4_splat(spot.color[2]), contrib));

            // Specular for spotlight
            if spot.specular_enabled && specular.intensity > 0.0 {
                let cam_x = f32x4_splat(camera_pos[0]);
                let cam_y = f32x4_splat(camera_pos[1]);
                let cam_z = f32x4_splat(camera_pos[2]);

                let (view_x, view_y, view_z) = simd::normalize3(
                    f32x4_sub(cam_x, px),
                    f32x4_sub(cam_y, py),
                    f32x4_sub(cam_z, pz),
                );

                let (half_x, half_y, half_z) = simd::normalize3(
                    f32x4_add(light_dir_x, view_x),
                    f32x4_add(light_dir_y, view_y),
                    f32x4_add(light_dir_z, view_z),
                );

                let ndoth = simd::dot3(nx, ny, nz, half_x, half_y, half_z);
                let ndoth_clamped = f32x4_max(ndoth, zero);

                let spec = simd::pow4(ndoth_clamped, specular.shininess);
                let spec_contrib = f32x4_mul(f32x4_mul(spec, f32x4_splat(specular.intensity)), total_atten);

                r = f32x4_add(r, f32x4_mul(f32x4_splat(spot.color[0]), spec_contrib));
                g = f32x4_add(g, f32x4_mul(f32x4_splat(spot.color[1]), spec_contrib));
                b = f32x4_add(b, f32x4_mul(f32x4_splat(spot.color[2]), spec_contrib));
            }
        }

        // Clamp to [0, 1]
        let zero = f32x4_splat(0.0);
        let one = f32x4_splat(1.0);
        r = f32x4_min(f32x4_max(r, zero), one);
        g = f32x4_min(f32x4_max(g, zero), one);
        b = f32x4_min(f32x4_max(b, zero), one);

        // Store output colors (SOA to AOS)
        simd::store_rgba4_aos(&mut out_colors[base_col..], r, g, b, one);
    }

    // Handle remaining vertices (scalar fallback)
    for i in (simd_count * 4)..vertex_count {
        let pos_idx = i * 3;
        let col_idx = i * 4;

        let nx = normals[pos_idx];
        let ny = normals[pos_idx + 1];
        let nz = normals[pos_idx + 2];

        let mut r = ambient[0];
        let mut g = ambient[1];
        let mut b = ambient[2];

        // Hemisphere
        if hemisphere.enabled {
            let blend = (nz + 1.0) * 0.5;
            let inv_blend = 1.0 - blend;
            r += (hemisphere.ground_color[0] * inv_blend + hemisphere.sky_color[0] * blend) * hemisphere.intensity;
            g += (hemisphere.ground_color[1] * inv_blend + hemisphere.sky_color[1] * blend) * hemisphere.intensity;
            b += (hemisphere.ground_color[2] * inv_blend + hemisphere.sky_color[2] * blend) * hemisphere.intensity;
        }

        // Directional lights
        for light in dir_lights.iter() {
            if !light.enabled { continue; }

            let ndotl = nx * light.direction[0] + ny * light.direction[1] + nz * light.direction[2];
            if ndotl > 0.0 {
                let contrib = ndotl * light.intensity;
                r += light.color[0] * contrib;
                g += light.color[1] * contrib;
                b += light.color[2] * contrib;
            }
        }

        // Spotlights (scalar)
        let px = positions[pos_idx];
        let py = positions[pos_idx + 1];
        let pz = positions[pos_idx + 2];

        for spot in spotlights.iter() {
            if !spot.enabled { continue; }

            let dx = px - spot.position[0];
            let dy = py - spot.position[1];
            let dz = pz - spot.position[2];
            let dist_sq = dx * dx + dy * dy + dz * dz;
            let dist = dist_sq.sqrt();

            if dist < 0.0001 { continue; }

            let inv_dist = 1.0 / dist;
            let to_vert_x = dx * inv_dist;
            let to_vert_y = dy * inv_dist;
            let to_vert_z = dz * inv_dist;

            let cos_angle = spot.direction[0] * to_vert_x + spot.direction[1] * to_vert_y + spot.direction[2] * to_vert_z;

            if cos_angle <= spot.outer_cos { continue; }

            let angular_atten = if cos_angle >= spot.inner_cos {
                1.0
            } else {
                let t = (cos_angle - spot.outer_cos) / (spot.inner_cos - spot.outer_cos);
                t.powf(spot.falloff)
            };

            let dist_atten = if spot.range > 0.0 {
                if dist >= spot.range { continue; }
                let norm_dist = dist / spot.range;
                let range_atten = 1.0 - norm_dist * norm_dist;
                range_atten * range_atten
            } else {
                1.0 / (1.0 + dist_sq)
            };

            let light_dir_x = -to_vert_x;
            let light_dir_y = -to_vert_y;
            let light_dir_z = -to_vert_z;
            let ndotl = nx * light_dir_x + ny * light_dir_y + nz * light_dir_z;

            if ndotl > 0.0 {
                let contrib = ndotl * spot.intensity * angular_atten * dist_atten;
                r += spot.color[0] * contrib;
                g += spot.color[1] * contrib;
                b += spot.color[2] * contrib;
            }
        }

        out_colors[col_idx] = r.min(1.0);
        out_colors[col_idx + 1] = g.min(1.0);
        out_colors[col_idx + 2] = b.min(1.0);
        out_colors[col_idx + 3] = 1.0;
    }
}

// Fallback for non-WASM targets (for testing)
#[cfg(not(target_arch = "wasm32"))]
pub fn calculate_lighting_simd(
    positions: &[f32],
    normals: &[f32],
    out_colors: &mut [f32],
    vertex_count: usize,
    ambient: &[f32; 3],
    dir_lights: &[DirectionalLight; 4],
    spotlights: &[SpotLight; 8],
    hemisphere: &HemisphereLight,
    specular: &SpecularConfig,
    camera_pos: &[f32; 3],
) {
    // Scalar fallback for non-WASM builds
    for i in 0..vertex_count {
        let col_idx = i * 4;
        out_colors[col_idx] = ambient[0];
        out_colors[col_idx + 1] = ambient[1];
        out_colors[col_idx + 2] = ambient[2];
        out_colors[col_idx + 3] = 1.0;
    }
}
