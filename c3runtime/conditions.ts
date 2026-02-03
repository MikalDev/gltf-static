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
	},

	// Mesh visibility conditions
	IsMeshVisible(this: SDKInstanceClass, name: string): boolean
	{
		return this._isMeshVisible(name);
	},

	IsMeshVisibleByIndex(this: SDKInstanceClass, index: number): boolean
	{
		return this._isMeshVisibleByIndex(index);
	},

	// Animation conditions
	IsAnimationPlaying(this: SDKInstanceClass): boolean
	{
		return this._isAnimationPlaying();
	},

	IsAnimationPaused(this: SDKInstanceClass): boolean
	{
		return this._isAnimationPaused();
	},

	HasAnimation(this: SDKInstanceClass, name: string): boolean
	{
		return this._hasAnimation(name);
	},

	OnAnimationFinished(this: SDKInstanceClass): boolean
	{
		return true; // Trigger condition - always returns true when triggered
	},

	// Bone attachment conditions
	HasBone(this: SDKInstanceClass, name: string): boolean
	{
		return this._hasBone(name);
	}
};
