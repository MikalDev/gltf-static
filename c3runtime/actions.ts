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

	// Mesh visibility actions
	SetMeshVisible(this: SDKInstanceClass, name: string, visible: number): void
	{
		this._setMeshVisible(name, visible !== 0);
	},

	SetMeshVisibleByIndex(this: SDKInstanceClass, index: number, visible: number): void
	{
		this._setMeshVisibleByIndex(index, visible !== 0);
	},

	ShowMesh(this: SDKInstanceClass, name: string): void
	{
		this._setMeshVisible(name, true);
	},

	HideMesh(this: SDKInstanceClass, name: string): void
	{
		this._setMeshVisible(name, false);
	},

	ShowAllMeshes(this: SDKInstanceClass): void
	{
		this._showAllMeshes();
	},

	HideAllMeshes(this: SDKInstanceClass): void
	{
		this._hideAllMeshes();
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
	},

	SetAnimationFrameSkip(this: SDKInstanceClass, skip: number): void
	{
		this._setAnimationFrameSkip(skip);
	},

	SetFrameSkipLighting(this: SDKInstanceClass, enabled: number): void
	{
		this._setFrameSkipLighting(enabled !== 0);
	},

	SetDistanceLodEnabled(this: SDKInstanceClass, enabled: number): void
	{
		this._setDistanceLodEnabled(enabled !== 0);
	},

	SetDistanceLodThresholds(this: SDKInstanceClass, near: number, far: number, maxSkip: number): void
	{
		this._setDistanceLodThresholds(near, far, maxSkip);
	},

	// Quaternion rotation actions
	SetRotationQuaternion(this: SDKInstanceClass, json: string): void
	{
		this._setRotationQuaternionJson(json);
	},

	SetRotationQuaternionXYZW(this: SDKInstanceClass, x: number, y: number, z: number, w: number): void
	{
		this._setRotationQuaternion(x, y, z, w);
	}
};
