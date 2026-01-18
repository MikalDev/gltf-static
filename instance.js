const PLUGIN_CLASS = SDK.Plugins.GltfStatic;
PLUGIN_CLASS.Instance = class GltfStaticEditorInstance extends SDK.IWorldInstanceBase {
    constructor(sdkType, inst) {
        super(sdkType, inst);
    }
    Release() {
    }
    OnCreate() {
    }
    OnPlacedInLayout() {
    }
    Draw(iRenderer, iDrawParams) {
        // Get the texture from the object type's image
        const objectType = this.GetObjectType();
        const image = objectType.GetImage();
        const texture = image.GetCachedWebGLTexture();
        if (texture) {
            // Draw the textured quad
            iRenderer.SetTexture(texture);
            iRenderer.SetColor(this._inst.GetColor());
            iRenderer.Quad3(this._inst.GetQuad(), image.GetTexRect());
        }
        else {
            // Draw a placeholder rectangle when no texture is available
            iRenderer.SetColorFillMode();
            iRenderer.SetColorRgba(0.25, 0.25, 0.5, 1);
            iRenderer.Quad(this._inst.GetQuad());
        }
    }
    OnMakeOriginalSize() {
        const objectType = this.GetObjectType();
        const image = objectType.GetImage();
        const width = image.GetWidth();
        const height = image.GetHeight();
        if (width > 0 && height > 0) {
            this._inst.SetSize(width, height);
        }
    }
    OnDoubleTap() {
        this.GetObjectType().EditImage();
    }
    HasDoubleTapHandler() {
        return true;
    }
    OnPropertyChanged(id, value) {
    }
    LoadC2Property(name, valueString) {
        return false;
    }
};
export {};
