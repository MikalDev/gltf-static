import type { SDKInstanceClass } from "./instance.ts";

C3.Plugins.GltfStatic.Cnds =
{
	IsLoaded(this: SDKInstanceClass): boolean
	{
		return this._isModelLoaded();
	},

	OnLoaded(this: SDKInstanceClass): boolean
	{
		return true; // Trigger condition - always returns true when triggered
	},

	OnLoadError(this: SDKInstanceClass): boolean
	{
		return true; // Trigger condition - always returns true when triggered
	},

	IsUsingWorkers(this: SDKInstanceClass): boolean
	{
		return this._isUsingWorkers();
	}
};
