/**
 * Global Vertex Lighting System
 *
 * Provides script interface to create, enable, disable, and configure directional lights.
 * Uses globalThis for cross-module access (required for C3 worker compatibility).
 *
 * Light direction convention: direction vector points TO the light source (standard shader convention).
 */

// ============================================================================
// Light Types
// ============================================================================

export interface DirectionalLight {
	/** Unique identifier */
	id: number;
	/** Whether light is enabled */
	enabled: boolean;
	/** Light color RGB (0-1) */
	color: Float32Array;
	/** Light intensity multiplier */
	intensity: number;
	/** Direction TO the light source (normalized) */
	direction: Float32Array;
}

// ============================================================================
// Global Light State (accessible via globalThis)
// ============================================================================

declare global {
	var gltfLights: DirectionalLight[];
	var gltfLightIdCounter: number;
	var gltfAmbientLight: Float32Array;
	var gltfLightingVersion: number;
}

// Initialize global light state if not exists
if (!globalThis.gltfLights) {
	globalThis.gltfLights = [];
	globalThis.gltfLightIdCounter = 0;
	globalThis.gltfAmbientLight = new Float32Array([0.2, 0.2, 0.2]);
	globalThis.gltfLightingVersion = 0;

	// Create default directional light (sun-like, from above and angled)
	// Direction TO light: normalized (1, 2, -1) - light coming from upper-front-left
	const len = Math.sqrt(1 + 4 + 1); // sqrt(6) ≈ 2.449
	const defaultLight: DirectionalLight = {
		id: globalThis.gltfLightIdCounter++,
		enabled: true,
		color: new Float32Array([1, 0.98, 0.9]),  // Warm white
		intensity: 0.8,
		direction: new Float32Array([1 / len, 2 / len, -1 / len])
	};
	globalThis.gltfLights.push(defaultLight);
	globalThis.gltfLightingVersion++;
}

// ============================================================================
// Pre-allocated temp buffers (avoid allocations in hot path)
// ============================================================================

const _tempColor = new Float32Array(3);

// ============================================================================
// Dirty Tracking
// ============================================================================

/**
 * Get current lighting version. Increments when any light property changes.
 * Use to implement dirty checking and skip redundant lighting calculations.
 */
export function getVersion(): number {
	return globalThis.gltfLightingVersion;
}

/** Internal: bump version on any change */
function _markDirty(): void {
	globalThis.gltfLightingVersion++;
}

// ============================================================================
// Script Interface - Light Management
// ============================================================================

/**
 * Create a directional light.
 * @param dirX Direction X component (TO the light)
 * @param dirY Direction Y component (TO the light)
 * @param dirZ Direction Z component (TO the light)
 * @returns Light ID
 */
export function createDirectionalLight(dirX: number, dirY: number, dirZ: number): number {
	const id = globalThis.gltfLightIdCounter++;

	// Normalize direction
	const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
	const nx = len > 0.0001 ? dirX / len : 0;
	const ny = len > 0.0001 ? dirY / len : 1;
	const nz = len > 0.0001 ? dirZ / len : 0;

	const light: DirectionalLight = {
		id,
		enabled: true,
		color: new Float32Array([1, 1, 1]),
		intensity: 1.0,
		direction: new Float32Array([nx, ny, nz])
	};

	globalThis.gltfLights.push(light);
	_markDirty();
	return id;
}

/**
 * Get a light by ID.
 */
export function getLight(id: number): DirectionalLight | undefined {
	return globalThis.gltfLights.find(l => l.id === id);
}

/**
 * Get all lights.
 */
export function getAllLights(): readonly DirectionalLight[] {
	return globalThis.gltfLights;
}

/**
 * Remove a light by ID.
 */
export function removeLight(id: number): boolean {
	const index = globalThis.gltfLights.findIndex(l => l.id === id);
	if (index === -1) return false;
	globalThis.gltfLights.splice(index, 1);
	_markDirty();
	return true;
}

/**
 * Remove all lights.
 */
export function removeAllLights(): void {
	globalThis.gltfLights.length = 0;
	_markDirty();
}

// ============================================================================
// Script Interface - Light Configuration
// ============================================================================

/**
 * Enable or disable a light.
 */
export function setLightEnabled(id: number, enabled: boolean): void {
	const light = getLight(id);
	if (light && light.enabled !== enabled) {
		light.enabled = enabled;
		_markDirty();
	}
}

/**
 * Check if a light is enabled.
 */
export function isLightEnabled(id: number): boolean {
	return getLight(id)?.enabled ?? false;
}

/**
 * Set light color (RGB 0-1).
 */
export function setLightColor(id: number, r: number, g: number, b: number): void {
	const light = getLight(id);
	if (light) {
		light.color[0] = r;
		light.color[1] = g;
		light.color[2] = b;
		_markDirty();
	}
}

/**
 * Set light intensity.
 */
export function setLightIntensity(id: number, intensity: number): void {
	const light = getLight(id);
	if (light && light.intensity !== intensity) {
		light.intensity = Math.max(0, intensity);
		_markDirty();
	}
}

/**
 * Set light direction (TO the light source, will be normalized).
 */
export function setLightDirection(id: number, x: number, y: number, z: number): void {
	const light = getLight(id);
	if (!light) return;

	const len = Math.sqrt(x * x + y * y + z * z);
	if (len > 0.0001) {
		light.direction[0] = x / len;
		light.direction[1] = y / len;
		light.direction[2] = z / len;
		_markDirty();
	}
}

// ============================================================================
// Script Interface - Ambient Light
// ============================================================================

/**
 * Set global ambient light color (RGB 0-1).
 */
export function setAmbientLight(r: number, g: number, b: number): void {
	globalThis.gltfAmbientLight[0] = r;
	globalThis.gltfAmbientLight[1] = g;
	globalThis.gltfAmbientLight[2] = b;
	_markDirty();
}

/**
 * Get global ambient light color.
 */
export function getAmbientLight(): Float32Array {
	return globalThis.gltfAmbientLight;
}

// ============================================================================
// Lighting Calculation
// ============================================================================

/**
 * Calculate lighting for an entire mesh.
 * Updates vertex colors based on normals and light configuration.
 *
 * @param normals Vertex normals (3 floats per vertex, model space, normalized)
 * @param outColors Output vertex colors (4 floats per vertex: r, g, b, a)
 * @param vertexCount Number of vertices
 * @param modelRotation Optional 3x3 rotation matrix (upper-left of 4x4) to transform normals to world space.
 *                      Pass null/undefined to skip transformation (normals already in world space).
 *                      Format: [m00, m01, m02, m10, m11, m12, m20, m21, m22] (row-major 3x3)
 *                      Or pass a 16-element mat4 and only the upper-left 3x3 will be used.
 */
export function calculateMeshLighting(
	normals: Float32Array,
	outColors: Float32Array,
	vertexCount: number,
	modelRotation?: Float32Array | null
): void {
	const ambient = globalThis.gltfAmbientLight;
	const lights = globalThis.gltfLights;

	// Extract rotation matrix components if provided
	// Support both 3x3 (9 elements) and 4x4 (16 elements) matrices
	const hasRotation = modelRotation && modelRotation.length >= 9;
	let m00 = 1, m01 = 0, m02 = 0;
	let m10 = 0, m11 = 1, m12 = 0;
	let m20 = 0, m21 = 0, m22 = 1;

	if (hasRotation) {
		if (modelRotation.length >= 16) {
			// 4x4 matrix (column-major like gl-matrix)
			m00 = modelRotation[0]; m01 = modelRotation[4]; m02 = modelRotation[8];
			m10 = modelRotation[1]; m11 = modelRotation[5]; m12 = modelRotation[9];
			m20 = modelRotation[2]; m21 = modelRotation[6]; m22 = modelRotation[10];
		} else {
			// 3x3 matrix (row-major)
			m00 = modelRotation[0]; m01 = modelRotation[1]; m02 = modelRotation[2];
			m10 = modelRotation[3]; m11 = modelRotation[4]; m12 = modelRotation[5];
			m20 = modelRotation[6]; m21 = modelRotation[7]; m22 = modelRotation[8];
		}
	}

	for (let i = 0; i < vertexCount; i++) {
		const off3 = i * 3;
		const off4 = i * 4;

		// Start with ambient
		let r = ambient[0];
		let g = ambient[1];
		let b = ambient[2];

		// Normal components (model space)
		let nx = normals[off3];
		let ny = normals[off3 + 1];
		let nz = normals[off3 + 2];

		// Transform normal to world space if rotation provided
		if (hasRotation) {
			const wnx = m00 * nx + m01 * ny + m02 * nz;
			const wny = m10 * nx + m11 * ny + m12 * nz;
			const wnz = m20 * nx + m21 * ny + m22 * nz;
			// Renormalize in case of non-uniform scale
			const len = Math.sqrt(wnx * wnx + wny * wny + wnz * wnz);
			if (len > 0.0001) {
				nx = wnx / len;
				ny = wny / len;
				nz = wnz / len;
			}
		}

		// Accumulate contribution from all enabled lights
		for (let j = 0; j < lights.length; j++) {
			const light = lights[j];
			if (!light.enabled) continue;

			// N dot L (both normalized, direction is TO light)
			const NdotL = nx * light.direction[0] + ny * light.direction[1] + nz * light.direction[2];

			if (NdotL > 0) {
				const contrib = NdotL * light.intensity;
				r += light.color[0] * contrib;
				g += light.color[1] * contrib;
				b += light.color[2] * contrib;
			}
		}

		// Write output (clamped, alpha = 1)
		outColors[off4] = r > 1 ? 1 : r;
		outColors[off4 + 1] = g > 1 ? 1 : g;
		outColors[off4 + 2] = b > 1 ? 1 : b;
		outColors[off4 + 3] = 1;
	}
}

/**
 * Check if any lights exist and are enabled.
 */
export function hasEnabledLights(): boolean {
	const lights = globalThis.gltfLights;
	for (let i = 0; i < lights.length; i++) {
		if (lights[i].enabled) return true;
	}
	return false;
}

/**
 * Get the number of lights.
 */
export function getLightCount(): number {
	return globalThis.gltfLights.length;
}
