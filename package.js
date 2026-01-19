const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const archiver = require("archiver");

const DIST_DIR = "dist";
const ADDON_JSON = "addon.json";

async function build() {
	console.log("=== Building glTF Static Addon ===\n");

	// 1. Build the gltf bundle
	console.log("1. Building gltf-bundle.js...");
	execSync("node build.js", { stdio: "inherit" });

	// 2. Compile TypeScript
	console.log("\n2. Compiling TypeScript...");
	execSync("npx tsc", { stdio: "inherit" });

	// 3. Read addon.json to get file list and version
	console.log("\n3. Reading addon.json...");
	const addonJson = JSON.parse(fs.readFileSync(ADDON_JSON, "utf8"));
	const fileList = addonJson["file-list"];
	const version = addonJson["version"];
	const addonId = addonJson["id"];

	// 4. Create dist directory if it doesn't exist
	if (!fs.existsSync(DIST_DIR)) {
		fs.mkdirSync(DIST_DIR, { recursive: true });
	}

	// 5. Create .c3addon file (ZIP archive)
	const outputFile = path.join(DIST_DIR, `${addonId}-${version}.c3addon`);
	console.log(`\n4. Creating ${outputFile}...`);

	await createC3Addon(fileList, outputFile);

	console.log(`\n=== Build complete: ${outputFile} ===`);
}

function createC3Addon(fileList, outputPath) {
	return new Promise((resolve, reject) => {
		const output = fs.createWriteStream(outputPath);
		const archive = archiver("zip", { zlib: { level: 9 } });

		output.on("close", () => {
			console.log(`   Archive size: ${(archive.pointer() / 1024).toFixed(1)} KB`);
			resolve();
		});

		archive.on("error", (err) => {
			reject(err);
		});

		archive.pipe(output);

		// Add each file from the file-list
		for (const file of fileList) {
			if (fs.existsSync(file)) {
				archive.file(file, { name: file });
				console.log(`   + ${file}`);
			} else {
				console.warn(`   ! Missing: ${file}`);
			}
		}

		archive.finalize();
	});
}

build().catch((err) => {
	console.error("Build failed:", err);
	process.exit(1);
});
