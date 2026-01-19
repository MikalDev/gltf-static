C3.Plugins.GltfStatic.Acts =
    {
        LoadModel(url) {
            this._loadModel(url);
        },
        SetRotation(x, y, z) {
            this._setRotation(x, y, z);
        },
        SetScale(scale) {
            this._setScale(scale);
        },
        SetScaleXYZ(x, y, z) {
            this._setScaleXYZ(x, y, z);
        },
        SetWorkerEnabled(enabled) {
            this._setWorkerEnabled(enabled !== 0);
        }
    };
export {};
