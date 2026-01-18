const PLUGIN_ID = "GltfStatic";
const PLUGIN_CATEGORY = "general";
const PLUGIN_CLASS = SDK.Plugins.GltfStatic = class GltfStaticPlugin extends SDK.IPluginBase {
    constructor() {
        super(PLUGIN_ID);
        SDK.Lang.PushContext("plugins." + PLUGIN_ID.toLowerCase());
        this._info.SetName(globalThis.lang(".name"));
        this._info.SetDescription(globalThis.lang(".description"));
        this._info.SetCategory(PLUGIN_CATEGORY);
        this._info.SetAuthor("Mikal");
        this._info.SetHelpUrl(globalThis.lang(".help-url"));
        this._info.SetPluginType("world");
        this._info.SetIsResizable(true);
        this._info.SetIsRotatable(true);
        this._info.SetHasImage(true);
        this._info.SetSupportsEffects(true);
        this._info.SetMustPreDraw(true);
        this._info.SetRuntimeModuleMainScript("c3runtime/main.js");
        this._info.AddC3RuntimeScript("c3runtime/gltf-bundle.js");
        SDK.Lang.PushContext(".properties");
        this._info.SetProperties([
            new SDK.PluginProperty("link", "edit-image", {
                linkCallback: (param) => {
                    const sdkType = param;
                    sdkType.GetObjectType().EditImage();
                },
                callbackType: "once-for-type"
            }),
            new SDK.PluginProperty("link", "make-original-size", {
                linkCallback: (param) => {
                    const sdkInst = param;
                    sdkInst.OnMakeOriginalSize();
                },
                callbackType: "for-each-instance"
            }),
            new SDK.PluginProperty("text", "model-url", ""),
            new SDK.PluginProperty("float", "rotation-x", 0),
            new SDK.PluginProperty("float", "rotation-y", 0),
            new SDK.PluginProperty("float", "rotation-z", 0)
        ]);
        SDK.Lang.PopContext();
        SDK.Lang.PopContext();
    }
};
PLUGIN_CLASS.Register(PLUGIN_ID, PLUGIN_CLASS);
export {};
