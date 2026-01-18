C3.Plugins.GltfStatic.Type = class GltfStaticType extends ISDKObjectTypeBase {
    constructor() {
        super();
    }
    _onCreate() {
        // Load the image asset using the image info
        const imageInfo = this.getImageInfo();
        if (imageInfo) {
            this.runtime.assets.loadImageAsset(imageInfo);
        }
    }
    _loadTextures(renderer) {
        const imageInfo = this.getImageInfo();
        return renderer.loadTextureForImageInfo(imageInfo, {
            sampling: this.runtime.sampling
        });
    }
    _releaseTextures(renderer) {
        const imageInfo = this.getImageInfo();
        renderer.releaseTextureForImageInfo(imageInfo);
    }
};
export {};
