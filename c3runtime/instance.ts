// Import types only (not runtime values) for TypeScript checking
import type { GltfModel as GltfModelType } from "./gltf/GltfModel.js";
import type { GltfMesh as GltfMeshType } from "./gltf/GltfMesh.js";
import type { SharedWorkerPool as SharedWorkerPoolType } from "./gltf/TransformWorkerPool.js";
import type { AnimationController as AnimationControllerType } from "./gltf/AnimationController.js";
import type { mat4 as mat4Type, vec3 as vec3Type, quat as quatType } from "gl-matrix";

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
	};
}

// Access bundle from globalThis (C3 worker compatible - no ES module import)
const { GltfModel, GltfMesh, SharedWorkerPool, AnimationController, mat4, vec3 } = globalThis.GltfBundle;

// Debug logging - set to false to disable
const DEBUG = false;
const LOG_PREFIX = "[GltfStatic]";

// Model loading debug - set to true to enable verbose model loading logs
const modelLoadDebug = false;

function debugLog(...args: unknown[]): void {
	if (DEBUG) console.log(LOG_PREFIX, ...args);
}

function debugWarn(...args: unknown[]): void {
	if (DEBUG) console.warn(LOG_PREFIX, ...args);
}

function debugError(...args: unknown[]): void {
	// Always log errors, but add prefix only in debug mode
	console.error(LOG_PREFIX, ...args);
}

function modelLoadLog(...args: unknown[]): void {
	if (modelLoadDebug) console.log(LOG_PREFIX, ...args);
}

function modelLoadWarn(...args: unknown[]): void {
	if (modelLoadDebug) console.warn(LOG_PREFIX, ...args);
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

// Degrees to radians conversion factor
const DEG_TO_RAD = Math.PI / 180;

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

	constructor()
	{
		super();
		debugLog("Instance created");

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

		// 2. R: apply rotations (around origin, which is now the model center)
		if (this.angle !== 0)
		{
			mat4.rotateZ(tempMatrix, tempMatrix, this.angle);
		}
		if (this._rotationX !== 0)
		{
			mat4.rotateX(tempMatrix, tempMatrix, this._rotationX * DEG_TO_RAD);
		}
		if (this._rotationY !== 0)
		{
			mat4.rotateY(tempMatrix, tempMatrix, this._rotationY * DEG_TO_RAD);
		}
		if (this._rotationZ !== 0)
		{
			mat4.rotateZ(tempMatrix, tempMatrix, this._rotationZ * DEG_TO_RAD);
		}

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
	 */
	_tick(): void
	{
		if (!this._model?.isLoaded) return;

		// Update animation if playing (use C3 SDK's delta time)
		if (this._animationController?.isPlaying())
		{
			this._animationController.update(this.runtime.dt);

			// Push skinned positions to GPU
			this._updateSkinnedMeshes();
		}

		this.runtime.sdk.updateRender();
	}

	/**
	 * Push skinned positions from animation controller to mesh GPU buffers.
	 * Uses worker-based skinning when available, falls back to main thread.
	 */
	_updateSkinnedMeshes(): void
	{
		if (!this._animationController || !this._model) return;

		// Use worker skinning if available (offloads CPU skinning to workers)
		if (this._model.hasWorkerSkinning)
		{
			// Queue bone matrices to workers - skinning happens in parallel
			// Results are applied via callbacks during SharedWorkerPool.flushIfPending() in _tick2()
			this._model.queueSkinning(this._animationController.getBoneMatrices());
			return;
		}

		// Fallback: main thread skinning
		const meshes = this._model.meshes;
		if (!meshes) return;

		// Use _skinnedMeshIndices to map animation controller index to actual mesh index
		for (let i = 0; i < this._animationController.getMeshCount(); i++)
		{
			const meshIndex = this._skinnedMeshIndices[i];
			const positions = this._animationController.getSkinnedPositions(i);
			if (meshes[meshIndex])
			{
				meshes[meshIndex].updateSkinnedPositions(positions);
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
	}

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
		const animMeshes: { originalPositions: Float32Array; skinningData: any }[] = [];
		this._skinnedMeshIndices = [];
		for (let i = 0; i < meshes.length; i++)
		{
			const mesh = meshes[i];
			if (mesh.isSkinned && mesh.originalPositions && mesh.skinningData)
			{
				this._skinnedMeshIndices.push(i);
				animMeshes.push({
					originalPositions: mesh.originalPositions,
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

			// Enable worker skinning if available (skip redundant main thread skinning)
			if (this._model.hasWorkerSkinning)
			{
				this._animationController.useWorkerSkinning = true;
				modelLoadLog("Worker skinning enabled for animation controller");
			}

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
