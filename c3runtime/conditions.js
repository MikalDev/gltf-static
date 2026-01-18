C3.Plugins.GltfStatic.Cnds =
    {
        IsLoaded() {
            return this._isModelLoaded();
        },
        OnLoaded() {
            return true; // Trigger condition - always returns true when triggered
        },
        OnLoadError() {
            return true; // Trigger condition - always returns true when triggered
        }
    };
export {};
