const esbuild = require("esbuild");
const fs = require("fs");
const path = require("path");

const BUNDLE_PATH = "c3runtime/gltf-bundle.js";
const GLTF_SRC_DIR = "c3runtime/gltf";

// Delete old bundle and compiled JS files to avoid caching issues
function cleanBuildFiles() {
	// Delete the bundle
	try {
		fs.unlinkSync(BUNDLE_PATH);
	} catch (e) {
		// Ignore if file doesn't exist
	}

	// Delete compiled .js files in gltf source folder (esbuild uses .ts directly)
	try {
		const files = fs.readdirSync(GLTF_SRC_DIR);
		for (const file of files) {
			if (file.endsWith(".js")) {
				fs.unlinkSync(path.join(GLTF_SRC_DIR, file));
			}
		}
	} catch (e) {
		// Ignore if folder doesn't exist
	}
}

cleanBuildFiles();

// Bundle the gltf modules with their npm dependencies
// ESM format - globalThis attachment is done in index.ts
esbuild.build({
	entryPoints: ["c3runtime/gltf/index.ts"],
	bundle: true,
	format: "esm",
	outfile: BUNDLE_PATH,
	platform: "browser",
	target: "es2021",
	minify: false,
	sourcemap: false
}).then(() => {
	console.log("gltf-bundle.js built successfully");
}).catch((err) => {
	console.error("Build failed:", err);
	process.exit(1);
});
