import type { SDKInstanceClass } from "./instance.ts";

C3.Plugins.GltfStatic.Exps =
{
	RotationX(this: SDKInstanceClass): number
	{
		return this._getRotationX();
	},

	RotationY(this: SDKInstanceClass): number
	{
		return this._getRotationY();
	},

	RotationZ(this: SDKInstanceClass): number
	{
		return this._getRotationZ();
	},

	ScaleX(this: SDKInstanceClass): number
	{
		return this._getScaleX();
	},

	ScaleY(this: SDKInstanceClass): number
	{
		return this._getScaleY();
	},

	ScaleZ(this: SDKInstanceClass): number
	{
		return this._getScaleZ();
	},

	WorkerEnabled(this: SDKInstanceClass): number
	{
		return this._getWorkerEnabled();
	},

	WorkerCount(this: SDKInstanceClass): number
	{
		return this._getWorkerCount();
	},

	TotalVertices(this: SDKInstanceClass): number
	{
		return this._getTotalVertices();
	},

	MeshCount(this: SDKInstanceClass): number
	{
		return this._getMeshCount();
	},

	// Animation expressions
	AnimationTime(this: SDKInstanceClass): number
	{
		return this._getAnimationTime();
	},

	AnimationDuration(this: SDKInstanceClass): number
	{
		return this._getAnimationDuration();
	},

	AnimationName(this: SDKInstanceClass): string
	{
		return this._getAnimationName();
	},

	AnimationCount(this: SDKInstanceClass): number
	{
		return this._getAnimationCount();
	},

	AnimationNameAt(this: SDKInstanceClass, index: number): string
	{
		return this._getAnimationNameAt(index);
	},

	AnimationSpeed(this: SDKInstanceClass): number
	{
		return this._getAnimationSpeed();
	},

	AnimationProgress(this: SDKInstanceClass): number
	{
		return this._getAnimationProgress();
	},

	AnimationNames(this: SDKInstanceClass): string
	{
		return this._getAnimationNamesJson();
	}
};
