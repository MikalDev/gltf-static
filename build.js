const esbuild = require("esbuild");

// Bundle the gltf modules with their npm dependencies
esbuild.build({
	entryPoints: ["c3runtime/gltf/index.ts"],
	bundle: true,
	format: "esm",
	outfile: "c3runtime/gltf-bundle.js",
	platform: "browser",
	target: "es2021",
	minify: false,
	sourcemap: false,
}).then(() => {
	console.log("gltf-bundle.js built successfully");
}).catch((err) => {
	console.error("Build failed:", err);
	process.exit(1);
});
