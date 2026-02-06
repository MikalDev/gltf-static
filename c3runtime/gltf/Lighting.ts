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
	/** Whether this light contributes specular highlights */
	specularEnabled: boolean;
}

export interface SpotLight {
	/** Unique identifier */
	id: number;
	/** Whether light is enabled */
	enabled: boolean;
	/** Light color RGB (0-1) */
	color: Float32Array;
	/** Light intensity multiplier */
	intensity: number;
	/** World-space position [x, y, z] */
	position: Float32Array;
	/** Direction the spotlight points (normalized, cone axis) */
	direction: Float32Array;
	/** Inner cone angle in radians (full intensity within this) */
	innerConeAngle: number;
	/** Outer cone angle in radians (zero intensity outside this) */
	outerConeAngle: number;
	/** Edge falloff exponent (1.0 = linear, higher = sharper transition) */
	falloffExponent: number;
	/** Maximum range (0 = infinite, no distance attenuation) */
	range: number;
	/** Whether this light contributes specular highlights */
	specularEnabled: boolean;
}

// ============================================================================
// Global Light State (accessible via globalThis)
// ============================================================================

export interface HemisphereLight {
	/** Whether hemisphere light is enabled */
	enabled: boolean;
	/** Sky color RGB (0-1) - applied to upward-facing normals */
	skyColor: Float32Array;
	/** Ground color RGB (0-1) - applied to downward-facing normals */
	groundColor: Float32Array;
	/** Intensity multiplier */
	intensity: number;
}

export interface SpecularConfig {
	/** Specular power/exponent (higher = tighter highlight) */
	shininess: number;
	/** Global specular intensity multiplier */
	intensity: number;
	/** Debug mode: output pure blue for any specular contribution */
	debugBlue?: boolean;
}

declare global {
	var gltfLights: DirectionalLight[];
	var gltfSpotLights: SpotLight[];
	var gltfLightIdCounter: number;
	var gltfAmbientLight: Float32Array;
	var gltfHemisphereLight: HemisphereLight;
	var gltfSpecular: SpecularConfig;
	var gltfLightingVersion: number;
}

// Initialize global light state if not exists
if (!globalThis.gltfLights) {
	globalThis.gltfLights = [];
	globalThis.gltfSpotLights = [];
	globalThis.gltfLightIdCounter = 0;
	globalThis.gltfAmbientLight = new Float32Array([0.2, 0.2, 0.2]);
	globalThis.gltfLightingVersion = 0;
}

// Initialize hemisphere light separately (may not exist from older versions)
if (!globalThis.gltfHemisphereLight) {
	globalThis.gltfHemisphereLight = {
		enabled: false,
		skyColor: new Float32Array([0.8, 0.9, 1.0]),      // Light blue sky
		groundColor: new Float32Array([0.2, 0.15, 0.1]),  // Brown ground
		intensity: 1.0
	};
}

// Initialize specular config (may not exist from older versions)
if (!globalThis.gltfSpecular) {
	globalThis.gltfSpecular = {
		shininess: 32.0,    // Default specular power
		intensity: 1.0      // Default specular intensity
	};
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
		direction: new Float32Array([nx, ny, nz]),
		specularEnabled: true
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
// Script Interface - Hemisphere Light
// ============================================================================

/**
 * Enable or disable hemisphere lighting.
 * Hemisphere lighting blends between sky and ground colors based on normal.y.
 */
export function setHemisphereLightEnabled(enabled: boolean): void {
	if (globalThis.gltfHemisphereLight.enabled !== enabled) {
		globalThis.gltfHemisphereLight.enabled = enabled;
		_markDirty();
	}
}

/**
 * Check if hemisphere lighting is enabled.
 */
export function isHemisphereLightEnabled(): boolean {
	return globalThis.gltfHemisphereLight.enabled;
}

/**
 * Set hemisphere light sky color (RGB 0-1).
 * Applied to upward-facing normals (normal.y = 1).
 */
export function setHemisphereLightSkyColor(r: number, g: number, b: number): void {
	const h = globalThis.gltfHemisphereLight;
	h.skyColor[0] = r;
	h.skyColor[1] = g;
	h.skyColor[2] = b;
	_markDirty();
}

/**
 * Set hemisphere light ground color (RGB 0-1).
 * Applied to downward-facing normals (normal.y = -1).
 */
export function setHemisphereLightGroundColor(r: number, g: number, b: number): void {
	const h = globalThis.gltfHemisphereLight;
	h.groundColor[0] = r;
	h.groundColor[1] = g;
	h.groundColor[2] = b;
	_markDirty();
}

/**
 * Set hemisphere light intensity multiplier.
 */
export function setHemisphereLightIntensity(intensity: number): void {
	if (globalThis.gltfHemisphereLight.intensity !== intensity) {
		globalThis.gltfHemisphereLight.intensity = Math.max(0, intensity);
		_markDirty();
	}
}

/**
 * Get the hemisphere light configuration.
 */
export function getHemisphereLight(): HemisphereLight {
	// Ensure hemisphere light exists (may be missing from older versions)
	if (!globalThis.gltfHemisphereLight) {
		globalThis.gltfHemisphereLight = {
			enabled: false,
			skyColor: new Float32Array([0.8, 0.9, 1.0]),
			groundColor: new Float32Array([0.2, 0.15, 0.1]),
			intensity: 1.0
		};
	}
	return globalThis.gltfHemisphereLight;
}

// ============================================================================
// Script Interface - Specular Configuration
// ============================================================================

/**
 * Enable or disable specular for a directional light.
 */
export function setLightSpecularEnabled(id: number, enabled: boolean): void {
	const light = getLight(id);
	if (light && light.specularEnabled !== enabled) {
		light.specularEnabled = enabled;
		_markDirty();
	}
}

/**
 * Check if specular is enabled for a directional light.
 */
export function isLightSpecularEnabled(id: number): boolean {
	return getLight(id)?.specularEnabled ?? false;
}

/**
 * Enable or disable specular for a spotlight.
 */
export function setSpotLightSpecularEnabled(id: number, enabled: boolean): void {
	const light = getSpotLight(id);
	if (light && light.specularEnabled !== enabled) {
		light.specularEnabled = enabled;
		_markDirty();
	}
}

/**
 * Check if specular is enabled for a spotlight.
 */
export function isSpotLightSpecularEnabled(id: number): boolean {
	return getSpotLight(id)?.specularEnabled ?? false;
}

/**
 * Set global specular shininess (power/exponent).
 * Higher values = tighter, more focused highlights.
 */
export function setSpecularShininess(shininess: number): void {
	if (globalThis.gltfSpecular.shininess !== shininess) {
		globalThis.gltfSpecular.shininess = Math.max(1, shininess);
		_markDirty();
	}
}

/**
 * Get global specular shininess.
 */
export function getSpecularShininess(): number {
	return globalThis.gltfSpecular.shininess;
}

/**
 * Set global specular intensity multiplier.
 */
export function setSpecularIntensity(intensity: number): void {
	if (globalThis.gltfSpecular.intensity !== intensity) {
		globalThis.gltfSpecular.intensity = Math.max(0, intensity);
		_markDirty();
	}
}

/**
 * Get global specular intensity.
 */
export function getSpecularIntensity(): number {
	return globalThis.gltfSpecular.intensity;
}

/**
 * Enable/disable specular debug mode.
 * When enabled, any specular contribution shows as pure blue for visibility testing.
 */
export function setSpecularDebugBlue(enabled: boolean): void {
	if (globalThis.gltfSpecular.debugBlue !== enabled) {
		globalThis.gltfSpecular.debugBlue = enabled;
		_markDirty();
	}
}

/**
 * Check if specular debug mode is enabled.
 */
export function isSpecularDebugBlue(): boolean {
	return globalThis.gltfSpecular.debugBlue ?? false;
}

/**
 * Get the specular configuration.
 */
export function getSpecularConfig(): SpecularConfig {
	// Ensure specular config exists (may be missing from older versions)
	if (!globalThis.gltfSpecular) {
		globalThis.gltfSpecular = {
			shininess: 32.0,
			intensity: 1.0
		};
	}
	return globalThis.gltfSpecular;
}

// ============================================================================
// Script Interface - Spotlight Management
// ============================================================================

const DEG_TO_RAD = Math.PI / 180;

/**
 * Create a spotlight.
 * @param posX Position X
 * @param posY Position Y
 * @param posZ Position Z
 * @param dirX Direction X (cone axis, will be normalized)
 * @param dirY Direction Y
 * @param dirZ Direction Z
 * @param innerAngleDeg Inner cone angle in degrees (full intensity within)
 * @param outerAngleDeg Outer cone angle in degrees (zero intensity outside)
 * @param falloffExponent Edge falloff exponent (default 1.0 = linear)
 * @param range Maximum range (default 0 = infinite)
 * @returns Light ID
 */
export function createSpotLight(
	posX: number, posY: number, posZ: number,
	dirX: number, dirY: number, dirZ: number,
	innerAngleDeg: number, outerAngleDeg: number,
	falloffExponent: number = 1.0,
	range: number = 0
): number {
	const id = globalThis.gltfLightIdCounter++;

	// Normalize direction
	const len = Math.sqrt(dirX * dirX + dirY * dirY + dirZ * dirZ);
	const nx = len > 0.0001 ? dirX / len : 0;
	const ny = len > 0.0001 ? dirY / len : -1;
	const nz = len > 0.0001 ? dirZ / len : 0;

	// Ensure outer angle >= inner angle
	if (outerAngleDeg < innerAngleDeg) {
		outerAngleDeg = innerAngleDeg;
	}

	const light: SpotLight = {
		id,
		enabled: true,
		color: new Float32Array([1, 1, 1]),
		intensity: 1.0,
		position: new Float32Array([posX, posY, posZ]),
		direction: new Float32Array([nx, ny, nz]),
		innerConeAngle: innerAngleDeg * DEG_TO_RAD,
		outerConeAngle: outerAngleDeg * DEG_TO_RAD,
		falloffExponent: Math.max(0.01, falloffExponent),
		range: Math.max(0, range),
		specularEnabled: true
	};

	globalThis.gltfSpotLights.push(light);
	_markDirty();
	return id;
}

/**
 * Get a spotlight by ID.
 */
export function getSpotLight(id: number): SpotLight | undefined {
	return globalThis.gltfSpotLights.find(l => l.id === id);
}

/**
 * Get all spotlights.
 */
export function getAllSpotLights(): readonly SpotLight[] {
	return globalThis.gltfSpotLights;
}

/**
 * Remove a spotlight by ID.
 */
export function removeSpotLight(id: number): boolean {
	const index = globalThis.gltfSpotLights.findIndex(l => l.id === id);
	if (index === -1) return false;
	globalThis.gltfSpotLights.splice(index, 1);
	_markDirty();
	return true;
}

/**
 * Remove all spotlights.
 */
export function removeAllSpotLights(): void {
	globalThis.gltfSpotLights.length = 0;
	_markDirty();
}

// ============================================================================
// Script Interface - Spotlight Configuration
// ============================================================================

/**
 * Enable or disable a spotlight.
 */
export function setSpotLightEnabled(id: number, enabled: boolean): void {
	const light = getSpotLight(id);
	if (light && light.enabled !== enabled) {
		light.enabled = enabled;
		_markDirty();
	}
}

/**
 * Check if a spotlight is enabled.
 */
export function isSpotLightEnabled(id: number): boolean {
	return getSpotLight(id)?.enabled ?? false;
}

/**
 * Set spotlight color (RGB 0-1).
 */
export function setSpotLightColor(id: number, r: number, g: number, b: number): void {
	const light = getSpotLight(id);
	if (light) {
		light.color[0] = r;
		light.color[1] = g;
		light.color[2] = b;
		_markDirty();
	}
}

/**
 * Set spotlight intensity.
 */
export function setSpotLightIntensity(id: number, intensity: number): void {
	const light = getSpotLight(id);
	if (light && light.intensity !== intensity) {
		light.intensity = Math.max(0, intensity);
		_markDirty();
	}
}

/**
 * Set spotlight position.
 */
export function setSpotLightPosition(id: number, x: number, y: number, z: number): void {
	const light = getSpotLight(id);
	if (light) {
		light.position[0] = x;
		light.position[1] = y;
		light.position[2] = z;
		_markDirty();
	}
}

/**
 * Set spotlight direction (cone axis, will be normalized).
 */
export function setSpotLightDirection(id: number, x: number, y: number, z: number): void {
	const light = getSpotLight(id);
	if (!light) return;

	const len = Math.sqrt(x * x + y * y + z * z);
	if (len > 0.0001) {
		light.direction[0] = x / len;
		light.direction[1] = y / len;
		light.direction[2] = z / len;
		_markDirty();
	}
}

/**
 * Set spotlight cone angles (in degrees).
 */
export function setSpotLightConeAngles(id: number, innerAngleDeg: number, outerAngleDeg: number): void {
	const light = getSpotLight(id);
	if (!light) return;

	// Ensure outer angle >= inner angle
	if (outerAngleDeg < innerAngleDeg) {
		outerAngleDeg = innerAngleDeg;
	}

	light.innerConeAngle = innerAngleDeg * DEG_TO_RAD;
	light.outerConeAngle = outerAngleDeg * DEG_TO_RAD;
	_markDirty();
}

/**
 * Set spotlight edge falloff exponent.
 * 1.0 = linear, 2.0 = smooth quadratic, <1.0 = sharper
 */
export function setSpotLightFalloff(id: number, exponent: number): void {
	const light = getSpotLight(id);
	if (light) {
		light.falloffExponent = Math.max(0.01, exponent);
		_markDirty();
	}
}

/**
 * Set spotlight range (0 = infinite).
 */
export function setSpotLightRange(id: number, range: number): void {
	const light = getSpotLight(id);
	if (light) {
		light.range = Math.max(0, range);
		_markDirty();
	}
}

/**
 * Get the number of spotlights.
 */
export function getSpotLightCount(): number {
	return globalThis.gltfSpotLights.length;
}

/**
 * Check if any spotlights exist and are enabled.
 */
export function hasEnabledSpotLights(): boolean {
	const lights = globalThis.gltfSpotLights;
	for (let i = 0; i < lights.length; i++) {
		if (lights[i].enabled) return true;
	}
	return false;
}

// ============================================================================
// Lighting Calculation
// ============================================================================

/**
 * Calculate lighting for an entire mesh.
 * Updates vertex colors based on normals and light configuration.
 *
 * @param positions Vertex positions (3 floats per vertex, model space) - required for spotlights
 * @param normals Vertex normals (3 floats per vertex, model space, normalized)
 * @param outColors Output vertex colors (4 floats per vertex: r, g, b, a)
 * @param vertexCount Number of vertices
 * @param modelMatrix Optional 4x4 model matrix to transform positions/normals to world space.
 *                    Pass null/undefined to skip transformation (already in world space).
 *                    Format: 16-element column-major mat4 (gl-matrix style)
 */
export function calculateMeshLighting(
	positions: Float32Array | null,
	normals: Float32Array,
	outColors: Float32Array,
	vertexCount: number,
	modelMatrix?: Float32Array | null,
	cameraPosition?: Float32Array | null
): void {
	const ambient = globalThis.gltfAmbientLight;
	const lights = globalThis.gltfLights;
	const spotLights = globalThis.gltfSpotLights;
	const specular = globalThis.gltfSpecular;

	// Extract matrix components if provided (4x4 column-major)
	const hasMatrix = modelMatrix && modelMatrix.length >= 16;

	// Rotation/scale part (upper-left 3x3)
	let m00 = 1, m01 = 0, m02 = 0;
	let m10 = 0, m11 = 1, m12 = 0;
	let m20 = 0, m21 = 0, m22 = 1;
	// Translation part
	let tx = 0, ty = 0, tz = 0;

	if (hasMatrix) {
		// 4x4 matrix (column-major like gl-matrix)
		m00 = modelMatrix[0]; m01 = modelMatrix[4]; m02 = modelMatrix[8];
		m10 = modelMatrix[1]; m11 = modelMatrix[5]; m12 = modelMatrix[9];
		m20 = modelMatrix[2]; m21 = modelMatrix[6]; m22 = modelMatrix[10];
		tx = modelMatrix[12]; ty = modelMatrix[13]; tz = modelMatrix[14];
	}

	// Check if we have spotlights to process
	const hasSpotLights = spotLights.length > 0 && positions !== null;

	// Check if we can do specular (need camera position and vertex positions)
	const canDoSpecular = cameraPosition && cameraPosition.length >= 3 && positions !== null && specular.intensity > 0;

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

		// Transform normal to world space if matrix provided
		if (hasMatrix) {
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

		// Hemisphere light contribution (blend sky/ground based on normal.z for Z-up)
		const hemisphere = globalThis.gltfHemisphereLight;
		if (hemisphere.enabled) {
			// Blend factor: normal.z from [-1, 1] maps to [0, 1]
			const blend = (nz + 1) * 0.5;
			const invBlend = 1 - blend;
			const hemiIntensity = hemisphere.intensity;
			r += (hemisphere.groundColor[0] * invBlend + hemisphere.skyColor[0] * blend) * hemiIntensity;
			g += (hemisphere.groundColor[1] * invBlend + hemisphere.skyColor[1] * blend) * hemiIntensity;
			b += (hemisphere.groundColor[2] * invBlend + hemisphere.skyColor[2] * blend) * hemiIntensity;
		}

		// Get vertex world position (needed for spotlights and specular)
		let px = 0, py = 0, pz = 0;
		let viewX = 0, viewY = 0, viewZ = 0;
		const needsWorldPos = hasSpotLights || canDoSpecular;

		if (needsWorldPos && positions) {
			px = positions[off3];
			py = positions[off3 + 1];
			pz = positions[off3 + 2];

			// Transform position to world space if matrix provided
			if (hasMatrix) {
				const wpx = m00 * px + m01 * py + m02 * pz + tx;
				const wpy = m10 * px + m11 * py + m12 * pz + ty;
				const wpz = m20 * px + m21 * py + m22 * pz + tz;
				px = wpx;
				py = wpy;
				pz = wpz;
			}

			// Calculate view direction for specular (vertex to camera)
			if (canDoSpecular) {
				const vx = cameraPosition![0] - px;
				const vy = cameraPosition![1] - py;
				const vz = cameraPosition![2] - pz;
				const vLen = Math.sqrt(vx * vx + vy * vy + vz * vz);
				if (vLen > 0.0001) {
					viewX = vx / vLen;
					viewY = vy / vLen;
					viewZ = vz / vLen;
				}
			}
		}

		// Accumulate contribution from all enabled directional lights
		for (let j = 0; j < lights.length; j++) {
			const light = lights[j];
			if (!light.enabled) continue;

			// Light direction (TO light, already normalized)
			const lightDirX = light.direction[0];
			const lightDirY = light.direction[1];
			const lightDirZ = light.direction[2];

			// N dot L (both normalized, direction is TO light)
			const NdotL = nx * lightDirX + ny * lightDirY + nz * lightDirZ;

			if (NdotL > 0) {
				// Diffuse contribution
				const contrib = NdotL * light.intensity;
				r += light.color[0] * contrib;
				g += light.color[1] * contrib;
				b += light.color[2] * contrib;

				// Specular contribution (Blinn-Phong)
				if (canDoSpecular && light.specularEnabled) {
					// Half vector: normalize(lightDir + viewDir)
					const hx = lightDirX + viewX;
					const hy = lightDirY + viewY;
					const hz = lightDirZ + viewZ;
					const hLen = Math.sqrt(hx * hx + hy * hy + hz * hz);
					if (hLen > 0.0001) {
						const halfX = hx / hLen;
						const halfY = hy / hLen;
						const halfZ = hz / hLen;

						const NdotH = nx * halfX + ny * halfY + nz * halfZ;

						// Debug mode: show blue regardless of NdotH sign (helps diagnose inversions)
						if (specular.debugBlue) {
							if (Math.abs(NdotH) > 0.01) {
								b += 1.0;
							}
						} else {
							// Clamp to avoid NaN from negative values with fractional exponents
							const spec = Math.pow(Math.max(0, NdotH), specular.shininess) * specular.intensity * light.intensity;
							r += light.color[0] * spec;
							g += light.color[1] * spec;
							b += light.color[2] * spec;
						}
					}
				}
			}
		}

		// Accumulate contribution from all enabled spotlights
		if (hasSpotLights) {

			for (let j = 0; j < spotLights.length; j++) {
				const spot = spotLights[j];
				if (!spot.enabled) continue;

				// Vector from light to vertex
				const dx = px - spot.position[0];
				const dy = py - spot.position[1];
				const dz = pz - spot.position[2];
				const distSq = dx * dx + dy * dy + dz * dz;
				const dist = Math.sqrt(distSq);

				if (dist < 0.0001) continue; // Avoid division by zero

				// Normalize direction from light to vertex
				const invDist = 1 / dist;
				const toVertX = dx * invDist;
				const toVertY = dy * invDist;
				const toVertZ = dz * invDist;

				// Angular falloff: dot product of spot direction and light-to-vertex
				// spot.direction points in the direction the light shines
				const cosAngle = spot.direction[0] * toVertX + spot.direction[1] * toVertY + spot.direction[2] * toVertZ;

				// Precompute cone angle cosines
				const innerCos = Math.cos(spot.innerConeAngle);
				const outerCos = Math.cos(spot.outerConeAngle);

				// Outside outer cone - no contribution
				if (cosAngle <= outerCos) continue;

				// Calculate angular attenuation
				let angularAtten: number;
				if (cosAngle >= innerCos) {
					// Inside inner cone - full intensity
					angularAtten = 1;
				} else {
					// In penumbra - smooth falloff
					const t = (cosAngle - outerCos) / (innerCos - outerCos);
					angularAtten = Math.pow(t, spot.falloffExponent);
				}

				// Distance attenuation
				let distAtten = 1;
				if (spot.range > 0) {
					// Smooth falloff to zero at range
					if (dist >= spot.range) continue;
					const normalizedDist = dist / spot.range;
					const rangeAtten = 1 - normalizedDist * normalizedDist;
					distAtten = rangeAtten * rangeAtten;
				} else {
					// Inverse square falloff (with offset to avoid infinity at 0)
					distAtten = 1 / (1 + distSq);
				}

				// N dot L: direction FROM vertex TO light is negative of toVert
				const lightDirX = -toVertX;
				const lightDirY = -toVertY;
				const lightDirZ = -toVertZ;
				const NdotL = nx * lightDirX + ny * lightDirY + nz * lightDirZ;

				if (NdotL > 0) {
					// Diffuse contribution
					const contrib = NdotL * spot.intensity * angularAtten * distAtten;
					r += spot.color[0] * contrib;
					g += spot.color[1] * contrib;
					b += spot.color[2] * contrib;

					// Specular contribution (Blinn-Phong)
					if (canDoSpecular && spot.specularEnabled) {
						// Half vector: normalize(lightDir + viewDir)
						const hx = lightDirX + viewX;
						const hy = lightDirY + viewY;
						const hz = lightDirZ + viewZ;
						const hLen = Math.sqrt(hx * hx + hy * hy + hz * hz);
						if (hLen > 0.0001) {
							const halfX = hx / hLen;
							const halfY = hy / hLen;
							const halfZ = hz / hLen;

							const NdotH = nx * halfX + ny * halfY + nz * halfZ;

							// Debug mode: show blue regardless of NdotH sign
							if (specular.debugBlue) {
								if (Math.abs(NdotH) > 0.01) {
									b -= 1.0;
								}
							} else {
								// Clamp to avoid NaN from negative values with fractional exponents
								const spec = Math.pow(Math.max(0, NdotH), specular.shininess) * specular.intensity * spot.intensity * angularAtten * distAtten;
								r += spot.color[0] * spec;
								g += spot.color[1] * spec;
								b += spot.color[2] * spec;
							}
						}
					}
				}
			}
		}

		// Write output (clamped, alpha = 1)
		outColors[off4] = r > 2 ? 2 : r;
		outColors[off4 + 1] = g > 2 ? 2 : g;
		outColors[off4 + 2] = b > 2 ? 2 : b;
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

// Store last camera info for debugging
let _debugCameraPosition: Float32Array | null = null;
let _debugCameraDirection: Float32Array | null = null;

/**
 * Set camera position/direction for debug purposes.
 * Called automatically by instance when building light config.
 */
export function setDebugCamera(position: Float32Array | null, direction?: Float32Array | null): void {
	_debugCameraPosition = position;
	_debugCameraDirection = direction || null;
}

/**
 * Debug function to dump current lighting state to console.
 * Call from console: globalThis.GltfBundle.Lighting.debugLightingState()
 */
export function debugLightingState(): void {
	console.log("=== LIGHTING DEBUG STATE ===");
	console.log("Ambient:", Array.from(globalThis.gltfAmbientLight));
	console.log("Specular Config:", globalThis.gltfSpecular);
	console.log("Hemisphere:", globalThis.gltfHemisphereLight);
	console.log("Lighting Version:", globalThis.gltfLightingVersion);

	console.log("\nCamera:");
	if (_debugCameraPosition) {
		console.log("  Position:", Array.from(_debugCameraPosition));
	} else {
		console.log("  Position: NOT SET (specular won't work)");
	}
	if (_debugCameraDirection) {
		console.log("  Direction:", Array.from(_debugCameraDirection));
	}

	console.log("\nDirectional Lights (" + globalThis.gltfLights.length + "):");
	globalThis.gltfLights.forEach((light, i) => {
		console.log(`  [${i}] id=${light.id}, enabled=${light.enabled}, specularEnabled=${light.specularEnabled}`);
		console.log(`      color=[${Array.from(light.color)}], intensity=${light.intensity}`);
		console.log(`      direction=[${Array.from(light.direction)}]`);
	});

	console.log("\nSpotlights (" + globalThis.gltfSpotLights.length + "):");
	globalThis.gltfSpotLights.forEach((light, i) => {
		console.log(`  [${i}] id=${light.id}, enabled=${light.enabled}, specularEnabled=${light.specularEnabled}`);
		console.log(`      color=[${Array.from(light.color)}], intensity=${light.intensity}`);
		console.log(`      position=[${Array.from(light.position)}]`);
		console.log(`      direction=[${Array.from(light.direction)}]`);
	});

	console.log("=== END DEBUG STATE ===");
}
