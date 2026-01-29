import type { SDKEditorInstanceClass } from "./instance.ts";

const PLUGIN_ID = "GltfStatic";
const PLUGIN_CATEGORY: PluginInfoCategory = "3d";

const PLUGIN_CLASS = SDK.Plugins.GltfStatic = class GltfStaticPlugin extends SDK.IPluginBase
{
	constructor()
	{
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
		this._info.SetIs3D(true);
		this._info.SetSupportsZElevation(true);
		this._info.SetRuntimeModuleMainScript("c3runtime/main.js");
		this._info.AddC3RuntimeScript("c3runtime/gltf-bundle.js");
		this._info.AddFileDependency({
			filename: "c3runtime/standalone.js",
			type: "external-dom-script"
		});

		SDK.Lang.PushContext(".properties");

		this._info.SetProperties([
			new SDK.PluginProperty("link", "edit-image", {
				linkCallback: (param: SDK.IWorldInstanceBase | SDK.ITypeBase) => {
					const sdkType = param as SDK.ITypeBase;
					sdkType.GetObjectType().EditImage();
				},
				callbackType: "once-for-type"
			}),
			new SDK.PluginProperty("link", "make-original-size", {
				linkCallback: (param: SDK.IWorldInstanceBase | SDK.ITypeBase) => {
					const sdkInst = param as SDKEditorInstanceClass;
					sdkInst.OnMakeOriginalSize();
				},
				callbackType: "for-each-instance"
			}),
			new SDK.PluginProperty("text", "model-url", ""),
			new SDK.PluginProperty("float", "rotation-x", 0),
			new SDK.PluginProperty("float", "rotation-y", 0),
			new SDK.PluginProperty("float", "rotation-z", 0),
			new SDK.PluginProperty("float", "scale", 1)
		]);

		SDK.Lang.PopContext();
		SDK.Lang.PopContext();
	}
};

PLUGIN_CLASS.Register(PLUGIN_ID, PLUGIN_CLASS);
