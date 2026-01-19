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
	}
};
