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
	}
};
