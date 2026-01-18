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
	}
};
