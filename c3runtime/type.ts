import type { SDKInstanceClass } from "./instance.ts";

C3.Plugins.GltfStatic.Type = class GltfStaticType extends (ISDKObjectTypeBase as new () => ISDKObjectTypeBase_<SDKInstanceClass>)
{
	constructor()
	{
		super();
	}

	_onCreate(): void
	{
		// Load the image asset using the image info
		const imageInfo = this.getImageInfo();
		if (imageInfo)
		{
			this.runtime.assets.loadImageAsset(imageInfo);
		}
	}

	_loadTextures(renderer: IRenderer): Promise<ITexture | null>
	{
		const imageInfo = this.getImageInfo();
		return renderer.loadTextureForImageInfo(imageInfo, {
			sampling: this.runtime.sampling
		});
	}

	_releaseTextures(renderer: IRenderer): void
	{
		const imageInfo = this.getImageInfo();
		renderer.releaseTextureForImageInfo(imageInfo);
	}
};

export {}
