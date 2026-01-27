// Import types only (not runtime values) for TypeScript checking
import type { GltfModel as GltfModelType } from "./gltf/GltfModel.js";
import type { SharedWorkerPool as SharedWorkerPoolType } from "./gltf/TransformWorkerPool.js";
import type { mat4 as mat4Type, vec3 as vec3Type } from "gl-matrix";

// Augment globalThis with GltfBundle type
declare global {
	var GltfBundle: {
		GltfModel: typeof GltfModelType;
		SharedWorkerPool: typeof SharedWorkerPoolType;
		mat4: typeof mat4Type;
		vec3: typeof vec3Type;
	};
}

// Access bundle from globalThis (C3 worker compatible - no ES module import)
const { GltfModel, SharedWorkerPool, mat4, vec3 } = globalThis.GltfBundle;

// Debug logging - set to false to disable
const DEBUG = true;
const LOG_PREFIX = "[GltfStatic]";

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

// Property indices (link properties are excluded from _getInitProperties)
// Only data properties are included: model-url, rotation-x, rotation-y, rotation-z, scale
const PROP_MODEL_URL = 0;
const PROP_ROTATION_X = 1;
const PROP_ROTATION_Y = 2;
const PROP_ROTATION_Z = 3;
const PROP_SCALE = 4;

// Reusable matrix/vectors for transform calculations (avoid per-frame allocations)
const tempMatrix = mat4.create();
const tempVec = vec3.create();

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

	// Transform tracking for dirty checks
	_lastX: number = NaN;
	_lastY: number = NaN;
	_lastWidth: number = NaN;
	_lastAngle: number = NaN;
	_lastZElevation: number = NaN;
	_lastRotationX: number = NaN;
	_lastRotationY: number = NaN;
	_lastRotationZ: number = NaN;
	_lastScaleX: number = NaN;
	_lastScaleY: number = NaN;
	_lastScaleZ: number = NaN;

	// Debug stats
	_drawCount: number = 0;
	_lastDrawTime: number = 0;
	_tickCount: number = 0;
	_transformUpdateCount: number = 0;

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
				debugLog("Auto-loading model from URL:", this._modelUrl);
				this._loadModel(this._modelUrl);
			}
		}
	}

	_release(): void
	{
		debugLog("_release called, total draws:", this._drawCount);

		// Stop ticking
		this._setTicking(false);
		this._setTicking2(false);

		// Clean up glTF model resources
		if (this._model)
		{
			this._model.release(this.runtime.renderer);
			this._model = null;
			debugLog("Model resources released");
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
	 * Check if instance transform has changed since last update.
	 */
	_isTransformDirty(): boolean
	{
		return (
			this._lastX !== this.x ||
			this._lastY !== this.y ||
			this._lastWidth !== this.width ||
			this._lastAngle !== this.angle ||
			this._lastZElevation !== this.zElevation ||
			this._lastRotationX !== this._rotationX ||
			this._lastRotationY !== this._rotationY ||
			this._lastRotationZ !== this._rotationZ ||
			this._lastScaleX !== this._scaleX ||
			this._lastScaleY !== this._scaleY ||
			this._lastScaleZ !== this._scaleZ
		);
	}

	/**
	 * Build transform matrix from instance properties.
	 * Order: Scale -> 3D Rotation (X, Y, Z) -> 2D Rotation (angle) -> Translation
	 * This ensures the model is scaled first, then rotated, then positioned.
	 */
	_buildTransformMatrix(): Float32Array
	{
		// Start with identity
		mat4.identity(tempMatrix);

		// 1. Translate to instance position
		vec3.set(tempVec, this.x, this.y, this.totalZElevation);
		mat4.translate(tempMatrix, tempMatrix, tempVec);

		// 2. Apply 2D angle rotation (around Z axis) - C3's instance angle
		if (this.angle !== 0)
		{
			mat4.rotateZ(tempMatrix, tempMatrix, this.angle);
		}

		// 3. Apply 3D rotations (Euler angles in degrees, converted to radians)
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

		// 4. Scale based on instance size and per-axis scale factors
		// Instance width provides base scale, then per-axis multipliers are applied
		const baseScale = this.width;
		vec3.set(tempVec, baseScale * this._scaleX, baseScale * this._scaleY, baseScale * this._scaleZ);
		mat4.scale(tempMatrix, tempMatrix, tempVec);

		// Update last transform values for dirty checking
		this._lastX = this.x;
		this._lastY = this.y;
		this._lastWidth = this.width;
		this._lastAngle = this.angle;
		this._lastZElevation = this.zElevation;
		this._lastRotationX = this._rotationX;
		this._lastRotationY = this._rotationY;
		this._lastRotationZ = this._rotationZ;
		this._lastScaleX = this._scaleX;
		this._lastScaleY = this._scaleY;
		this._lastScaleZ = this._scaleZ;

		return tempMatrix as Float32Array;
	}

	/**
	 * Called once per frame when ticking is enabled.
	 * Handles transform updates separately from rendering.
	 */
	_tick(): void
	{
		this._tickCount++;
		if (!this._model?.isLoaded) return;

		// Only update if transform changed
		if (this._isTransformDirty())
		{
			this._transformUpdateCount++;
			const matrix = this._buildTransformMatrix();
			this._model.updateTransform(matrix);

			// Log every 60 ticks to monitor transform activity
			if (this._transformUpdateCount % 60 === 1)
			{
				debugLog(`Transform update #${this._transformUpdateCount} at tick #${this._tickCount}`);
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
			// Just render - transform updates happen in _tick()
			// Pass tickCount so cull mode is only set once per frame
			this._model.draw(renderer, this.runtime.tickCount);

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

	_getTotalVertices(): number
	{
		return this._model?.getStats().totalVertices ?? 0;
	}

	_getMeshCount(): number
	{
		return this._model?.getStats().meshCount ?? 0;
	}

	async _loadModel(url: string): Promise<void>
	{
		// Prevent concurrent loads
		if (this._isLoading)
		{
			debugWarn("Load already in progress, ignoring request for:", url);
			return;
		}

		debugLog("Starting model load:", url);
		const loadStart = performance.now();

		this._modelUrl = url;
		this._isLoading = true;

		// Release existing model
		if (this._model)
		{
			debugLog("Releasing previous model");
			this._model.release(this.runtime.renderer);
			this._model = null;
		}

		// Reset transform tracking to force update on first draw
		this._lastX = NaN;

		try
		{
			this._model = new GltfModel();
			await this._model.load(this.runtime.renderer, url);

			const loadTime = performance.now() - loadStart;
			const stats = this._model.getStats();

			debugLog(`Model loaded successfully in ${loadTime.toFixed(0)}ms:`, {
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
