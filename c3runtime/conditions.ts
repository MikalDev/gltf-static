import type { SDKInstanceClass } from "./instance.ts";

C3.Plugins.GltfStatic.Cnds =
{
	IsLoaded(this: SDKInstanceClass): boolean
	{
		return this._isModelLoaded();
	}
};
