import { GltfModel, mat4, vec3 } from "./gltf-bundle.js";
// Debug logging - set to false to disable
const DEBUG = true;
const LOG_PREFIX = "[GltfStatic]";
function debugLog(...args) {
    if (DEBUG)
        console.log(LOG_PREFIX, ...args);
}
function debugWarn(...args) {
    if (DEBUG)
        console.warn(LOG_PREFIX, ...args);
}
function debugError(...args) {
    // Always log errors, but add prefix only in debug mode
    console.error(LOG_PREFIX, ...args);
}
// Property indices (matching order in plugin.ts)
const PROP_MODEL_URL = 2;
const PROP_ROTATION_X = 3;
const PROP_ROTATION_Y = 4;
const PROP_ROTATION_Z = 5;
// Reusable matrix/vectors for transform calculations (avoid per-frame allocations)
const tempMatrix = mat4.create();
const tempVec = vec3.create();
// Degrees to radians conversion factor
const DEG_TO_RAD = Math.PI / 180;
C3.Plugins.GltfStatic.Instance = class GltfStaticInstance extends ISDKWorldInstanceBase {
    constructor() {
        super();
        // Model state
        this._modelUrl = "";
        this._rotationX = 0;
        this._rotationY = 0;
        this._rotationZ = 0;
        // glTF model
        this._model = null;
        this._isLoading = false;
        // Transform tracking for dirty checks
        this._lastX = NaN;
        this._lastY = NaN;
        this._lastWidth = NaN;
        this._lastAngle = NaN;
        this._lastZElevation = NaN;
        this._lastRotationX = NaN;
        this._lastRotationY = NaN;
        this._lastRotationZ = NaN;
        // Debug stats
        this._drawCount = 0;
        this._lastDrawTime = 0;
        debugLog("Instance created");
    }
    _onCreate() {
        debugLog("_onCreate called");
        // Initialize from properties array
        const props = this._getInitProperties();
        if (props) {
            this._modelUrl = props[PROP_MODEL_URL];
            this._rotationX = props[PROP_ROTATION_X];
            this._rotationY = props[PROP_ROTATION_Y];
            this._rotationZ = props[PROP_ROTATION_Z];
            debugLog("Properties loaded:", {
                modelUrl: this._modelUrl,
                rotationX: this._rotationX,
                rotationY: this._rotationY,
                rotationZ: this._rotationZ
            });
            // Auto-load model if URL is set
            if (this._modelUrl) {
                debugLog("Auto-loading model from URL:", this._modelUrl);
                this._loadModel(this._modelUrl);
            }
        }
    }
    _release() {
        debugLog("_release called, total draws:", this._drawCount);
        // Clean up glTF model resources
        if (this._model) {
            this._model.release(this.runtime.renderer);
            this._model = null;
            debugLog("Model resources released");
        }
    }
    /**
     * Check if instance transform has changed since last update.
     */
    _isTransformDirty() {
        return (this._lastX !== this.x ||
            this._lastY !== this.y ||
            this._lastWidth !== this.width ||
            this._lastAngle !== this.angle ||
            this._lastZElevation !== this.zElevation ||
            this._lastRotationX !== this._rotationX ||
            this._lastRotationY !== this._rotationY ||
            this._lastRotationZ !== this._rotationZ);
    }
    /**
     * Build transform matrix from instance properties.
     * Order: Scale -> 3D Rotation (X, Y, Z) -> 2D Rotation (angle) -> Translation
     * This ensures the model is scaled first, then rotated, then positioned.
     */
    _buildTransformMatrix() {
        // Start with identity
        mat4.identity(tempMatrix);
        // 1. Translate to instance position
        vec3.set(tempVec, this.x, this.y, this.totalZElevation);
        mat4.translate(tempMatrix, tempMatrix, tempVec);
        // 2. Apply 2D angle rotation (around Z axis) - C3's instance angle
        if (this.angle !== 0) {
            mat4.rotateZ(tempMatrix, tempMatrix, this.angle);
        }
        // 3. Apply 3D rotations (Euler angles in degrees, converted to radians)
        if (this._rotationX !== 0) {
            mat4.rotateX(tempMatrix, tempMatrix, this._rotationX * DEG_TO_RAD);
        }
        if (this._rotationY !== 0) {
            mat4.rotateY(tempMatrix, tempMatrix, this._rotationY * DEG_TO_RAD);
        }
        if (this._rotationZ !== 0) {
            mat4.rotateZ(tempMatrix, tempMatrix, this._rotationZ * DEG_TO_RAD);
        }
        // 4. Scale based on instance size (uniform scale using width)
        const scale = this.width;
        vec3.set(tempVec, scale, scale, scale);
        mat4.scale(tempMatrix, tempMatrix, tempVec);
        // Update last transform values for dirty checking
        this._lastX = this.x;
        this._lastY = this.y;
        this._lastWidth = this.width;
        this._lastAngle = this.angle;
        this._lastZElevation = this.zElevation;
        this._lastRotationX = this._rotationX;
        this._lastRotationY = this._rotationY;
        this._lastRotationZ = this._rotationZ;
        return tempMatrix;
    }
    _draw(renderer) {
        const drawStart = performance.now();
        this._drawCount++;
        // Log first draw and every 60 frames (roughly every second at 60fps)
        const shouldLog = this._drawCount === 1 || this._drawCount % 60 === 0;
        // Draw the glTF model if loaded
        if (this._model?.isLoaded) {
            // Update mesh positions if transform changed
            if (this._isTransformDirty()) {
                if (shouldLog)
                    debugLog("Transform dirty, rebuilding matrix");
                const matrix = this._buildTransformMatrix();
                this._model.updateTransform(matrix);
            }
            // Draw the model
            this._model.draw(renderer);
            const drawTime = performance.now() - drawStart;
            this._lastDrawTime = drawTime;
            if (shouldLog) {
                debugLog(`Draw #${this._drawCount}:`, {
                    drawTimeMs: drawTime.toFixed(2),
                    position: { x: this.x, y: this.y, z: this.totalZElevation },
                    size: { width: this.width, height: this.height },
                    rotation: { x: this._rotationX, y: this._rotationY, z: this._rotationZ, angle: this.angle }
                });
            }
        }
        else {
            if (shouldLog) {
                debugLog(`Draw #${this._drawCount}: Model not loaded, drawing placeholder`, {
                    isLoading: this._isLoading,
                    hasModel: !!this._model
                });
            }
            // Fallback: draw placeholder texture while model is loading
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
        return this._model?.isLoaded ?? false;
    }
    async _loadModel(url) {
        // Prevent concurrent loads
        if (this._isLoading) {
            debugWarn("Load already in progress, ignoring request for:", url);
            return;
        }
        debugLog("Starting model load:", url);
        const loadStart = performance.now();
        this._modelUrl = url;
        this._isLoading = true;
        // Release existing model
        if (this._model) {
            debugLog("Releasing previous model");
            this._model.release(this.runtime.renderer);
            this._model = null;
        }
        // Reset transform tracking to force update on first draw
        this._lastX = NaN;
        try {
            this._model = new GltfModel();
            await this._model.load(this.runtime.renderer, url);
            const loadTime = performance.now() - loadStart;
            const stats = this._model.getStats();
            debugLog(`Model loaded successfully in ${loadTime.toFixed(0)}ms:`, {
                url,
                ...stats
            });
            // Trigger "On Loaded" condition
            this._trigger(C3.Plugins.GltfStatic.Cnds.OnLoaded);
        }
        catch (err) {
            const loadTime = performance.now() - loadStart;
            debugError(`Failed to load model after ${loadTime.toFixed(0)}ms:`, url, err);
            this._model = null;
            // Trigger "On Load Error" condition
            this._trigger(C3.Plugins.GltfStatic.Cnds.OnLoadError);
        }
        finally {
            this._isLoading = false;
        }
    }
    _saveToJson() {
        return {
            "modelUrl": this._modelUrl,
            "rotationX": this._rotationX,
            "rotationY": this._rotationY,
            "rotationZ": this._rotationZ
        };
    }
    _loadFromJson(o) {
        const data = o;
        this._modelUrl = data["modelUrl"];
        this._rotationX = data["rotationX"];
        this._rotationY = data["rotationY"];
        this._rotationZ = data["rotationZ"];
        // Reload model after restoring state
        if (this._modelUrl) {
            this._loadModel(this._modelUrl);
        }
    }
};
