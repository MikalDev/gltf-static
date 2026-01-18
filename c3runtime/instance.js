// Property indices (matching order in plugin.ts)
const PROP_MODEL_URL = 2;
const PROP_ROTATION_X = 3;
const PROP_ROTATION_Y = 4;
const PROP_ROTATION_Z = 5;
C3.Plugins.GltfStatic.Instance = class GltfStaticInstance extends ISDKWorldInstanceBase {
    constructor() {
        super();
        // Model state
        this._modelUrl = "";
        this._isLoaded = false;
        this._rotationX = 0;
        this._rotationY = 0;
        this._rotationZ = 0;
    }
    _onCreate() {
        // Initialize from properties array
        const props = this._getInitProperties();
        if (props) {
            this._modelUrl = props[PROP_MODEL_URL];
            this._rotationX = props[PROP_ROTATION_X];
            this._rotationY = props[PROP_ROTATION_Y];
            this._rotationZ = props[PROP_ROTATION_Z];
        }
    }
    _release() {
        // Clean up resources
    }
    _draw(renderer) {
        // Get the texture from the object type's image info
        const imageInfo = this.objectType.getImageInfo();
        const texture = imageInfo.getTexture(renderer);
        if (texture) {
            const quad = this.getBoundingQuad();
            // Apply pixel rounding if enabled
            if (this.runtime.isPixelRoundingEnabled) {
                const ox = Math.round(this.x) - this.x;
                const oy = Math.round(this.y) - this.y;
                quad.p1.x += ox;
                quad.p1.y += oy;
                quad.p2.x += ox;
                quad.p2.y += oy;
                quad.p3.x += ox;
                quad.p3.y += oy;
                quad.p4.x += ox;
                quad.p4.y += oy;
            }
            renderer.setTexture(texture);
            renderer.quad3(quad, imageInfo.getTexRect());
        }
    }
    // Getters for model state
    _getRotationX() {
        return this._rotationX;
    }
    _getRotationY() {
        return this._rotationY;
    }
    _getRotationZ() {
        return this._rotationZ;
    }
    _setRotation(x, y, z) {
        this._rotationX = x;
        this._rotationY = y;
        this._rotationZ = z;
    }
    _isModelLoaded() {
        return this._isLoaded;
    }
    _loadModel(url) {
        this._modelUrl = url;
        // TODO: Implement actual glTF loading
        this._isLoaded = false;
    }
    _saveToJson() {
        return {
            "modelUrl": this._modelUrl,
            "isLoaded": this._isLoaded,
            "rotationX": this._rotationX,
            "rotationY": this._rotationY,
            "rotationZ": this._rotationZ
        };
    }
    _loadFromJson(o) {
        const data = o;
        this._modelUrl = data["modelUrl"];
        this._isLoaded = data["isLoaded"];
        this._rotationX = data["rotationX"];
        this._rotationY = data["rotationY"];
        this._rotationZ = data["rotationZ"];
    }
};
export {};
