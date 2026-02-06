/**
 * Manages a pool of transform workers for parallel vertex processing.
 *
 * Design principles:
 * - KISS: Simple callback-based API, no complex promise chains
 * - Single Responsibility: Only manages worker communication and batching
 * - Dependency Inversion: Meshes provide callbacks, pool doesn't know about meshData
 */

const LOG_PREFIX = "[SharedWorkerPool]";

function debugLog(...args: unknown[]): void {
	if (globalThis.gltfDebug) console.log(LOG_PREFIX, ...args);
}

// Inline worker code as string for blob URL creation (avoids separate file bundling)
const WORKER_CODE = `
const meshCache = new Map();
const skinnedMeshCache = new Map();
const staticLightingCache = new Map();

// Transform vertices from original to output buffer at specified offset
function transformVerticesInto(original, output, offset, matrix, vertexCount) {
	const m0 = matrix[0], m1 = matrix[1], m2 = matrix[2];
	const m4 = matrix[4], m5 = matrix[5], m6 = matrix[6];
	const m8 = matrix[8], m9 = matrix[9], m10 = matrix[10];
	const m12 = matrix[12], m13 = matrix[13], m14 = matrix[14];

	for (let i = 0; i < vertexCount; i++) {
		const srcIdx = i * 3;
		const dstIdx = offset + srcIdx;
		const x = original[srcIdx];
		const y = original[srcIdx + 1];
		const z = original[srcIdx + 2];

		output[dstIdx] = m0 * x + m4 * y + m8 * z + m12;
		output[dstIdx + 1] = m1 * x + m5 * y + m9 * z + m13;
		output[dstIdx + 2] = m2 * x + m6 * y + m10 * z + m14;
	}
}

// Calculate vertex lighting from positions, normals and light configuration
// positions: vertex positions in model space (3 floats per vertex) - needed for spotlights
// normals: skinned normals in model space (3 floats per vertex)
// outColors: output RGBA colors (4 floats per vertex)
// posOffset: offset in positions buffer (in floats, i.e., vertex * 3)
// normalOffset: offset in normals buffer (in floats, i.e., vertex * 3)
// colorOffset: offset in colors buffer (in floats, i.e., vertex * 4)
// modelMatrix: optional 4x4 matrix to transform positions/normals to world space
// lightConfig: { ambient, lights, spotLights }
function calculateLighting(positions, normals, outColors, posOffset, normalOffset, colorOffset, vertexCount, modelMatrix, lightConfig) {
	const ambient = lightConfig.ambient;
	const lights = lightConfig.lights;
	const spotLights = lightConfig.spotLights || [];
	const specular = lightConfig.specular;
	const cameraPosition = lightConfig.cameraPosition;

	// Extract matrix components if provided (4x4 column-major)
	const hasMatrix = modelMatrix && modelMatrix.length >= 16;

	// Rotation/scale part (upper-left 3x3)
	let m00 = 1, m01 = 0, m02 = 0;
	let m10 = 0, m11 = 1, m12 = 0;
	let m20 = 0, m21 = 0, m22 = 1;
	// Translation part
	let tx = 0, ty = 0, tz = 0;

	if (hasMatrix) {
		m00 = modelMatrix[0]; m01 = modelMatrix[4]; m02 = modelMatrix[8];
		m10 = modelMatrix[1]; m11 = modelMatrix[5]; m12 = modelMatrix[9];
		m20 = modelMatrix[2]; m21 = modelMatrix[6]; m22 = modelMatrix[10];
		tx = modelMatrix[12]; ty = modelMatrix[13]; tz = modelMatrix[14];
	}

	const hasSpotLights = spotLights.length > 0 && positions !== null;
	const canDoSpecular = cameraPosition && cameraPosition.length >= 3 && positions !== null && specular && specular.intensity > 0;

	for (let i = 0; i < vertexCount; i++) {
		const pOff3 = posOffset + i * 3;
		const nOff3 = normalOffset + i * 3;
		const off4 = colorOffset + i * 4;

		// Start with ambient
		let r = ambient[0];
		let g = ambient[1];
		let b = ambient[2];

		// Normal components (model space)
		let nx = normals[nOff3];
		let ny = normals[nOff3 + 1];
		let nz = normals[nOff3 + 2];

		// Transform normal to world space if matrix provided
		if (hasMatrix) {
			const wnx = m00 * nx + m01 * ny + m02 * nz;
			const wny = m10 * nx + m11 * ny + m12 * nz;
			const wnz = m20 * nx + m21 * ny + m22 * nz;
			const len = Math.sqrt(wnx * wnx + wny * wny + wnz * wnz);
			if (len > 0.0001) {
				nx = wnx / len;
				ny = wny / len;
				nz = wnz / len;
			}
		}

		// Hemisphere light contribution (blend sky/ground based on normal.z for Z-up)
		if (lightConfig.hemisphere && lightConfig.hemisphere.enabled) {
			const hemi = lightConfig.hemisphere;
			const blend = (nz + 1) * 0.5;
			const invBlend = 1 - blend;
			const hemiIntensity = hemi.intensity;
			r += (hemi.groundColor[0] * invBlend + hemi.skyColor[0] * blend) * hemiIntensity;
			g += (hemi.groundColor[1] * invBlend + hemi.skyColor[1] * blend) * hemiIntensity;
			b += (hemi.groundColor[2] * invBlend + hemi.skyColor[2] * blend) * hemiIntensity;
		}

		// Get vertex world position (needed for spotlights and specular)
		let px = 0, py = 0, pz = 0;
		let viewX = 0, viewY = 0, viewZ = 0;
		const needsWorldPos = hasSpotLights || canDoSpecular;

		if (needsWorldPos && positions) {
			px = positions[pOff3];
			py = positions[pOff3 + 1];
			pz = positions[pOff3 + 2];

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
				const vx = cameraPosition[0] - px;
				const vy = cameraPosition[1] - py;
				const vz = cameraPosition[2] - pz;
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

						// Debug mode: show color regardless of NdotH sign (helps diagnose inversions)
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

				if (dist < 0.0001) continue;

				const invDist = 1 / dist;
				const toVertX = dx * invDist;
				const toVertY = dy * invDist;
				const toVertZ = dz * invDist;

				// Angular falloff
				const cosAngle = spot.direction[0] * toVertX + spot.direction[1] * toVertY + spot.direction[2] * toVertZ;
				const innerCos = Math.cos(spot.innerConeAngle);
				const outerCos = Math.cos(spot.outerConeAngle);

				if (cosAngle <= outerCos) continue;

				let angularAtten;
				if (cosAngle >= innerCos) {
					angularAtten = 1;
				} else {
					const t = (cosAngle - outerCos) / (innerCos - outerCos);
					angularAtten = Math.pow(t, spot.falloffExponent);
				}

				// Distance attenuation
				let distAtten = 1;
				if (spot.range > 0) {
					if (dist >= spot.range) continue;
					const normalizedDist = dist / spot.range;
					const rangeAtten = 1 - normalizedDist * normalizedDist;
					distAtten = rangeAtten * rangeAtten;
				} else {
					distAtten = 1 / (1 + distSq);
				}

				// N dot L
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

							// Debug mode: show color regardless of NdotH sign
							if (specular.debugBlue) {
								if (Math.abs(NdotH) > 0.01) {
									b += 1.0;
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

// Apply CPU skinning to positions and normals
// boneMatrices: flattened array of 4x4 matrices (16 floats per bone)
// joints: per-vertex joint indices (4 per vertex)
// weights: per-vertex weights (4 per vertex)
function skinMeshInto(origPositions, origNormals, outPositions, outNormals, offset, boneMatrices, joints, weights, vertexCount) {
	const hasNormals = origNormals !== null && outNormals !== null;

	for (let v = 0; v < vertexCount; v++) {
		const posOffset = v * 3;
		const skinOffset = v * 4;
		const dstOffset = offset + posOffset;

		// Read original position
		const px = origPositions[posOffset];
		const py = origPositions[posOffset + 1];
		const pz = origPositions[posOffset + 2];

		// Read original normal if available
		let nx = 0, ny = 0, nz = 0;
		if (hasNormals) {
			nx = origNormals[posOffset];
			ny = origNormals[posOffset + 1];
			nz = origNormals[posOffset + 2];
		}

		// Accumulate weighted transforms
		let rpx = 0, rpy = 0, rpz = 0;
		let rnx = 0, rny = 0, rnz = 0;

		for (let j = 0; j < 4; j++) {
			const weight = weights[skinOffset + j];
			if (weight === 0) continue;

			const jointIdx = joints[skinOffset + j];
			const boneOffset = jointIdx * 16;
			const m = boneMatrices;

			// Transform position by bone matrix: result = M * p (with w=1)
			const tx = m[boneOffset + 0] * px + m[boneOffset + 4] * py + m[boneOffset + 8] * pz + m[boneOffset + 12];
			const ty = m[boneOffset + 1] * px + m[boneOffset + 5] * py + m[boneOffset + 9] * pz + m[boneOffset + 13];
			const tz = m[boneOffset + 2] * px + m[boneOffset + 6] * py + m[boneOffset + 10] * pz + m[boneOffset + 14];

			rpx += tx * weight;
			rpy += ty * weight;
			rpz += tz * weight;

			// Transform normal by upper-left 3x3 (no translation)
			if (hasNormals) {
				const tnx = m[boneOffset + 0] * nx + m[boneOffset + 4] * ny + m[boneOffset + 8] * nz;
				const tny = m[boneOffset + 1] * nx + m[boneOffset + 5] * ny + m[boneOffset + 9] * nz;
				const tnz = m[boneOffset + 2] * nx + m[boneOffset + 6] * ny + m[boneOffset + 10] * nz;
				rnx += tnx * weight;
				rny += tny * weight;
				rnz += tnz * weight;
			}
		}

		// Write skinned position
		outPositions[dstOffset] = rpx;
		outPositions[dstOffset + 1] = rpy;
		outPositions[dstOffset + 2] = rpz;

		// Write skinned normal (normalized)
		if (hasNormals) {
			const len = Math.sqrt(rnx * rnx + rny * rny + rnz * rnz);
			if (len > 0.0001) {
				outNormals[dstOffset] = rnx / len;
				outNormals[dstOffset + 1] = rny / len;
				outNormals[dstOffset + 2] = rnz / len;
			} else {
				outNormals[dstOffset] = 0;
				outNormals[dstOffset + 1] = 1;
				outNormals[dstOffset + 2] = 0;
			}
		}
	}
}

self.onmessage = (e) => {
	const msg = e.data;

	switch (msg.type) {
		case "REGISTER": {
			const positions = msg.positions;
			const vertexCount = positions.length / 3;
			meshCache.set(msg.meshId, {
				original: positions,
				vertexCount,
				floatCount: positions.length
			});
			break;
		}

		case "REGISTER_SKIN": {
			// Register a skinned mesh with bind pose positions, normals, and skinning data
			const vertexCount = msg.positions.length / 3;
			skinnedMeshCache.set(msg.meshId, {
				positions: msg.positions,  // transferred
				normals: msg.normals || null,  // transferred (optional)
				joints: msg.joints,        // transferred
				weights: msg.weights,      // transferred
				vertexCount,
				floatCount: msg.positions.length
			});
			break;
		}

		case "TRANSFORM_BATCH": {
			// Calculate total size needed for packed buffer
			let totalFloats = 0;
			const meshEntries = [];
			for (const req of msg.requests) {
				const entry = meshCache.get(req.meshId);
				if (!entry) continue;
				totalFloats += entry.floatCount;
				meshEntries.push({ req, entry });
			}

			if (meshEntries.length === 0) {
				// No valid meshes, send empty response
				self.postMessage({ type: "TRANSFORM_RESULTS", meshIds: new Uint32Array(0), offsets: new Uint32Array(1), positions: new Float32Array(0) }, []);
				break;
			}

			// Allocate single packed buffer
			const packedPositions = new Float32Array(totalFloats);
			const offsets = new Uint32Array(meshEntries.length + 1);
			const meshIds = new Uint32Array(meshEntries.length);

			let offset = 0;
			for (let i = 0; i < meshEntries.length; i++) {
				const { req, entry } = meshEntries[i];

				// Transform into packed buffer directly
				transformVerticesInto(entry.original, packedPositions, offset, req.matrix, entry.vertexCount);

				meshIds[i] = req.meshId;
				offsets[i] = offset;
				offset += entry.floatCount;
			}
			offsets[meshEntries.length] = offset; // End marker

			self.postMessage(
				{ type: "TRANSFORM_RESULTS", meshIds, offsets, positions: packedPositions },
				[packedPositions.buffer, meshIds.buffer, offsets.buffer]
			);
			break;
		}

		case "SKIN_BATCH": {
			// Process skinning for multiple meshes sharing the same bone matrices
			const boneMatrices = msg.boneMatrices;
			const requestedMeshIds = msg.meshIds;
			const lightConfig = msg.lightConfig; // Optional: { ambient, lights, modelRotation }

			// Calculate total size and check if any mesh has normals
			let totalFloats = 0;
			let totalVertices = 0;
			let hasAnyNormals = false;
			const meshEntries = [];
			for (const meshId of requestedMeshIds) {
				const entry = skinnedMeshCache.get(meshId);
				if (!entry) continue;
				totalFloats += entry.floatCount;
				totalVertices += entry.vertexCount;
				if (entry.normals) hasAnyNormals = true;
				meshEntries.push({ meshId, entry });
			}

			if (meshEntries.length === 0) {
				self.postMessage({ type: "SKIN_RESULTS", meshIds: new Uint32Array(0), offsets: new Uint32Array(1), positions: new Float32Array(0), normals: null, colors: null }, []);
				break;
			}

			// Allocate packed buffers
			const packedPositions = new Float32Array(totalFloats);
			const packedNormals = hasAnyNormals ? new Float32Array(totalFloats) : null;
			const packedColors = (lightConfig && hasAnyNormals) ? new Float32Array(totalVertices * 4) : null;
			const offsets = new Uint32Array(meshEntries.length + 1);
			const meshIds = new Uint32Array(meshEntries.length);

			let offset = 0;
			let colorOffset = 0;
			for (let i = 0; i < meshEntries.length; i++) {
				const { meshId, entry } = meshEntries[i];

				// Apply skinning to positions and normals
				skinMeshInto(
					entry.positions, entry.normals,
					packedPositions, packedNormals,
					offset, boneMatrices, entry.joints, entry.weights, entry.vertexCount
				);

				// Calculate lighting if config provided and mesh has normals
				if (packedColors && packedNormals && entry.normals) {
					calculateLighting(
						packedPositions, packedNormals, packedColors,
						offset, offset, colorOffset, entry.vertexCount,
						lightConfig.modelMatrix, lightConfig
					);
				}

				meshIds[i] = meshId;
				offsets[i] = offset;
				offset += entry.floatCount;
				colorOffset += entry.vertexCount * 4;
			}
			offsets[meshEntries.length] = offset;

			const transferList = [packedPositions.buffer, meshIds.buffer, offsets.buffer];
			if (packedNormals) transferList.push(packedNormals.buffer);
			if (packedColors) transferList.push(packedColors.buffer);

			self.postMessage(
				{ type: "SKIN_RESULTS", meshIds, offsets, positions: packedPositions, normals: packedNormals, colors: packedColors },
				transferList
			);
			break;
		}

		case "REGISTER_STATIC_LIGHTING": {
			// Register a static mesh for lighting calculations (positions + normals)
			const vertexCount = msg.normals.length / 3;
			staticLightingCache.set(msg.meshId, {
				positions: msg.positions || null,  // transferred (needed for spotlights)
				normals: msg.normals,  // transferred
				vertexCount
			});
			break;
		}

		case "LIGHTING_BATCH": {
			// Process lighting for multiple static meshes
			const lightConfig = msg.lightConfig;
			const requestedMeshIds = msg.meshIds;

			// Calculate total vertices
			let totalVertices = 0;
			const meshEntries = [];
			for (const meshId of requestedMeshIds) {
				const entry = staticLightingCache.get(meshId);
				if (!entry) continue;
				totalVertices += entry.vertexCount;
				meshEntries.push({ meshId, entry });
			}

			if (meshEntries.length === 0) {
				self.postMessage({ type: "LIGHTING_RESULTS", meshIds: new Uint32Array(0), offsets: new Uint32Array(1), colors: new Float32Array(0) }, []);
				break;
			}

			// Allocate packed color buffer (4 floats per vertex)
			const packedColors = new Float32Array(totalVertices * 4);
			const offsets = new Uint32Array(meshEntries.length + 1);
			const meshIds = new Uint32Array(meshEntries.length);

			let colorOffset = 0;
			for (let i = 0; i < meshEntries.length; i++) {
				const { meshId, entry } = meshEntries[i];

				// Calculate lighting using existing function
				// Normals are baked with node world transform at load time, modelMatrix applies runtime transform
				calculateLighting(
					entry.positions, entry.normals, packedColors,
					0, 0, colorOffset, entry.vertexCount,
					lightConfig.modelMatrix, lightConfig
				);

				meshIds[i] = meshId;
				offsets[i] = colorOffset;
				colorOffset += entry.vertexCount * 4;
			}
			offsets[meshEntries.length] = colorOffset;

			self.postMessage(
				{ type: "LIGHTING_RESULTS", meshIds, offsets, colors: packedColors },
				[packedColors.buffer, meshIds.buffer, offsets.buffer]
			);
			break;
		}

		case "UNREGISTER": {
			meshCache.delete(msg.meshId);
			skinnedMeshCache.delete(msg.meshId);
			staticLightingCache.delete(msg.meshId);
			break;
		}

		case "CLEAR": {
			meshCache.clear();
			skinnedMeshCache.clear();
			staticLightingCache.clear();
			break;
		}
	}
};
`;

type TransformCallback = (positions: Float32Array) => void;
type SkinningCallback = (positions: Float32Array, normals: Float32Array | null, colors: Float32Array | null) => void;
type StaticLightingCallback = (colors: Float32Array) => void;

/** Light configuration for worker-based lighting calculation */
export interface WorkerLightConfig {
	ambient: Float32Array | number[];
	lights: Array<{
		enabled: boolean;
		color: Float32Array | number[];
		intensity: number;
		direction: Float32Array | number[];
		specularEnabled: boolean;
	}>;
	spotLights?: Array<{
		enabled: boolean;
		color: Float32Array | number[];
		intensity: number;
		position: Float32Array | number[];
		direction: Float32Array | number[];
		innerConeAngle: number;
		outerConeAngle: number;
		falloffExponent: number;
		range: number;
		specularEnabled: boolean;
	}>;
	/** Hemisphere light (blends sky/ground colors based on normal.y) */
	hemisphere?: {
		enabled: boolean;
		skyColor: Float32Array | number[];
		groundColor: Float32Array | number[];
		intensity: number;
	};
	/** Specular configuration */
	specular?: {
		shininess: number;
		intensity: number;
		debugBlue?: boolean;
	};
	/** Camera world position for specular calculations */
	cameraPosition?: Float32Array | number[];
	/** Full 4x4 model matrix for position/normal transform (column-major) */
	modelMatrix?: Float32Array | null;
	/** @deprecated Use modelMatrix instead */
	modelRotation?: Float32Array | null;
}

interface MeshRegistration {
	workerIndex: number;
	callback: TransformCallback;
}

interface SkinnedMeshRegistration {
	workerIndex: number;
	callback: SkinningCallback;
	hasNormals: boolean;
}

interface StaticLightingRegistration {
	workerIndex: number;
	callback: StaticLightingCallback;
}

interface PendingRequest {
	meshId: number;
	matrix: Float32Array;
}

interface PendingSkinRequest {
	meshIds: number[];
	boneMatrices: Float32Array;
	lightConfig?: WorkerLightConfig;
}

interface PendingLightingRequest {
	meshIds: number[];
	lightConfig: WorkerLightConfig;
}

interface PendingResult {
	meshIds: Uint32Array;
	offsets: Uint32Array;
	positions: Float32Array | null;
	normals: Float32Array | null;
	colors: Float32Array | null;
	isSkinning: boolean;
	isLighting: boolean;
}

export class TransformWorkerPool {
	private _workers: Worker[] = [];
	private _workerBlobUrl: string | null = null;
	private _meshRegistry = new Map<number, MeshRegistration>();
	private _skinnedMeshRegistry = new Map<number, SkinnedMeshRegistration>();
	private _staticLightingRegistry = new Map<number, StaticLightingRegistration>();
	private _pendingByWorker: Map<number, PendingRequest[]> = new Map();
	private _pendingSkinByWorker: Map<number, PendingSkinRequest[]> = new Map();
	private _pendingLightingByWorker: Map<number, PendingLightingRequest[]> = new Map();
	private _flushResolvers: Array<() => void> = [];
	private _pendingResponses = 0;
	private _pendingResults: PendingResult[] = []; // Collect results for batched callback invocation
	private _nextWorkerIndex = 0;
	private _workerCount: number;
	private _disposed = false;

	constructor(workerCount?: number) {
		// Default: use available cores minus 1 for main thread, minimum 1, maximum 8
		const defaultCount = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
		this._workerCount = Math.min(workerCount ?? defaultCount, 8);
		this._initWorkers();
	}

	private _initWorkers(): void {
		// Create blob URL for worker code
		const blob = new Blob([WORKER_CODE], { type: "application/javascript" });
		this._workerBlobUrl = URL.createObjectURL(blob);

		for (let i = 0; i < this._workerCount; i++) {
			const worker = new Worker(this._workerBlobUrl);
			worker.onmessage = (e) => this._handleMessage(e.data);
			worker.onerror = (e) => console.error("[TransformWorkerPool] Worker error:", e);
			this._workers.push(worker);
			this._pendingByWorker.set(i, []);
			this._pendingSkinByWorker.set(i, []);
			this._pendingLightingByWorker.set(i, []);
		}
	}

	/**
	 * Register a mesh with the pool. Positions are transferred to worker (zero-copy).
	 * @param meshId Unique mesh identifier
	 * @param positions Original vertex positions (will be transferred, becomes unusable)
	 * @param callback Called with transformed positions after flush()
	 */
	registerMesh(meshId: number, positions: Float32Array, callback: TransformCallback): void {
		if (this._disposed) return;

		// Round-robin worker assignment
		const workerIndex = this._nextWorkerIndex;
		this._nextWorkerIndex = (this._nextWorkerIndex + 1) % this._workerCount;

		this._meshRegistry.set(meshId, { workerIndex, callback });

		// Transfer positions to worker (original becomes detached)
		this._workers[workerIndex].postMessage(
			{ type: "REGISTER", meshId, positions },
			[positions.buffer]
		);
	}

	/**
	 * Queue a transform request. Call flush() to execute batched requests.
	 */
	queueTransform(meshId: number, matrix: Float32Array): void {
		if (this._disposed) return;

		const registration = this._meshRegistry.get(meshId);
		if (!registration) {
			console.warn(`[TransformWorkerPool] Mesh ${meshId} not registered`);
			return;
		}

		this._pendingByWorker.get(registration.workerIndex)!.push({
			meshId,
			matrix: new Float32Array(matrix) // Copy matrix (small, avoids issues if caller reuses)
		});
	}

	/**
	 * Register a skinned mesh with the pool for CPU skinning.
	 * Positions, normals, joints, and weights are transferred to worker (zero-copy).
	 * @param meshId Unique mesh identifier
	 * @param positions Original bind pose positions (will be transferred)
	 * @param normals Original bind pose normals (will be transferred, optional)
	 * @param joints Per-vertex joint indices, 4 per vertex (will be transferred)
	 * @param weights Per-vertex weights, 4 per vertex (will be transferred)
	 * @param callback Called with skinned positions and normals after flush()
	 */
	registerSkinnedMesh(
		meshId: number,
		positions: Float32Array,
		normals: Float32Array | null,
		joints: Uint8Array | Uint16Array,
		weights: Float32Array,
		callback: SkinningCallback
	): void {
		if (this._disposed) return;

		// Round-robin worker assignment
		const workerIndex = this._nextWorkerIndex;
		this._nextWorkerIndex = (this._nextWorkerIndex + 1) % this._workerCount;

		this._skinnedMeshRegistry.set(meshId, { workerIndex, callback, hasNormals: normals !== null });

		// Transfer all data to worker
		const transferList: ArrayBuffer[] = [positions.buffer];
		if (normals && normals.buffer.byteLength > 0 && !transferList.includes(normals.buffer)) {
			transferList.push(normals.buffer);
		}
		if (joints.buffer.byteLength > 0 && !transferList.includes(joints.buffer)) {
			transferList.push(joints.buffer);
		}
		if (weights.buffer.byteLength > 0 && !transferList.includes(weights.buffer)) {
			transferList.push(weights.buffer);
		}

		this._workers[workerIndex].postMessage(
			{ type: "REGISTER_SKIN", meshId, positions, normals, joints, weights },
			transferList
		);
	}

	/**
	 * Register a static mesh for worker-based lighting calculations.
	 * Positions and normals are transferred to worker (zero-copy).
	 * @param meshId Unique mesh identifier
	 * @param positions Vertex positions in model space (will be transferred, needed for spotlights)
	 * @param normals Vertex normals in model space (will be transferred)
	 * @param callback Called with computed vertex colors after flush()
	 */
	registerStaticMeshForLighting(
		meshId: number,
		positions: Float32Array | null,
		normals: Float32Array,
		callback: StaticLightingCallback
	): void {
		if (this._disposed) return;

		// Round-robin worker assignment
		const workerIndex = this._nextWorkerIndex;
		this._nextWorkerIndex = (this._nextWorkerIndex + 1) % this._workerCount;

		this._staticLightingRegistry.set(meshId, { workerIndex, callback });

		// Transfer positions and normals to worker
		const transferList: ArrayBuffer[] = [normals.buffer];
		if (positions && positions.buffer.byteLength > 0 && !transferList.includes(positions.buffer)) {
			transferList.push(positions.buffer);
		}

		this._workers[workerIndex].postMessage(
			{ type: "REGISTER_STATIC_LIGHTING", meshId, positions, normals },
			transferList
		);
	}

	/**
	 * Queue skinning for multiple meshes sharing the same bone matrices.
	 * This is efficient when multiple meshes use the same skeleton (body, clothes, etc).
	 * @param meshIds Array of mesh IDs to skin
	 * @param boneMatrices Bone matrices (16 floats per joint, flattened)
	 * @param lightConfig Optional lighting configuration to compute vertex colors in worker
	 */
	queueSkinning(meshIds: number[], boneMatrices: Float32Array, lightConfig?: WorkerLightConfig): void {
		if (this._disposed) return;
		if (meshIds.length === 0) return;

		// Group meshes by worker
		const byWorker = new Map<number, number[]>();
		for (const meshId of meshIds) {
			const registration = this._skinnedMeshRegistry.get(meshId);
			if (!registration) {
				console.warn(`[TransformWorkerPool] Skinned mesh ${meshId} not registered`);
				continue;
			}
			const workerMeshes = byWorker.get(registration.workerIndex);
			if (workerMeshes) {
				workerMeshes.push(meshId);
			} else {
				byWorker.set(registration.workerIndex, [meshId]);
			}
		}

		// Queue skinning request per worker (copy bone matrices for each - small footprint)
		for (const [workerIndex, workerMeshIds] of byWorker) {
			this._pendingSkinByWorker.get(workerIndex)!.push({
				meshIds: workerMeshIds,
				boneMatrices: new Float32Array(boneMatrices), // Copy to avoid caller reuse issues
				lightConfig
			});
		}
	}

	/**
	 * Queue lighting calculation for multiple static meshes.
	 * @param meshIds Array of mesh IDs to calculate lighting for
	 * @param lightConfig Lighting configuration (ambient, lights, modelRotation)
	 */
	queueStaticLighting(meshIds: number[], lightConfig: WorkerLightConfig): void {
		if (this._disposed) return;
		if (meshIds.length === 0) return;

		// Group meshes by worker
		const byWorker = new Map<number, number[]>();
		for (const meshId of meshIds) {
			const registration = this._staticLightingRegistry.get(meshId);
			if (!registration) {
				continue;
			}
			const workerMeshes = byWorker.get(registration.workerIndex);
			if (workerMeshes) {
				workerMeshes.push(meshId);
			} else {
				byWorker.set(registration.workerIndex, [meshId]);
			}
		}

		// Queue lighting request per worker
		for (const [workerIndex, workerMeshIds] of byWorker) {
			this._pendingLightingByWorker.get(workerIndex)!.push({
				meshIds: workerMeshIds,
				lightConfig
			});
		}
	}

	/**
	 * Send all queued transforms and skinning requests to workers and wait for completion.
	 * Invokes registered callbacks with results.
	 */
	async flush(): Promise<void> {
		if (this._disposed) return;

		// Count workers with pending work (transform or skinning)
		let workersWithWork = 0;
		for (let i = 0; i < this._workerCount; i++) {
			const pendingTransforms = this._pendingByWorker.get(i)!;
			const pendingSkin = this._pendingSkinByWorker.get(i)!;

			if (pendingTransforms.length > 0) {
				workersWithWork++;
				this._workers[i].postMessage({
					type: "TRANSFORM_BATCH",
					requests: pendingTransforms
				});
				this._pendingByWorker.set(i, []); // Clear pending
			}

			// Send skinning requests (one message per request to allow different bone matrices)
			for (const skinReq of pendingSkin) {
				workersWithWork++;
				this._workers[i].postMessage({
					type: "SKIN_BATCH",
					meshIds: skinReq.meshIds,
					boneMatrices: skinReq.boneMatrices,
					lightConfig: skinReq.lightConfig
				});
			}
			this._pendingSkinByWorker.set(i, []); // Clear pending

			// Send static lighting requests
			const pendingLighting = this._pendingLightingByWorker.get(i)!;
			for (const lightReq of pendingLighting) {
				workersWithWork++;
				this._workers[i].postMessage({
					type: "LIGHTING_BATCH",
					meshIds: lightReq.meshIds,
					lightConfig: lightReq.lightConfig
				});
			}
			this._pendingLightingByWorker.set(i, []); // Clear pending
		}

		// Nothing to flush
		if (workersWithWork === 0) return;

		// Wait for all workers to respond
		this._pendingResponses = workersWithWork;
		return new Promise((resolve) => {
			this._flushResolvers.push(resolve);
		});
	}

	private _handleMessage(msg: {
		type: string;
		meshIds?: Uint32Array;
		offsets?: Uint32Array;
		positions?: Float32Array;
		normals?: Float32Array | null;
		colors?: Float32Array | null;
	}): void {
		const isTransformResult = msg.type === "TRANSFORM_RESULTS";
		const isSkinResult = msg.type === "SKIN_RESULTS";
		const isLightingResult = msg.type === "LIGHTING_RESULTS";

		if ((isTransformResult || isSkinResult) && msg.positions && msg.meshIds && msg.offsets) {
			// Collect result for batched processing
			this._pendingResults.push({
				meshIds: msg.meshIds,
				offsets: msg.offsets,
				positions: msg.positions,
				normals: msg.normals ?? null,
				colors: msg.colors ?? null,
				isSkinning: isSkinResult,
				isLighting: false
			});

			this._checkFlushComplete();
		} else if (isLightingResult && msg.colors && msg.meshIds && msg.offsets) {
			// Collect lighting result
			this._pendingResults.push({
				meshIds: msg.meshIds,
				offsets: msg.offsets,
				positions: null,
				normals: null,
				colors: msg.colors,
				isSkinning: false,
				isLighting: true
			});

			this._checkFlushComplete();
		}
	}

	private _checkFlushComplete(): void {
		this._pendingResponses--;
		if (this._pendingResponses === 0) {
			// All workers responded - invoke all callbacks together (batched RX)
			this._invokeAllCallbacks();

			// Resolve all waiting flush promises
			const resolvers = this._flushResolvers;
			this._flushResolvers = [];
			for (const resolve of resolvers) {
				resolve();
			}
		}
	}

	/**
	 * Invoke all callbacks from collected results in a single batch.
	 * This ensures all GPU uploads happen together.
	 */
	private _invokeAllCallbacks(): void {
		for (const result of this._pendingResults) {
			const { meshIds, offsets, positions, normals, colors, isSkinning, isLighting } = result;

			if (isLighting) {
				// Lighting results: offsets are in color floats (4 per vertex)
				for (let i = 0; i < meshIds.length; i++) {
					const meshId = meshIds[i];
					const start = offsets[i];
					const end = offsets[i + 1];

					const registration = this._staticLightingRegistry.get(meshId);
					if (registration && colors) {
						registration.callback(colors.subarray(start, end));
					}
				}
			} else if (isSkinning) {
				// Skinning results: offsets are in position floats (3 per vertex)
				let colorOffset = 0;
				for (let i = 0; i < meshIds.length; i++) {
					const meshId = meshIds[i];
					const start = offsets[i];
					const end = offsets[i + 1];
					const vertexCount = (end - start) / 3;

					const registration = this._skinnedMeshRegistry.get(meshId);
					if (registration && positions) {
						const meshPositions = positions.subarray(start, end);
						const meshNormals = (normals && registration.hasNormals) ? normals.subarray(start, end) : null;
						const meshColors = colors ? colors.subarray(colorOffset, colorOffset + vertexCount * 4) : null;
						registration.callback(meshPositions, meshNormals, meshColors);
					}
					colorOffset += vertexCount * 4;
				}
			} else {
				// Transform results
				for (let i = 0; i < meshIds.length; i++) {
					const meshId = meshIds[i];
					const start = offsets[i];
					const end = offsets[i + 1];

					const registration = this._meshRegistry.get(meshId);
					if (registration && positions) {
						registration.callback(positions.subarray(start, end));
					}
				}
			}
		}

		// Clear collected results
		this._pendingResults = [];
	}

	/**
	 * Remove a mesh from the pool (both regular and skinned).
	 */
	unregisterMesh(meshId: number): void {
		const registration = this._meshRegistry.get(meshId) || this._skinnedMeshRegistry.get(meshId);
		if (registration && !this._disposed) {
			this._workers[registration.workerIndex].postMessage({
				type: "UNREGISTER",
				meshId
			});
		}
		this._meshRegistry.delete(meshId);
		this._skinnedMeshRegistry.delete(meshId);
		this._staticLightingRegistry.delete(meshId);
	}

	/**
	 * Get number of registered meshes (regular transforms).
	 */
	get meshCount(): number {
		return this._meshRegistry.size;
	}

	/**
	 * Get number of registered skinned meshes.
	 */
	get skinnedMeshCount(): number {
		return this._skinnedMeshRegistry.size;
	}

	/**
	 * Get number of workers in pool.
	 */
	get workerCount(): number {
		return this._workerCount;
	}

	/**
	 * Clean up all workers and resources.
	 */
	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;

		for (const worker of this._workers) {
			worker.terminate();
		}
		this._workers = [];

		if (this._workerBlobUrl) {
			URL.revokeObjectURL(this._workerBlobUrl);
			this._workerBlobUrl = null;
		}

		this._meshRegistry.clear();
		this._skinnedMeshRegistry.clear();
		this._staticLightingRegistry.clear();
		this._pendingByWorker.clear();
		this._pendingSkinByWorker.clear();
		this._pendingLightingByWorker.clear();
		this._pendingResults = [];

		// Resolve any pending flushes
		for (const resolve of this._flushResolvers) {
			resolve();
		}
		this._flushResolvers = [];
	}
}

/**
 * Shared global worker pool with reference counting and per-frame batching.
 * Creates a single pool of ~8 workers shared across all models.
 * Batches transform requests per frame via _tick2() flush.
 */
class SharedWorkerPool {
	private static _instance: TransformWorkerPool | null = null;
	private static _refCount = 0;
	private static _flushScheduled = false;

	/**
	 * Acquire reference to the shared pool. Creates pool on first call.
	 */
	static acquire(): TransformWorkerPool {
		if (!SharedWorkerPool._instance) {
			SharedWorkerPool._instance = new TransformWorkerPool();
		}
		SharedWorkerPool._refCount++;
		return SharedWorkerPool._instance;
	}

	/**
	 * Release reference to the shared pool. Disposes pool when last reference released.
	 */
	static release(): void {
		if (SharedWorkerPool._refCount <= 0) return;

		SharedWorkerPool._refCount--;

		if (SharedWorkerPool._refCount === 0 && SharedWorkerPool._instance) {
			SharedWorkerPool._flushScheduled = false;
			SharedWorkerPool._instance.dispose();
			SharedWorkerPool._instance = null;
		}
	}

	/**
	 * Mark that a flush is needed. Called when transforms are queued.
	 * Actual flush happens in flushIfPending() called from _tick2().
	 */
	static scheduleFlush(): void {
		if (!SharedWorkerPool._instance) return;
		SharedWorkerPool._flushScheduled = true;
	}

	/**
	 * Flush pending transforms if any were scheduled.
	 * Called once per frame from _tick2() after all _tick() calls have queued transforms.
	 */
	static flushIfPending(): void {
		if (!SharedWorkerPool._instance || !SharedWorkerPool._flushScheduled) return;
		SharedWorkerPool._flushScheduled = false;
		SharedWorkerPool._instance.flush();
	}

	/**
	 * Get current reference count (for debugging).
	 */
	static get refCount(): number {
		return SharedWorkerPool._refCount;
	}

	/**
	 * Check if shared pool exists.
	 */
	static get hasInstance(): boolean {
		return SharedWorkerPool._instance !== null;
	}
}

export { SharedWorkerPool };
