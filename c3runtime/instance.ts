// Property indices (matching order in plugin.ts)
const PROP_MODEL_URL = 2;
const PROP_ROTATION_X = 3;
const PROP_ROTATION_Y = 4;
const PROP_ROTATION_Z = 5;

C3.Plugins.GltfStatic.Instance = class GltfStaticInstance extends ISDKWorldInstanceBase
{
	// Model state
	_modelUrl: string = "";
	_isLoaded: boolean = false;
	_rotationX: number = 0;
	_rotationY: number = 0;
	_rotationZ: number = 0;

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
		}
	}

	_release(): void
	{
		// Clean up resources
	}

	_draw(renderer: IRenderer): void
	{
		// Get the texture from the object type's image info
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
		return this._isLoaded;
	}

	_loadModel(url: string): void
	{
		this._modelUrl = url;
		// TODO: Implement actual glTF loading
		this._isLoaded = false;
	}

	_saveToJson(): JSONValue
	{
		return {
			"modelUrl": this._modelUrl,
			"isLoaded": this._isLoaded,
			"rotationX": this._rotationX,
			"rotationY": this._rotationY,
			"rotationZ": this._rotationZ
		};
	}

	_loadFromJson(o: JSONValue): void
	{
		const data = o as JSONObject;
		this._modelUrl = data["modelUrl"] as string;
		this._isLoaded = data["isLoaded"] as boolean;
		this._rotationX = data["rotationX"] as number;
		this._rotationY = data["rotationY"] as number;
		this._rotationZ = data["rotationZ"] as number;
	}
};

export type SDKInstanceClass = InstanceType<typeof C3.Plugins.GltfStatic.Instance>;
