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

	MeshNames(this: SDKInstanceClass): string
	{
		return this._getMeshNames();
	},

	MeshNameAt(this: SDKInstanceClass, index: number): string
	{
		return this._getMeshNameAt(index);
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
	},

	AnimationFrameSkip(this: SDKInstanceClass): number
	{
		return this._getAnimationFrameSkip();
	},

	FrameSkipLighting(this: SDKInstanceClass): number
	{
		return this._getFrameSkipLighting() ? 1 : 0;
	},

	DistanceLodEnabled(this: SDKInstanceClass): number
	{
		return this._getDistanceLodEnabled() ? 1 : 0;
	},

	EffectiveFrameSkip(this: SDKInstanceClass): number
	{
		return this._getEffectiveFrameSkip();
	},

	// Bone attachment expressions
	BoneX(this: SDKInstanceClass, name: string): number
	{
		const pos = this._getBonePosition(name);
		return pos ? pos[0] : 0;
	},

	BoneY(this: SDKInstanceClass, name: string): number
	{
		const pos = this._getBonePosition(name);
		return pos ? pos[1] : 0;
	},

	BoneZ(this: SDKInstanceClass, name: string): number
	{
		const pos = this._getBonePosition(name);
		return pos ? pos[2] : 0;
	},

	BoneAngle(this: SDKInstanceClass, name: string): number
	{
		return this._getBoneAngle(name);
	},

	BoneRotationX(this: SDKInstanceClass, name: string): number
	{
		const rot = this._getBoneRotation(name);
		return rot ? rot[0] : 0;
	},

	BoneRotationY(this: SDKInstanceClass, name: string): number
	{
		const rot = this._getBoneRotation(name);
		return rot ? rot[1] : 0;
	},

	BoneRotationZ(this: SDKInstanceClass, name: string): number
	{
		const rot = this._getBoneRotation(name);
		return rot ? rot[2] : 0;
	},

	BoneNames(this: SDKInstanceClass): string
	{
		return this._getBoneNames();
	},

	BoneCount(this: SDKInstanceClass): number
	{
		return this._getBoneCount();
	},

	// Quaternion rotation expressions
	RotationQuaternion(this: SDKInstanceClass): string
	{
		return this._getRotationQuaternionJson();
	},

	QuatX(this: SDKInstanceClass): number
	{
		return this._getQuatX();
	},

	QuatY(this: SDKInstanceClass): number
	{
		return this._getQuatY();
	},

	QuatZ(this: SDKInstanceClass): number
	{
		return this._getQuatZ();
	},

	QuatW(this: SDKInstanceClass): number
	{
		return this._getQuatW();
	}
};
