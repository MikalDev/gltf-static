import { GltfModel, mat4, vec3 } from "./gltf-bundle.js";
import type { mat4 as Mat4Type, vec3 as Vec3Type } from "gl-matrix";

// Property indices (matching order in plugin.ts)
const PROP_MODEL_URL = 2;
const PROP_ROTATION_X = 3;
const PROP_ROTATION_Y = 4;
const PROP_ROTATION_Z = 5;

// Reusable matrix/vectors for transform calculations (avoid per-frame allocations)
const tempMatrix: Mat4Type = mat4.create();
const tempVec: Vec3Type = vec3.create();

// Degrees to radians conversion factor
const DEG_TO_RAD = Math.PI / 180;

C3.Plugins.GltfStatic.Instance = class GltfStaticInstance extends ISDKWorldInstanceBase
{
	// Model state
	_modelUrl: string = "";
	_rotationX: number = 0;
	_rotationY: number = 0;
	_rotationZ: number = 0;

	// glTF model
	_model: GltfModel | null = null;
	_isLoading: boolean = false;

	// Transform tracking for dirty checks
	_lastX: number = NaN;
	_lastY: number = NaN;
	_lastWidth: number = NaN;
	_lastHeight: number = NaN;
	_lastAngle: number = NaN;
	_lastZElevation: number = NaN;
	_lastRotationX: number = NaN;
	_lastRotationY: number = NaN;
	_lastRotationZ: number = NaN;

	constructor()
	{
		super();
	}

	_onCreate(): void
	{
		// Initialize from properties array
		const props = this._getInitProperties();
		if (props)
		{
			this._modelUrl = props[PROP_MODEL_URL] as string;
			this._rotationX = props[PROP_ROTATION_X] as number;
			this._rotationY = props[PROP_ROTATION_Y] as number;
			this._rotationZ = props[PROP_ROTATION_Z] as number;

			// Auto-load model if URL is set
			if (this._modelUrl)
			{
				this._loadModel(this._modelUrl);
			}
		}
	}

	_release(): void
	{
		// Clean up glTF model resources
		if (this._model)
		{
			this._model.release(this.runtime.renderer);
			this._model = null;
		}
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
			this._lastHeight !== this.height ||
			this._lastAngle !== this.angle ||
			this._lastZElevation !== this.zElevation ||
			this._lastRotationX !== this._rotationX ||
			this._lastRotationY !== this._rotationY ||
			this._lastRotationZ !== this._rotationZ
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

		// 4. Scale based on instance size (uniform scale using width)
		const scale = this.width;
		vec3.set(tempVec, scale, scale, scale);
		mat4.scale(tempMatrix, tempMatrix, tempVec);

		// Update last transform values for dirty checking
		this._lastX = this.x;
		this._lastY = this.y;
		this._lastWidth = this.width;
		this._lastHeight = this.height;
		this._lastAngle = this.angle;
		this._lastZElevation = this.zElevation;
		this._lastRotationX = this._rotationX;
		this._lastRotationY = this._rotationY;
		this._lastRotationZ = this._rotationZ;

		return tempMatrix as Float32Array;
	}

	_draw(renderer: IRenderer): void
	{
		// Draw the glTF model if loaded
		if (this._model?.isLoaded)
		{
			// Update mesh positions if transform changed
			if (this._isTransformDirty())
			{
				const matrix = this._buildTransformMatrix();
				this._model.updateTransform(matrix);
			}

			// Draw the model
			this._model.draw(renderer);
		}
		else
		{
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

	_isModelLoaded(): boolean
	{
		return this._model?.isLoaded ?? false;
	}

	async _loadModel(url: string): Promise<void>
	{
		// Prevent concurrent loads
		if (this._isLoading) return;

		this._modelUrl = url;
		this._isLoading = true;

		// Release existing model
		if (this._model)
		{
			this._model.release(this.runtime.renderer);
			this._model = null;
		}

		// Reset transform tracking to force update on first draw
		this._lastX = NaN;

		try
		{
			this._model = new GltfModel();
			await this._model.load(this.runtime.renderer, url);

			// Trigger "On Loaded" condition
			this._trigger(C3.Plugins.GltfStatic.Cnds.OnLoaded);
		}
		catch (err)
		{
			console.error("[GltfStatic] Failed to load model:", err);
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
			"rotationZ": this._rotationZ
		};
	}

	_loadFromJson(o: JSONValue): void
	{
		const data = o as JSONObject;
		this._modelUrl = data["modelUrl"] as string;
		this._rotationX = data["rotationX"] as number;
		this._rotationY = data["rotationY"] as number;
		this._rotationZ = data["rotationZ"] as number;

		// Reload model after restoring state
		if (this._modelUrl)
		{
			this._loadModel(this._modelUrl);
		}
	}
};

export type SDKInstanceClass = InstanceType<typeof C3.Plugins.GltfStatic.Instance>;
