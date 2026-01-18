const PLUGIN_CLASS = SDK.Plugins.GltfStatic;

PLUGIN_CLASS.Type = class GltfStaticType extends SDK.ITypeBase
{
	constructor(sdkPlugin: SDK.IPluginBase, iObjectType: SDK.IObjectType)
	{
		super(sdkPlugin, iObjectType);
	}
};

export {}
