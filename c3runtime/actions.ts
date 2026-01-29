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
	},

	// Animation actions
	PlayAnimation(this: SDKInstanceClass, name: string): void
	{
		this._playAnimation(name);
	},

	PlayAnimationByIndex(this: SDKInstanceClass, index: number): void
	{
		this._playAnimationByIndex(index);
	},

	StopAnimation(this: SDKInstanceClass): void
	{
		this._stopAnimation();
	},

	PauseAnimation(this: SDKInstanceClass): void
	{
		this._pauseAnimation();
	},

	ResumeAnimation(this: SDKInstanceClass): void
	{
		this._resumeAnimation();
	},

	SetAnimationTime(this: SDKInstanceClass, time: number): void
	{
		this._setAnimationTime(time);
	},

	SetAnimationSpeed(this: SDKInstanceClass, speed: number): void
	{
		this._setAnimationSpeed(speed);
	},

	SetAnimationLoop(this: SDKInstanceClass, loop: number): void
	{
		this._setAnimationLoop(loop !== 0);
	}
};
