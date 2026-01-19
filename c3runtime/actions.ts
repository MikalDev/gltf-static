import type { SDKInstanceClass } from "./instance.ts";

C3.Plugins.GltfStatic.Acts =
{
	LoadModel(this: SDKInstanceClass, url: string): void
	{
		this._loadModel(url);
	},

	SetRotation(this: SDKInstanceClass, x: number, y: number, z: number): void
	{
		this._setRotation(x, y, z);
	},

	SetScale(this: SDKInstanceClass, scale: number): void
	{
		this._setScale(scale);
	},

	SetScaleXYZ(this: SDKInstanceClass, x: number, y: number, z: number): void
	{
		this._setScaleXYZ(x, y, z);
	},

	SetWorkerEnabled(this: SDKInstanceClass, enabled: number): void
	{
		this._setWorkerEnabled(enabled !== 0);
	}
};
