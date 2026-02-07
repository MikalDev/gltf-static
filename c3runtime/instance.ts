// Import types only (not runtime values) for TypeScript checking
import type { GltfModel as GltfModelType } from "./gltf/GltfModel.js";
import type { GltfMesh as GltfMeshType } from "./gltf/GltfMesh.js";
import type { SharedWorkerPool as SharedWorkerPoolType } from "./gltf/TransformWorkerPool.js";
import type { AnimationController as AnimationControllerType } from "./gltf/AnimationController.js";
import type { mat4 as mat4Type, vec3 as vec3Type, quat as quatType } from "gl-matrix";
import type * as LightingType from "./gltf/Lighting.js";

// Augment globalThis with GltfBundle type
declare global {
	var GltfBundle: {
		GltfModel: typeof GltfModelType;
		GltfMesh: typeof GltfMeshType;
		SharedWorkerPool: typeof SharedWorkerPoolType;
		AnimationController: typeof AnimationControllerType;
		mat4: typeof mat4Type;
		vec3: typeof vec3Type;
		quat: typeof quatType;
		Lighting: typeof LightingType;
	};
	// Global debug flag for all glTF modules
	var gltfDebug: boolean;
}

// Initialize global debug flag (off by default)
globalThis.gltfDebug = false;

// Access bundle from globalThis (C3 worker compatible - no ES module import)
const { GltfModel, GltfMesh, SharedWorkerPool, AnimationController, mat4, vec3, quat, Lighting } = globalThis.GltfBundle;

const LOG_PREFIX = "[GltfStatic]";

function debugLog(...args: unknown[]): void {
	if (globalThis.gltfDebug) console.log(LOG_PREFIX, ...args);
}

function debugWarn(...args: unknown[]): void {
	if (globalThis.gltfDebug) console.warn(LOG_PREFIX, ...args);
}

function debugError(...args: unknown[]): void {
	// Always log errors
	console.error(LOG_PREFIX, ...args);
}

function modelLoadLog(...args: unknown[]): void {
	if (globalThis.gltfDebug) console.log(LOG_PREFIX, ...args);
}

function modelLoadWarn(...args: unknown[]): void {
	if (globalThis.gltfDebug) console.warn(LOG_PREFIX, ...args);
}

// Property indices (link properties are excluded from _getInitProperties)
// Only data properties are included: model-url, rotation-x, rotation-y, rotation-z, scale
const PROP_MODEL_URL = 0;
const PROP_ROTATION_X = 1;
const PROP_ROTATION_Y = 2;
const PROP_ROTATION_Z = 3;
const PROP_SCALE = 4;

// Reusable matrix/vector for transform calculations (avoid per-frame allocations)
const tempMatrix = mat4.create();
const tempVec = vec3.create();
const savedMV = new Float32Array(16);
const modelRotationMatrix = mat4.create(); // For lighting normal transformation

// Degrees to radians conversion factor
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

C3.Plugins.GltfStatic.Instance = class GltfStaticInstance extends ISDKWorldInstanceBase
{
	// Model state
	_modelUrl: string = "";
	_rotationX: number = 0;
	_rotationY: number = 0;
	_rotationZ: number = 0;
	_scaleX: number = 1;
	_scaleY: number = 1;
	_scaleZ: number = 1;
	_debug: boolean = false;

	// Quaternion rotation (x, y, z, w) - used internally, initialized from euler
	// This represents the 3D rotation (replaces rotationX/Y/Z when set directly)
	_rotationQuat: Float32Array = new Float32Array([0, 0, 0, 1]); // Identity quaternion

	// glTF model
	_model: GltfModelType | null = null;
	_isLoading: boolean = false;

	// Animation controller (created when model has skinning data)
	_animationController: AnimationControllerType | null = null;
	_skinnedMeshIndices: number[] = [];  // Maps animation controller mesh index to model mesh index

	_realRuntime: unknown

	// Debug stats
	_drawCount: number = 0;
	_lastDrawTime: number = 0;

	// Animation frame skip (performance optimization)
	_animationFrameSkip: number = 0;      // How many frames to skip (0 = update every frame)
	_frameCounter: number = 0;            // Current frame counter
	_accumulatedDt: number = 0;           // Accumulated delta time
	_frameOffset: number = 0;             // Stagger offset to spread instances across frames
	_frameSkipIncludesLighting: boolean = true;  // When true, lighting is also skipped on skipped frames

	// Distance-based LOD for animation frame skip
	_distanceLodEnabled: boolean = false;  // When true, frame skip is calculated from camera distance
	_lodFullRateRadius: number = 500;      // No skip within this radius (always full update rate)
	_lodMaxSkipDistance: number = 2000;    // Maximum frame skip at this distance and beyond
	_lodMaxFrameSkip: number = 5;          // Maximum frame skip when at/beyond max distance

	// Static counter for generating stagger offsets
	static _instanceCounter: number = 0;

	constructor()
	{
		super();
		debugLog("Instance created");

		// Assign stagger offset from static counter (wraps automatically when used with modulo)
		this._frameOffset = GltfStaticInstance._instanceCounter++;

		// SDK v2: Initialize from properties in constructor
		const props = this._getInitProperties();
		if (props)
		{
			this._modelUrl = props[PROP_MODEL_URL] as string;
			this._rotationX = props[PROP_ROTATION_X] as number;
			this._rotationY = props[PROP_ROTATION_Y] as number;
			this._rotationZ = props[PROP_ROTATION_Z] as number;
			// Uniform scale property sets all axes
			const uniformScale = props[PROP_SCALE] as number;
			this._scaleX = uniformScale;
			this._scaleY = uniformScale;
			this._scaleZ = uniformScale;

			debugLog("Properties loaded:", {
				modelUrl: this._modelUrl,
				rotationX: this._rotationX,
				rotationY: this._rotationY,
				rotationZ: this._rotationZ,
				scale: { x: this._scaleX, y: this._scaleY, z: this._scaleZ }
			});

			// Initialize quaternion from euler angles
			this._updateQuatFromEuler();

			// Auto-load model if URL is set
			if (this._modelUrl)
			{
				modelLoadLog("Auto-loading model from URL:", this._modelUrl);
				this._loadModel(this._modelUrl);
			}
		}
		this._realRuntime = (globalThis as any).badlandsR;
	}

	_release(): void
	{
		debugLog("_release called, total draws:", this._drawCount);

		// Stop ticking
		this._setTicking(false);
		this._setTicking2(false);

		// Clean up animation controller
		this._animationController = null;

		// Clean up glTF model resources
		if (this._model)
		{
			this._model.release(this.runtime.renderer);
			this._model = null;
			modelLoadLog("Model resources released");
		}
	}

	/**
	 * Whether this instance renders to its own Z plane.
	 * Returns false to use standard layer Z ordering.
	 */
	_rendersToOwnZPlane(): boolean
	{
		return false;
	}

	/**
	 * Whether this instance must be pre-drawn before other instances.
	 * Returns false for standard draw order.
	 */
	_mustPreDraw(): boolean
	{
		return false;
	}

	/**
	 * Build model-view matrix: C3_MV * T(position) * R * S * T(-localCenter)
	 * All TRS is handled on the GPU. Vertices are never modified after initial upload.
	 * T(-localCenter) shifts model so its center is at origin,
	 * then S scales, R rotates (both around origin), then T moves to world position.
	 */
	_buildModelViewMatrix(savedMatrix: Float32Array): Float32Array
	{
		mat4.identity(tempMatrix);

		// 1. T(position): translate to instance world position
		vec3.set(tempVec, this.x, this.y, this.totalZElevation);
		mat4.translate(tempMatrix, tempMatrix, tempVec);

		// 2. R: apply C3 angle (Z rotation) first, then quaternion rotation
		if (this.angle !== 0)
		{
			mat4.rotateZ(tempMatrix, tempMatrix, this.angle);
		}

		// Apply quaternion rotation (replaces individual X/Y/Z euler rotations)
		const rotMat = mat4.create();
		mat4.fromQuat(rotMat, this._rotationQuat);
		mat4.multiply(tempMatrix, tempMatrix, rotMat);

		// 3. S: scale
		vec3.set(tempVec, this._scaleX, this._scaleY, this._scaleZ);
		mat4.scale(tempMatrix, tempMatrix, tempVec);

		// 4. T(-localCenter): shift model so its center is at origin
		const lc = this._model!.localCenter;
		vec3.set(tempVec, -lc[0], -lc[1], -lc[2]);
		mat4.translate(tempMatrix, tempMatrix, tempVec);

		// Combine with C3's model-view (camera transform)
		return mat4.multiply(tempMatrix, savedMatrix, tempMatrix) as Float32Array;
	}

	/**
	 * Called once per frame when ticking is enabled.
	 * Updates animation and ensures C3 redraws when model is loaded.
	 * Supports frame skipping for performance - animation updates every (frameSkip + 1) frames
	 * while maintaining correct animation speed via accumulated delta time.
	 * When _frameSkipIncludesLighting is true (default), lighting is also skipped on skipped frames,
	 * rendering from existing GPU buffers for maximum performance.
	 */
	_tick(): void
	{
		if (!this._model?.isLoaded) return;

		// Always accumulate delta time for animation
		const dt = this.runtime.dt;
		this._accumulatedDt += dt;
		this._frameCounter++;

		// Determine effective frame skip: use distance-based LOD if enabled, else manual setting
		const effectiveFrameSkip = this._distanceLodEnabled
			? this._calculateDistanceFrameSkip()
			: this._animationFrameSkip;

		// Check if this frame should do a full update (animation + lighting)
		// Stagger offset spreads instances across frames so they don't all update simultaneously
		const updateInterval = effectiveFrameSkip + 1;
		const shouldUpdate = ((this._frameCounter + this._frameOffset) % updateInterval) === 0;

		// Update animation if playing
		if (this._animationController?.isPlaying())
		{
			if (shouldUpdate)
			{
				// Use accumulated delta time to maintain correct animation speed
				this._animationController.update(this._accumulatedDt);

				// Sync node hierarchy with animated joint transforms
				this._model.updateJointNodes(this._animationController);

				// Update static meshes under animated joints (uses node world matrices)
				this._model.updateStaticMeshTransforms();

				this._updateSkinnedMeshes();

				// Reset accumulated delta time after update
				this._accumulatedDt = 0;
			}
		}
		else
		{
			// Not playing - reset accumulated time to avoid buildup
			this._accumulatedDt = 0;
		}

		// Apply lighting only on update frames (when frameSkipIncludesLighting is true)
		// On skipped frames, just render from existing GPU buffers for maximum performance
		if (shouldUpdate || !this._frameSkipIncludesLighting)
		{
			this._applyLightingToAllMeshes();
		}

		this.runtime.sdk.updateRender();
	}

	/**
	 * Build full model matrix for lighting calculations.
	 * Includes world position, rotation, scale, and local center offset.
	 * This transforms vertices from model-space to world-space.
	 */
	_buildModelRotationMatrix(): Float32Array
	{
		mat4.identity(modelRotationMatrix);

		// 1. T(position): translate to instance world position
		vec3.set(tempVec, this.x, this.y, this.totalZElevation);
		mat4.translate(modelRotationMatrix, modelRotationMatrix, tempVec);

		// 2. R: apply C3 angle first, then quaternion rotation (same as _buildModelViewMatrix)
		if (this.angle !== 0)
		{
			mat4.rotateZ(modelRotationMatrix, modelRotationMatrix, this.angle);
		}

		// Apply quaternion rotation
		const rotMat = mat4.create();
		mat4.fromQuat(rotMat, this._rotationQuat);
		mat4.multiply(modelRotationMatrix, modelRotationMatrix, rotMat);

		// 3. S: scale (lighting calculation will renormalize normals)
		vec3.set(tempVec, this._scaleX, this._scaleY, this._scaleZ);
		mat4.scale(modelRotationMatrix, modelRotationMatrix, tempVec);

		// 4. T(-localCenter): shift model so its center is at origin
		if (this._model)
		{
			const lc = this._model.localCenter;
			vec3.set(tempVec, -lc[0], -lc[1], -lc[2]);
			mat4.translate(modelRotationMatrix, modelRotationMatrix, tempVec);
		}

		return modelRotationMatrix as Float32Array;
	}

	/**
	 * Apply lighting to all meshes. Uses dirty tracking internally.
	 * Uses worker-based lighting for static meshes when available.
	 * Skinned meshes get lighting via worker in _updateSkinnedMeshes - never use fallback.
	 */
	_applyLightingToAllMeshes(): void
	{
		if (!this._model) return;
		const meshes = this._model.meshes;
		if (!meshes) return;

		// Use worker-based lighting for static meshes if available
		if (this._model.hasWorkerStaticLighting)
		{
			const lightConfig = this._buildLightConfig();
			if (lightConfig)
			{
				this._model.queueStaticLighting(lightConfig);
			}
			// Skinned meshes get lighting via queueSkinning in _updateSkinnedMeshes
			return;
		}

		// Fallback: main thread lighting for static meshes only
		// Skinned meshes always use worker lighting via _updateSkinnedMeshes
		const rotMatrix = this._buildModelRotationMatrix();
		const cameraPosition = this._getCameraPosition();
		for (const mesh of meshes)
		{
			if (mesh.hasNormals && !mesh.isSkinned)
			{
				mesh.applyLighting(rotMatrix, false, cameraPosition);
			}
		}
	}

	/**
	 * Build lighting configuration for worker-based lighting calculation.
	 * Creates copies of all arrays to avoid race conditions with shared buffers.
	 */
	_buildLightConfig(): {
		ambient: Float32Array;
		lights: Array<{ enabled: boolean; color: Float32Array; intensity: number; direction: Float32Array; specularEnabled: boolean }>;
		spotLights: Array<{ enabled: boolean; color: Float32Array; intensity: number; position: Float32Array; direction: Float32Array; innerConeAngle: number; outerConeAngle: number; falloffExponent: number; range: number; specularEnabled: boolean }>;
		hemisphere?: { enabled: boolean; skyColor: Float32Array; groundColor: Float32Array; intensity: number };
		specular?: { shininess: number; intensity: number; debugBlue?: boolean };
		cameraPosition?: Float32Array;
		modelMatrix: Float32Array;
	} | undefined
	{
		const lights = Lighting.getAllLights();
		const spotLights = Lighting.getAllSpotLights();
		const hemi = Lighting.getHemisphereLight();
		const specularConfig = Lighting.getSpecularConfig();
		if (lights.length === 0 && spotLights.length === 0 && !hemi.enabled) return undefined;

		// Copy all arrays to avoid race conditions - these are sent to workers
		// after flush(), but the source buffers could change between now and then
		const config: {
			ambient: Float32Array;
			lights: Array<{ enabled: boolean; color: Float32Array; intensity: number; direction: Float32Array; specularEnabled: boolean }>;
			spotLights: Array<{ enabled: boolean; color: Float32Array; intensity: number; position: Float32Array; direction: Float32Array; innerConeAngle: number; outerConeAngle: number; falloffExponent: number; range: number; specularEnabled: boolean }>;
			hemisphere?: { enabled: boolean; skyColor: Float32Array; groundColor: Float32Array; intensity: number };
			specular?: { shininess: number; intensity: number; debugBlue?: boolean };
			cameraPosition?: Float32Array;
			modelMatrix: Float32Array;
		} = {
			ambient: new Float32Array(Lighting.getAmbientLight()),
			lights: lights.map(l => ({
				enabled: l.enabled,
				color: new Float32Array(l.color),
				intensity: l.intensity,
				direction: new Float32Array(l.direction),
				specularEnabled: l.specularEnabled
			})),
			spotLights: spotLights.map(l => ({
				enabled: l.enabled,
				color: new Float32Array(l.color),
				intensity: l.intensity,
				position: new Float32Array(l.position),
				direction: new Float32Array(l.direction),
				innerConeAngle: l.innerConeAngle,
				outerConeAngle: l.outerConeAngle,
				falloffExponent: l.falloffExponent,
				range: l.range,
				specularEnabled: l.specularEnabled
			})),
			modelMatrix: new Float32Array(this._buildModelRotationMatrix())
		};

		// Add hemisphere light if enabled
		if (hemi.enabled) {
			config.hemisphere = {
				enabled: true,
				skyColor: new Float32Array(hemi.skyColor),
				groundColor: new Float32Array(hemi.groundColor),
				intensity: hemi.intensity
			};
		}

		// Add specular config and camera position if specular intensity > 0
		if (specularConfig.intensity > 0 || specularConfig.debugBlue) {
			config.specular = {
				shininess: specularConfig.shininess,
				intensity: specularConfig.intensity,
				debugBlue: specularConfig.debugBlue
			};
			config.cameraPosition = this._getCameraPosition();

			// Store camera for debug function
			Lighting.setDebugCamera(config.cameraPosition);
		}

		return config;
	}

	/**
	 * Get camera world position from C3's 3D Camera object.
	 */
	_getCameraPosition(): Float32Array {
		try {
			// Get 3D Camera from C3 runtime objects (single global plugin, no instances)
			const camera = (this.runtime as any).objects?.["3DCamera"];

			if (camera) {
				const camPos = new Float32Array(camera.getCameraPosition());
				Lighting.setDebugCamera(camPos);
				return camPos;
			}

			// Fallback: use layout scroll position
			console.log("[Specular] No 3DCamera found, using fallback");
			const layout = this.runtime.layout;
			const camPos = new Float32Array([
				layout.scrollX,
				layout.scrollY,
				500  // Default Z
			]);
			Lighting.setDebugCamera(camPos);
			return camPos;
		} catch (e) {
			console.error("[Specular] Error getting camera position:", e);
			return new Float32Array([0, 0, 500]);
		}
	}

	/**
	 * Push skinned positions from animation controller to mesh GPU buffers.
	 * Uses worker-based skinning when available, falls back to main thread.
	 */
	_updateSkinnedMeshes(): void
	{
		if (!this._animationController || !this._model) return;

		// Use worker skinning if available (handles both positions and normals)
		if (this._model.hasWorkerSkinning)
		{
			const lightConfig = this._buildLightConfig();
			this._model.queueSkinning(this._animationController.getBoneMatrices(), lightConfig);
			return;
		}

		// Main thread skinning
		const meshes = this._model.meshes;
		if (!meshes) return;

		for (let i = 0; i < this._animationController.getMeshCount(); i++)
		{
			const meshIndex = this._skinnedMeshIndices[i];
			const mesh = meshes[meshIndex];
			if (!mesh) continue;

			// Update positions
			mesh.updateSkinnedPositions(this._animationController.getSkinnedPositions(i));

			// Update normals (invalidates lighting cache)
			const normals = this._animationController.getSkinnedNormals(i);
			if (normals)
			{
				mesh.updateSkinnedNormals(normals);
				mesh.invalidateLighting(); // Force recalc since normals changed
			}
		}
	}

	/**
	 * Called after all _tick() calls. Flushes pending worker transforms.
	 */
	_tick2(): void
	{
		SharedWorkerPool.flushIfPending();
	}

	_draw(renderer: IRenderer): void
	{
		const drawStart = performance.now();
		this._drawCount++;

		// Log first draw and every 60 frames (roughly every second at 60fps)
		const shouldLog = this._drawCount === 1 || this._drawCount % 60 === 0;

		// Draw the glTF model if loaded
		if (this._model?.isLoaded)
		{
			const glRenderer = (globalThis as any).badlandsR.GetWebGLRenderer();
			savedMV.set(glRenderer._matMV);

			// Build model-view with translation + rotation (vertices are origin-centered)
			const combined = this._buildModelViewMatrix(savedMV);
			glRenderer.SetModelViewMatrix(combined);

			this._model.draw(renderer, this.runtime.tickCount);

			// Restore previous matrix
			glRenderer.SetModelViewMatrix(savedMV);

			const drawTime = performance.now() - drawStart;
			this._lastDrawTime = drawTime;
		}
		else
		{
			if (shouldLog)
			{
				debugLog(`Draw #${this._drawCount}: Model not loaded, drawing placeholder`, {
					isLoading: this._isLoading,
					hasModel: !!this._model
				});
			}

			// Fallback: draw placeholder texture while model is loading
			const imageInfo = this.objectType.getImageInfo();
			const texture = imageInfo.getTexture(renderer);

			if (texture)
			{
				const quad = this.getBoundingQuad();

				// Apply pixel rounding if enabled
				if (this.runtime.isPixelRoundingEnabled)
				{
					const ox = Math.round(this.x) - this.x;
					const oy = Math.round(this.y) - this.y;
					quad.p1.x += ox;
					quad.p1.y += oy;
					quad.p2.x += ox;
					quad.p2.y += oy;
					quad.p3.x += ox;
					quad.p3.y += oy;
					quad.p4.x += ox;
					quad.p4.y += oy;
				}

				renderer.setTexture(texture);
				renderer.quad3(quad, imageInfo.getTexRect());
			}
		}
	}

	// Getters for model state
	_getRotationX(): number
	{
		return this._rotationX;
	}

	_getRotationY(): number
	{
		return this._rotationY;
	}

	_getRotationZ(): number
	{
		return this._rotationZ;
	}

	_setRotation(x: number, y: number, z: number): void
	{
		this._rotationX = x;
		this._rotationY = y;
		this._rotationZ = z;
		// Keep quaternion in sync
		this._updateQuatFromEuler();
	}

	// ========================================================================
	// Quaternion Rotation Methods
	// ========================================================================

	/**
	 * Update internal quaternion from current euler angles (rotationX/Y/Z).
	 * Called when euler angles change to keep quaternion in sync.
	 */
	_updateQuatFromEuler(): void
	{
		// Build quaternion from euler angles in the same order as _buildModelViewMatrix
		// Order: Z (rotationZ) * Y (rotationY) * X (rotationX)
		// Note: C3's angle property is handled separately in the matrix builder
		const rx = this._rotationX * DEG_TO_RAD;
		const ry = this._rotationY * DEG_TO_RAD;
		const rz = this._rotationZ * DEG_TO_RAD;

		// Create quaternion from euler angles (XYZ order)
		quat.fromEuler(this._rotationQuat, this._rotationX, this._rotationY, this._rotationZ);
	}

	/**
	 * Set rotation using a quaternion (x, y, z, w).
	 * This directly sets the 3D rotation, bypassing euler angles.
	 * @param x Quaternion X component
	 * @param y Quaternion Y component
	 * @param z Quaternion Z component
	 * @param w Quaternion W component
	 */
	_setRotationQuaternion(x: number, y: number, z: number, w: number): void
	{
		this._rotationQuat[0] = x;
		this._rotationQuat[1] = y;
		this._rotationQuat[2] = z;
		this._rotationQuat[3] = w;

		// Normalize to ensure valid rotation
		quat.normalize(this._rotationQuat, this._rotationQuat);

		// Update euler angles to stay in sync (approximate, may have gimbal lock issues)
		this._updateEulerFromQuat();
	}

	/**
	 * Set rotation from a JSON string: {"x":0,"y":0,"z":0,"w":1}
	 */
	_setRotationQuaternionJson(json: string): void
	{
		try
		{
			const obj = JSON.parse(json);
			if (typeof obj.x === "number" && typeof obj.y === "number" &&
				typeof obj.z === "number" && typeof obj.w === "number")
			{
				this._setRotationQuaternion(obj.x, obj.y, obj.z, obj.w);
			}
		}
		catch (e)
		{
			debugWarn("Invalid quaternion JSON:", json);
		}
	}

	/**
	 * Get rotation quaternion as [x, y, z, w].
	 */
	_getRotationQuaternion(): [number, number, number, number]
	{
		return [
			this._rotationQuat[0],
			this._rotationQuat[1],
			this._rotationQuat[2],
			this._rotationQuat[3]
		];
	}

	/**
	 * Get rotation quaternion as JSON string.
	 */
	_getRotationQuaternionJson(): string
	{
		return JSON.stringify({
			x: this._rotationQuat[0],
			y: this._rotationQuat[1],
			z: this._rotationQuat[2],
			w: this._rotationQuat[3]
		});
	}

	/**
	 * Update euler angles from current quaternion.
	 * Called when quaternion is set directly to keep euler in sync.
	 * Note: Euler extraction can have gimbal lock issues.
	 */
	_updateEulerFromQuat(): void
	{
		// Extract euler angles from quaternion
		// gl-matrix doesn't have a direct quat-to-euler, so we convert via matrix
		const m = mat4.create();
		mat4.fromQuat(m, this._rotationQuat);

		// Extract euler angles (same formula as _extractBoneRotation)
		let rotX: number, rotY: number, rotZ: number;

		if (Math.abs(m[8]) < 0.99999)
		{
			rotY = Math.asin(-m[8]);
			rotX = Math.atan2(m[9], m[10]);
			rotZ = Math.atan2(m[4], m[0]);
		}
		else
		{
			rotY = m[8] < 0 ? Math.PI / 2 : -Math.PI / 2;
			rotX = Math.atan2(-m[6], m[5]);
			rotZ = 0;
		}

		this._rotationX = rotX * RAD_TO_DEG;
		this._rotationY = rotY * RAD_TO_DEG;
		this._rotationZ = rotZ * RAD_TO_DEG;
	}

	/**
	 * Get individual quaternion components for expressions.
	 */
	_getQuatX(): number { return this._rotationQuat[0]; }
	_getQuatY(): number { return this._rotationQuat[1]; }
	_getQuatZ(): number { return this._rotationQuat[2]; }
	_getQuatW(): number { return this._rotationQuat[3]; }

	// Scale getters - GPU data stays static, only transform matrix changes
	_getScaleX(): number
	{
		return this._scaleX;
	}

	_getScaleY(): number
	{
		return this._scaleY;
	}

	_getScaleZ(): number
	{
		return this._scaleZ;
	}

	// Set uniform scale (all axes)
	_setScale(scale: number): void
	{
		this._scaleX = scale;
		this._scaleY = scale;
		this._scaleZ = scale;
	}

	// Set non-uniform scale (per axis)
	_setScaleXYZ(x: number, y: number, z: number): void
	{
		this._scaleX = x;
		this._scaleY = y;
		this._scaleZ = z;
	}

	_isModelLoaded(): boolean
	{
		return this._model?.isLoaded ?? false;
	}

	// Worker control methods
	_setWorkerEnabled(enabled: boolean): void
	{
		if (this._model)
		{
			this._model.setWorkersEnabled(enabled);
		}
	}

	_isUsingWorkers(): boolean
	{
		return this._model?.useWorkers ?? false;
	}

	_getWorkerEnabled(): number
	{
		return this._isUsingWorkers() ? 1 : 0;
	}

	_getWorkerCount(): number
	{
		return this._model?.getWorkerCount() ?? 0;
	}

	_isUsingWorkerSkinning(): boolean
	{
		return this._model?.hasWorkerSkinning ?? false;
	}

	_getWorkerSkinningEnabled(): number
	{
		return this._isUsingWorkerSkinning() ? 1 : 0;
	}

	_getTotalVertices(): number
	{
		return this._model?.getStats().totalVertices ?? 0;
	}

	_getMeshCount(): number
	{
		return this._model?.getStats().meshCount ?? 0;
	}

	// ========================================================================
	// Mesh Visibility Methods
	// ========================================================================

	_setMeshVisible(name: string, visible: boolean): void
	{
		this._model?.setMeshVisibleByName(name, visible);
	}

	_showAllMeshes(): void
	{
		this._model?.showAllMeshes();
	}

	_hideAllMeshes(): void
	{
		this._model?.hideAllMeshes();
	}

	_isMeshVisible(name: string): boolean
	{
		return this._model?.getMeshVisibleByName(name) ?? false;
	}

	_setMeshVisibleByIndex(index: number, visible: boolean): void
	{
		this._model?.setMeshVisibleByIndex(index, visible);
	}

	_isMeshVisibleByIndex(index: number): boolean
	{
		return this._model?.getMeshVisibleByIndex(index) ?? false;
	}

	_getMeshNames(): string
	{
		const names = this._model?.getMeshNames() ?? [];
		return JSON.stringify(names);
	}

	_getMeshNameAt(index: number): string
	{
		const meshes = this._model?.meshes;
		if (!meshes || index < 0 || index >= meshes.length) return "";
		return meshes[index].name;
	}

	// ========================================================================
	// Animation Control Methods
	// ========================================================================

	/**
	 * Create animation controller after model loads (if model has skinning data).
	 */
	_createAnimationController(): void
	{
		if (!this._model || this._animationController) return;

		// Check if model has skinning data
		if (!this._model.hasSkinning || this._model.animations.length === 0)
		{
			modelLoadLog("Model has no skinning data or animations, skipping animation controller");
			return;
		}

		const skins = this._model.skins;
		if (skins.length === 0) return;

		const meshes = this._model.meshes;
		if (!meshes || meshes.length === 0) return;

		// Build mesh data for animation controller and track skinned mesh indices
		const animMeshes: { originalPositions: Float32Array; originalNormals?: Float32Array | null; skinningData: any }[] = [];
		this._skinnedMeshIndices = [];
		for (let i = 0; i < meshes.length; i++)
		{
			const mesh = meshes[i];
			if (mesh.isSkinned && mesh.originalPositions && mesh.skinningData)
			{
				this._skinnedMeshIndices.push(i);
				animMeshes.push({
					originalPositions: mesh.originalPositions,
					originalNormals: mesh.originalNormals,
					skinningData: mesh.skinningData
				});
			}
		}

		if (animMeshes.length === 0)
		{
			modelLoadLog("No skinned meshes found, skipping animation controller");
			return;
		}

		try
		{
			this._animationController = new AnimationController({
				skinData: skins[0], // Use first skin
				animations: [...this._model.animations],
				meshes: animMeshes
			});

			// Force enable worker skinning - workers handle skinning, AnimationController skips main thread skinning
			this._animationController.useWorkerSkinning = true;
			console.log("[GltfStatic] Worker skinning FORCED enabled for animation controller");

			// Set up onComplete callback to trigger condition
			this._animationController.onComplete = () =>
			{
				this._trigger(C3.Plugins.GltfStatic.Cnds.OnAnimationFinished);
			};

			modelLoadLog(`Animation controller created with ${this._model.animations.length} animations, ${animMeshes.length} skinned meshes`);
		}
		catch (err)
		{
			debugError("Failed to create animation controller:", err);
			this._animationController = null;
		}
	}

	_playAnimation(name: string): void
	{
		if (!this._animationController)
		{
			debugWarn("No animation controller - model may not have animations");
			return;
		}
		this._animationController.play(name);
	}

	_playAnimationByIndex(index: number): void
	{
		if (!this._animationController)
		{
			debugWarn("No animation controller - model may not have animations");
			return;
		}
		this._animationController.playByIndex(index);
	}

	_stopAnimation(): void
	{
		this._animationController?.stop();
	}

	_pauseAnimation(): void
	{
		this._animationController?.pause();
	}

	_resumeAnimation(): void
	{
		this._animationController?.resume();
	}

	_setAnimationTime(time: number): void
	{
		this._animationController?.setTime(time);
	}

	_setAnimationSpeed(speed: number): void
	{
		if (this._animationController)
		{
			this._animationController.playbackRate = speed;
		}
	}

	_setAnimationLoop(loop: boolean): void
	{
		if (this._animationController)
		{
			this._animationController.loop = loop;
		}
	}

	_isAnimationPlaying(): boolean
	{
		return this._animationController?.isPlaying() ?? false;
	}

	_isAnimationPaused(): boolean
	{
		return this._animationController?.isPaused() ?? false;
	}

	_getAnimationTime(): number
	{
		return this._animationController?.getTime() ?? 0;
	}

	_getAnimationDuration(): number
	{
		return this._animationController?.getDuration() ?? 0;
	}

	_getAnimationName(): string
	{
		return this._animationController?.getCurrentAnimation() ?? "";
	}

	_getAnimationCount(): number
	{
		return this._animationController?.getAnimationCount() ?? this._model?.animations.length ?? 0;
	}

	_getAnimationNameAt(index: number): string
	{
		if (this._animationController)
		{
			return this._animationController.getAnimationNameAt(index);
		}
		// Fallback to model data if no controller yet
		const anims = this._model?.animations;
		if (anims && index >= 0 && index < anims.length)
		{
			return anims[index].name;
		}
		return "";
	}

	_getAnimationSpeed(): number
	{
		return this._animationController?.playbackRate ?? 1;
	}

	_getAnimationProgress(): number
	{
		return this._animationController?.getNormalizedTime() ?? 0;
	}

	_hasAnimation(name: string): boolean
	{
		if (this._animationController)
		{
			return this._animationController.hasAnimation(name);
		}
		// Fallback to model data
		const anims = this._model?.animations;
		if (anims)
		{
			return anims.some(a => a.name === name);
		}
		return false;
	}

	_getAnimationNamesJson(): string
	{
		const names = this._animationController?.getAnimationNames() ??
			this._model?.animations.map(a => a.name) ?? [];
		return JSON.stringify(names);
	}

	// ========================================================================
	// Animation Frame Skip Methods (Performance Optimization)
	// ========================================================================

	/**
	 * Set the number of frames to skip between animation updates.
	 * 0 = update every frame, 1 = update every 2nd frame, etc.
	 * Animation speed is maintained by accumulating delta time.
	 * @param skip Number of frames to skip (0 or greater)
	 */
	_setAnimationFrameSkip(skip: number): void
	{
		this._animationFrameSkip = Math.max(0, Math.floor(skip));
		// Reset counters when changing frame skip to avoid stale state
		this._frameCounter = 0;
		this._accumulatedDt = 0;
	}

	// ========================================================================
	// Distance-Based LOD Methods
	// ========================================================================

	/**
	 * Calculate frame skip based on distance to camera.
	 * Uses linear interpolation between near (skip=0) and far (skip=max).
	 */
	_calculateDistanceFrameSkip(): number
	{
		const camPos = this._getCameraPosition();
		const dx = this.x - camPos[0];
		const dy = this.y - camPos[1];
		const dz = this.totalZElevation - camPos[2];
		const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

		if (distance <= this._lodFullRateRadius) return 0;
		if (distance >= this._lodMaxSkipDistance) return this._lodMaxFrameSkip;

		// Linear interpolation
		const t = (distance - this._lodFullRateRadius) / (this._lodMaxSkipDistance - this._lodFullRateRadius);
		return Math.floor(t * this._lodMaxFrameSkip);
	}

	/**
	 * Enable or disable distance-based LOD for animation frame skip.
	 */
	_setDistanceLodEnabled(enabled: boolean): void
	{
		this._distanceLodEnabled = enabled;
	}

	/**
	 * Check if distance-based LOD is enabled.
	 */
	_getDistanceLodEnabled(): boolean
	{
		return this._distanceLodEnabled;
	}

	/**
	 * Configure distance LOD thresholds.
	 * @param fullRateRadius Radius within which full update rate is used (no skip)
	 * @param maxSkipDistance Distance at which maximum frame skip is used
	 * @param maxSkip Maximum frame skip value at max distance
	 */
	_setDistanceLodThresholds(fullRateRadius: number, maxSkipDistance: number, maxSkip: number): void
	{
		this._lodFullRateRadius = Math.max(0, fullRateRadius);
		this._lodMaxSkipDistance = Math.max(this._lodFullRateRadius + 1, maxSkipDistance);
		this._lodMaxFrameSkip = Math.max(0, Math.floor(maxSkip));
	}

	/**
	 * Get the current effective frame skip (accounting for distance LOD if enabled).
	 */
	_getEffectiveFrameSkip(): number
	{
		return this._distanceLodEnabled
			? this._calculateDistanceFrameSkip()
			: this._animationFrameSkip;
	}

	/**
	 * Get the current animation frame skip value.
	 * @returns Number of frames being skipped (0 = every frame)
	 */
	_getAnimationFrameSkip(): number
	{
		return this._animationFrameSkip;
	}

	/**
	 * Set whether lighting updates are also skipped on skipped frames.
	 * When enabled (default), skipped frames render from existing GPU buffers
	 * without recalculating lighting, providing maximum performance benefit.
	 * @param enabled Whether to include lighting in frame skip
	 */
	_setFrameSkipLighting(enabled: boolean): void
	{
		this._frameSkipIncludesLighting = enabled;
	}

	/**
	 * Get whether lighting updates are skipped on skipped frames.
	 * @returns true if lighting is included in frame skip (default)
	 */
	_getFrameSkipLighting(): boolean
	{
		return this._frameSkipIncludesLighting;
	}

	async _loadModel(url: string): Promise<void>
	{
		// Prevent concurrent loads
		if (this._isLoading)
		{
			modelLoadWarn("Load already in progress, ignoring request for:", url);
			return;
		}

		// Skip if same URL is already loaded
		if (this._model?.isLoaded && this._modelUrl === url)
		{
			modelLoadLog("Model already loaded, skipping:", url);
			return;
		}

		modelLoadLog("Starting model load:", url);
		const loadStart = performance.now();

		this._modelUrl = url;
		this._isLoading = true;

		// Release existing model
		if (this._model)
		{
			modelLoadLog("Releasing previous model");
			this._model.release(this.runtime.renderer);
			this._model = null;
		}

		try
		{
			this._model = new GltfModel();
			await this._model.load(this.runtime.renderer, url);

			const loadTime = performance.now() - loadStart;
			const stats = this._model.getStats();

			modelLoadLog(`Model loaded successfully in ${loadTime.toFixed(0)}ms:`, {
				url,
				...stats
			});

			// Start ticking to process transforms each frame
			if (!this._isTicking())
			{
				this._setTicking(true);
			}
			// Enable tick2 to flush worker transforms after all tick() calls
			if (!this._isTicking2())
			{
				this._setTicking2(true);
			}

			// Create animation controller if model has skinning/animation data
			this._createAnimationController();

			// Trigger "On Loaded" condition
			this._trigger(C3.Plugins.GltfStatic.Cnds.OnLoaded);
		}
		catch (err)
		{
			const loadTime = performance.now() - loadStart;
			debugError(`Failed to load model after ${loadTime.toFixed(0)}ms:`, url, err);
			this._model = null;

			// Trigger "On Load Error" condition
			this._trigger(C3.Plugins.GltfStatic.Cnds.OnLoadError);
		}
		finally
		{
			this._isLoading = false;
		}
	}

	// ========================================================================
	// Lighting Control Methods
	// ========================================================================

	/**
	 * Create a directional light (direction TO the light source).
	 * @returns Light ID
	 */
	_createDirectionalLight(dirX: number, dirY: number, dirZ: number): number
	{
		return Lighting.createDirectionalLight(dirX, dirY, dirZ);
	}

	/**
	 * Enable or disable a light.
	 */
	_setLightEnabled(id: number, enabled: boolean): void
	{
		Lighting.setLightEnabled(id, enabled);
	}

	/**
	 * Check if a light is enabled.
	 */
	_isLightEnabled(id: number): boolean
	{
		return Lighting.isLightEnabled(id);
	}

	/**
	 * Set light color (RGB 0-1).
	 */
	_setLightColor(id: number, r: number, g: number, b: number): void
	{
		Lighting.setLightColor(id, r, g, b);
	}

	/**
	 * Set light intensity.
	 */
	_setLightIntensity(id: number, intensity: number): void
	{
		Lighting.setLightIntensity(id, intensity);
	}

	/**
	 * Set light direction (TO the light, will be normalized).
	 */
	_setLightDirection(id: number, x: number, y: number, z: number): void
	{
		Lighting.setLightDirection(id, x, y, z);
	}

	/**
	 * Remove a light by ID.
	 */
	_removeLight(id: number): boolean
	{
		return Lighting.removeLight(id);
	}

	/**
	 * Remove all lights.
	 */
	_removeAllLights(): void
	{
		Lighting.removeAllLights();
	}

	/**
	 * Set ambient light color (RGB 0-1).
	 */
	_setAmbientLight(r: number, g: number, b: number): void
	{
		Lighting.setAmbientLight(r, g, b);
	}

	/**
	 * Get number of lights.
	 */
	_getLightCount(): number
	{
		return Lighting.getLightCount();
	}

	/**
	 * Check if any lights are enabled.
	 */
	_hasEnabledLights(): boolean
	{
		return Lighting.hasEnabledLights();
	}

	// ========================================================================
	// Spotlight Control Methods
	// ========================================================================

	/**
	 * Create a spotlight.
	 * @param posX Position X
	 * @param posY Position Y
	 * @param posZ Position Z
	 * @param dirX Direction X (cone axis)
	 * @param dirY Direction Y
	 * @param dirZ Direction Z
	 * @param innerAngle Inner cone angle in degrees
	 * @param outerAngle Outer cone angle in degrees
	 * @returns Light ID
	 */
	_createSpotLight(posX: number, posY: number, posZ: number, dirX: number, dirY: number, dirZ: number, innerAngle: number, outerAngle: number): number
	{
		return Lighting.createSpotLight(posX, posY, posZ, dirX, dirY, dirZ, innerAngle, outerAngle);
	}

	/**
	 * Set spotlight position.
	 */
	_setSpotLightPosition(id: number, x: number, y: number, z: number): void
	{
		Lighting.setSpotLightPosition(id, x, y, z);
	}

	/**
	 * Set spotlight direction (cone axis).
	 */
	_setSpotLightDirection(id: number, x: number, y: number, z: number): void
	{
		Lighting.setSpotLightDirection(id, x, y, z);
	}

	/**
	 * Set spotlight cone angles (in degrees).
	 */
	_setSpotLightConeAngles(id: number, innerAngle: number, outerAngle: number): void
	{
		Lighting.setSpotLightConeAngles(id, innerAngle, outerAngle);
	}

	/**
	 * Set spotlight edge falloff exponent.
	 */
	_setSpotLightFalloff(id: number, exponent: number): void
	{
		Lighting.setSpotLightFalloff(id, exponent);
	}

	/**
	 * Set spotlight range (0 = infinite).
	 */
	_setSpotLightRange(id: number, range: number): void
	{
		Lighting.setSpotLightRange(id, range);
	}

	/**
	 * Enable or disable a spotlight.
	 */
	_setSpotLightEnabled(id: number, enabled: boolean): void
	{
		Lighting.setSpotLightEnabled(id, enabled);
	}

	/**
	 * Set spotlight color (RGB 0-1).
	 */
	_setSpotLightColor(id: number, r: number, g: number, b: number): void
	{
		Lighting.setSpotLightColor(id, r, g, b);
	}

	/**
	 * Set spotlight intensity.
	 */
	_setSpotLightIntensity(id: number, intensity: number): void
	{
		Lighting.setSpotLightIntensity(id, intensity);
	}

	/**
	 * Remove a spotlight by ID.
	 */
	_removeSpotLight(id: number): boolean
	{
		return Lighting.removeSpotLight(id);
	}

	/**
	 * Remove all spotlights.
	 */
	_removeAllSpotLights(): void
	{
		Lighting.removeAllSpotLights();
	}

	/**
	 * Get number of spotlights.
	 */
	_getSpotLightCount(): number
	{
		return Lighting.getSpotLightCount();
	}

	/**
	 * Check if any spotlights are enabled.
	 */
	_hasEnabledSpotLights(): boolean
	{
		return Lighting.hasEnabledSpotLights();
	}

	// ========================================================================
	// Hemisphere Light Methods
	// ========================================================================

	/**
	 * Enable or disable hemisphere lighting.
	 */
	_setHemisphereLightEnabled(enabled: boolean): void
	{
		Lighting.setHemisphereLightEnabled(enabled);
	}

	/**
	 * Check if hemisphere lighting is enabled.
	 */
	_isHemisphereLightEnabled(): boolean
	{
		return Lighting.isHemisphereLightEnabled();
	}

	/**
	 * Set hemisphere light sky color (RGB 0-1).
	 */
	_setHemisphereLightSkyColor(r: number, g: number, b: number): void
	{
		Lighting.setHemisphereLightSkyColor(r, g, b);
	}

	/**
	 * Set hemisphere light ground color (RGB 0-1).
	 */
	_setHemisphereLightGroundColor(r: number, g: number, b: number): void
	{
		Lighting.setHemisphereLightGroundColor(r, g, b);
	}

	/**
	 * Set hemisphere light intensity.
	 */
	_setHemisphereLightIntensity(intensity: number): void
	{
		Lighting.setHemisphereLightIntensity(intensity);
	}

	/**
	 * Get hemisphere light intensity.
	 */
	_getHemisphereLightIntensity(): number
	{
		return Lighting.getHemisphereLight().intensity;
	}

	/**
	 * Get hemisphere light sky color as [r, g, b].
	 */
	_getHemisphereLightSkyColor(): [number, number, number]
	{
		const sky = Lighting.getHemisphereLight().skyColor;
		return [sky[0], sky[1], sky[2]];
	}

	/**
	 * Get hemisphere light ground color as [r, g, b].
	 */
	_getHemisphereLightGroundColor(): [number, number, number]
	{
		const ground = Lighting.getHemisphereLight().groundColor;
		return [ground[0], ground[1], ground[2]];
	}

	// ========================================================================
	// Bone Attachment Methods
	// ========================================================================

	/**
	 * Get world position of a bone/node by name.
	 * For skinned models: returns animated bone position
	 * For non-skinned models: returns static node position
	 * Includes instance TRS (position, rotation, scale).
	 *
	 * @param name Bone/node name
	 * @returns [x, y, z] world coordinates, or null if not found
	 */
	_getBonePosition(name: string): [number, number, number] | null
	{
		if (!this._model?.isLoaded) return null;

		// Try animated bone first (skinned model)
		if (this._animationController)
		{
			const jointIndex = this._animationController.getJointIndexByName(name);
			if (jointIndex >= 0)
			{
				const jointMatrix = this._animationController.getJointWorldMatrix(jointIndex);
				if (jointMatrix)
				{
					return this._transformBoneToWorld(jointMatrix);
				}
			}
		}

		// Fall back to static node transform (non-skinned)
		const nodeMatrix = this._model.getNodeWorldMatrix(name);
		if (nodeMatrix)
		{
			return this._transformBoneToWorld(nodeMatrix);
		}

		return null;
	}

	/**
	 * Transform a bone/node local matrix to world coordinates.
	 * Applies: objectTRS * boneMatrix * origin
	 */
	_transformBoneToWorld(boneMatrix: Float32Array): [number, number, number]
	{
		// Build object transform matrix (same as _buildModelViewMatrix but without camera MV)
		const objectMatrix = mat4.create();

		// 1. T(position)
		vec3.set(tempVec, this.x, this.y, this.totalZElevation);
		mat4.translate(objectMatrix, objectMatrix, tempVec);

		// 2. R: apply C3 angle first, then quaternion rotation
		if (this.angle !== 0)
		{
			mat4.rotateZ(objectMatrix, objectMatrix, this.angle);
		}

		// Apply quaternion rotation
		const rotMat = mat4.create();
		mat4.fromQuat(rotMat, this._rotationQuat);
		mat4.multiply(objectMatrix, objectMatrix, rotMat);

		// 3. S(scale)
		vec3.set(tempVec, this._scaleX, this._scaleY, this._scaleZ);
		mat4.scale(objectMatrix, objectMatrix, tempVec);

		// 4. T(-localCenter)
		const lc = this._model!.localCenter;
		vec3.set(tempVec, -lc[0], -lc[1], -lc[2]);
		mat4.translate(objectMatrix, objectMatrix, tempVec);

		// Combine: objectMatrix * boneMatrix
		const combined = mat4.create();
		mat4.multiply(combined, objectMatrix, boneMatrix);

		// Extract position (translation component)
		return [combined[12], combined[13], combined[14]];
	}

	/**
	 * Get world rotation of a bone/node by name.
	 * Returns euler angles in degrees.
	 * @param name Bone/node name
	 * @returns [rotX, rotY, rotZ] in degrees, or null if not found
	 */
	_getBoneRotation(name: string): [number, number, number] | null
	{
		if (!this._model?.isLoaded) return null;

		let boneMatrix: Float32Array | null = null;

		// Try animated bone first (skinned model)
		if (this._animationController)
		{
			const jointIndex = this._animationController.getJointIndexByName(name);
			if (jointIndex >= 0)
			{
				boneMatrix = this._animationController.getJointWorldMatrix(jointIndex);
			}
		}

		// Fall back to static node transform (non-skinned)
		if (!boneMatrix)
		{
			boneMatrix = this._model.getNodeWorldMatrix(name);
		}

		if (!boneMatrix) return null;

		return this._extractBoneRotation(boneMatrix);
	}

	/**
	 * Extract euler rotation from combined object+bone matrix.
	 * Applies object rotations, then extracts euler angles.
	 */
	_extractBoneRotation(boneMatrix: Float32Array): [number, number, number]
	{
		// Build object rotation matrix (position/scale don't affect rotation extraction)
		const objectMatrix = mat4.create();

		// Apply C3 angle first, then quaternion rotation
		if (this.angle !== 0)
		{
			mat4.rotateZ(objectMatrix, objectMatrix, this.angle);
		}

		// Apply quaternion rotation
		const rotMat = mat4.create();
		mat4.fromQuat(rotMat, this._rotationQuat);
		mat4.multiply(objectMatrix, objectMatrix, rotMat);

		// Combine: objectRotation * boneMatrix
		const combined = mat4.create();
		mat4.multiply(combined, objectMatrix, boneMatrix);

		// Extract euler angles from rotation matrix (XYZ order)
		// Using standard rotation matrix decomposition for column-major mat4
		const m = combined;
		let rotX: number, rotY: number, rotZ: number;

		// Check for gimbal lock (when |m[8]| ≈ 1, meaning Y rotation ≈ ±90°)
		if (Math.abs(m[8]) < 0.99999)
		{
			rotY = Math.asin(-m[8]);
			rotX = Math.atan2(m[9], m[10]);
			rotZ = Math.atan2(m[4], m[0]);
		}
		else
		{
			// Gimbal lock case
			rotY = m[8] < 0 ? Math.PI / 2 : -Math.PI / 2;
			rotX = Math.atan2(-m[6], m[5]);
			rotZ = 0;
		}

		// Convert to degrees
		return [
			rotX * RAD_TO_DEG,
			rotY * RAD_TO_DEG,
			rotZ * RAD_TO_DEG
		];
	}

	/**
	 * Get 2D angle (Z rotation) of bone for sprite alignment.
	 * This is the most common use case - rotating a 2D sprite to match bone.
	 * @param name Bone/node name
	 * @returns Z rotation in degrees, or 0 if not found
	 */
	_getBoneAngle(name: string): number
	{
		const rotation = this._getBoneRotation(name);
		return rotation ? rotation[2] : 0;
	}

	/**
	 * Get list of available bone/node names.
	 * Combines animated joints (skinned) and static nodes (non-skinned).
	 * @returns JSON array of names
	 */
	_getBoneNames(): string
	{
		const names = new Set<string>();

		// Debug: log available sources
		console.log("[BoneNames] animController:", !!this._animationController,
			"model:", !!this._model,
			"skins:", this._model?.skins?.length ?? 0,
			"nodeNames:", this._model?.getNodeNames()?.length ?? 0);

		// Source 1: Animated joint names from controller (skinned models with animation)
		if (this._animationController)
		{
			const jointNames = this._animationController.getJointNames();
			console.log("[BoneNames] Source 1 - Controller joints:", jointNames.length, JSON.stringify(jointNames));
			for (const name of jointNames)
			{
				names.add(name);
			}
		}
		// Source 2: Joint names directly from model skins (skinned models without controller)
		else if (this._model?.skins)
		{
			console.log("[BoneNames] Source 2 - Model skins:", this._model.skins.length);
			for (const skin of this._model.skins)
			{
				console.log("[BoneNames] Skin joints:", skin.joints.length, JSON.stringify(skin.joints.map(j => j.name)));
				for (const joint of skin.joints)
				{
					names.add(joint.name);
				}
			}
		}

		// Source 3: All node names (includes generated names for unnamed nodes)
		if (this._model)
		{
			const nodeNames = this._model.getNodeNames();
			console.log("[BoneNames] Source 3 - Node names:", nodeNames.length, JSON.stringify(nodeNames));
			for (const name of nodeNames)
			{
				names.add(name);
			}
		}

		const result = JSON.stringify(Array.from(names));
		console.log("[BoneNames] Result:", result);
		return result;
	}

	/**
	 * Get bone count (joints for skinned, nodes for non-skinned).
	 */
	_getBoneCount(): number
	{
		if (this._animationController)
		{
			return this._animationController.getJointCount();
		}
		if (this._model)
		{
			return this._model.getNodeNames().length;
		}
		return 0;
	}

	/**
	 * Check if a bone/node exists by name.
	 * @param name Bone/node name
	 * @returns true if found
	 */
	_hasBone(name: string): boolean
	{
		// Check animated joints first
		if (this._animationController?.hasJoint(name))
		{
			return true;
		}

		// Check static nodes
		if (this._model?.hasNode(name))
		{
			return true;
		}

		return false;
	}

	// ========================================================================
	// Debug Control
	// ========================================================================

	/**
	 * Enable or disable debug logging for all glTF modules.
	 */
	_setDebug(enabled: boolean): void
	{
		this._debug = enabled;
		globalThis.gltfDebug = enabled;
		if (enabled)
		{
			console.log("[GltfStatic] Debug logging enabled");
		}
	}

	/**
	 * Check if debug logging is enabled.
	 */
	_getDebug(): boolean
	{
		return this._debug;
	}

	// ========================================================================
	// Debugger Properties (C3 Debugger Panel)
	// ========================================================================

	/**
	 * Return properties to show in the C3 debugger panel.
	 * Updates in real-time when the debugger is open.
	 */
	_getDebuggerProperties(): object[]
	{
		const props: object[] = [];

		// Frame Skip section
		props.push({
			title: "Frame Skip",
			properties: [
				{
					name: "Distance LOD Enabled",
					value: this._distanceLodEnabled
				},
				{
					name: "Manual Frame Skip",
					value: this._animationFrameSkip
				},
				{
					name: "Effective Frame Skip",
					value: this._getEffectiveFrameSkip()
				},
				{
					name: "Full Rate Radius",
					value: this._lodFullRateRadius
				},
				{
					name: "Max Skip Distance",
					value: this._lodMaxSkipDistance
				},
				{
					name: "Max Frame Skip",
					value: this._lodMaxFrameSkip
				},
				{
					name: "Skip Lighting Too",
					value: this._frameSkipIncludesLighting
				}
			]
		});

		// Distance section (only if LOD enabled and model loaded)
		if (this._distanceLodEnabled && this._model?.isLoaded)
		{
			const camPos = this._getCameraPosition();
			const dx = this.x - camPos[0];
			const dy = this.y - camPos[1];
			const dz = this.totalZElevation - camPos[2];
			const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

			props.push({
				title: "Distance LOD Info",
				properties: [
					{
						name: "Distance to Camera",
						value: Math.round(distance)
					},
					{
						name: "Camera Position",
						value: `(${Math.round(camPos[0])}, ${Math.round(camPos[1])}, ${Math.round(camPos[2])})`
					},
					{
						name: "Update Rate",
						value: `1/${this._getEffectiveFrameSkip() + 1} frames`
					}
				]
			});
		}

		// Animation section (if animation controller exists)
		if (this._animationController)
		{
			props.push({
				title: "Animation",
				properties: [
					{
						name: "Current Animation",
						value: this._getAnimationName() || "(none)"
					},
					{
						name: "Playing",
						value: this._isAnimationPlaying()
					},
					{
						name: "Time",
						value: `${this._getAnimationTime().toFixed(2)}s / ${this._getAnimationDuration().toFixed(2)}s`
					},
					{
						name: "Speed",
						value: this._getAnimationSpeed()
					}
				]
			});
		}

		return props;
	}

	_saveToJson(): JSONValue
	{
		return {
			"modelUrl": this._modelUrl,
			"rotationX": this._rotationX,
			"rotationY": this._rotationY,
			"rotationZ": this._rotationZ,
			"scaleX": this._scaleX,
			"scaleY": this._scaleY,
			"scaleZ": this._scaleZ
		};
	}

	_loadFromJson(o: JSONValue): void
	{
		const data = o as JSONObject;
		this._modelUrl = data["modelUrl"] as string;
		this._rotationX = data["rotationX"] as number;
		this._rotationY = data["rotationY"] as number;
		this._rotationZ = data["rotationZ"] as number;
		// Support both old uniform scale and new per-axis scale
		if ("scaleX" in data)
		{
			this._scaleX = (data["scaleX"] as number) ?? 1;
			this._scaleY = (data["scaleY"] as number) ?? 1;
			this._scaleZ = (data["scaleZ"] as number) ?? 1;
		}
		else
		{
			// Legacy: uniform scale
			const uniformScale = (data["scale"] as number) ?? 1;
			this._scaleX = uniformScale;
			this._scaleY = uniformScale;
			this._scaleZ = uniformScale;
		}

		// Reload model after restoring state
		if (this._modelUrl)
		{
			this._loadModel(this._modelUrl);
		}
	}
};

export type SDKInstanceClass = InstanceType<typeof C3.Plugins.GltfStatic.Instance>;
