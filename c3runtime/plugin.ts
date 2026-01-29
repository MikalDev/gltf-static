C3.Plugins.GltfStatic = class GltfStaticPlugin extends ISDKPluginBase
{
	constructor()
	{
		super();
		this._captureRuntime();
	}

	async _captureRuntime(): Promise<void>
	{
		if (!(globalThis as any).badlandsR) {
			(globalThis as any).badlandsR = await (globalThis as any)["badlandsRuntime"];
		}
	}
};

export {}
