import { WebIO, Node as GltfNodeDef, Texture, Primitive, Root, Skin, Animation } from "@gltf-transform/core";
import { mat4, quat, vec3 } from "gl-matrix";
import { GltfMesh } from "./GltfMesh.js";
import { GltfNode } from "./GltfNode.js";
import type { AnimationController } from "./AnimationController.js";
import { TransformWorkerPool, SharedWorkerPool, WorkerLightConfig } from "./TransformWorkerPool.js";
import { getVersion as getLightingVersion } from "./Lighting.js";
import {
	modelCache,
	CachedModelData,
	CachedSkinData,
	CachedAnimationData,
	MeshSkinningData,
	JointData,
	AnimationSamplerData,
	AnimationChannelData,
	AnimationInterpolation,
	AnimationTargetPath
} from "./types.js";

// Debug logging - set to false to disable
const DEBUG = false;
const LOG_PREFIX = "[GltfModel]";

function debugLog(...args: unknown[]): void {
	if (DEBUG) console.log(LOG_PREFIX, ...args);
}

function debugWarn(...args: unknown[]): void {
	if (DEBUG) console.warn(LOG_PREFIX, ...args);
}

// glTF primitive modes
const GLTF_TRIANGLES = 4;

// Track last frame cull mode was set (avoid redundant state changes across models)
let lastCullModeFrame = -1;

/** Stats about a loaded model */
export interface GltfModelStats {
	nodeCount: number;
	meshCount: number;
	textureCount: number;
	totalVertices: number;
	totalIndices: number;
}

/** Options for model loading and transform behavior */
export interface GltfModelOptions {
	/** Use worker pool for transforms. Default: true */
	useWorkers?: boolean;
	/** Number of workers in pool. Default: cores - 1 */
	workerCount?: number;
}

/**
 * Loads and manages a complete glTF model.
 * Owns all textures, meshes, and worker pool (responsible for cleanup).
 * Node hierarchy is flattened - transforms baked into mesh positions at load time.
 */
export class GltfModel {
	private _textures: ITexture[] = [];
	private _meshes: GltfMesh[] = [];
	private _isLoaded: boolean = false;

	// Stats tracking
	private _totalVertices: number = 0;
	private _totalIndices: number = 0;

	// Worker pool for async transforms (created on demand)
	private _workerPool: TransformWorkerPool | null = null;
	private _useWorkers = false;
	private _options: GltfModelOptions = {};

	// Cache tracking
	private _cachedUrl: string = "";

	// Matrix dirty tracking to avoid redundant transforms
	private _lastMatrix: Float32Array | null = null;

	// Static lighting dirty tracking to avoid redundant worker calls
	private _lastStaticLightingVersion: number = -1;
	private _lastStaticLightingMatrix: Float32Array | null = null;
	private _lastCameraPosition: Float32Array | null = null;

	// Bounding box center of all mesh positions (for rotation pivot)
	private _localCenter: Float32Array = new Float32Array(3);

	// Skinning and animation data (references to shared cache, NOT owned)
	private _skins: CachedSkinData[] = [];
	private _animations: CachedAnimationData[] = [];
	private _meshSkinningData: Map<number, MeshSkinningData> = new Map();

	// Node transforms for bone attachment queries (non-skinned models)
	private _nodeTransforms: Map<string, Float32Array> = new Map();

	// Node hierarchy (preserves parent-child relationships for transform inheritance)
	private _rootNodes: GltfNode[] = [];
	private _nodesByName: Map<string, GltfNode> = new Map();

	get isLoaded(): boolean {
		return this._isLoaded;
	}

	/** Bounding box center of all mesh positions (rotation/scale pivot) */
	get localCenter(): Float32Array {
		return this._localCenter;
	}

	/** Whether worker pool is being used for transforms */
	get useWorkers(): boolean {
		return this._useWorkers && this._workerPool !== null;
	}

	/** Whether this model has any skinned meshes */
	get hasSkinning(): boolean {
		return this._skins.length > 0;
	}

	/** Get all skins (skeletons) in the model */
	get skins(): readonly CachedSkinData[] {
		return this._skins;
	}

	/** Get all animations in the model */
	get animations(): readonly CachedAnimationData[] {
		return this._animations;
	}

	/** Get all meshes in the model (read-only) */
	get meshes(): readonly GltfMesh[] {
		return this._meshes;
	}

	/** Get skinning data for a specific mesh by index */
	getMeshSkinningData(meshIndex: number): MeshSkinningData | undefined {
		return this._meshSkinningData.get(meshIndex);
	}

	/** Get the skin data for a specific mesh (via its skinning data) */
	getMeshSkin(meshIndex: number): CachedSkinData | undefined {
		const skinningData = this._meshSkinningData.get(meshIndex);
		if (!skinningData) return undefined;
		return this._skins[skinningData.skinIndex];
	}

	/**
	 * Get statistics about the loaded model.
	 */
	getStats(): GltfModelStats {
		return {
			nodeCount: 0,  // Flattened - no node hierarchy stored
			meshCount: this._meshes.length,
			textureCount: this._textures.length,
			totalVertices: this._totalVertices,
			totalIndices: this._totalIndices
		};
	}

	/**
	 * Load model from URL.
	 * Uses shared cache for documents and textures when multiple instances load the same URL.
	 * @param renderer The C3 renderer
	 * @param url URL to glTF/GLB file
	 * @param options Optional configuration for worker pool
	 */
	async load(renderer: IRenderer, url: string, options?: GltfModelOptions): Promise<void> {
		debugLog("Loading glTF from:", url);
		const loadStart = performance.now();

		this._options = options || {};
		this._cachedUrl = url;

		// Check if already cached
		let cached = modelCache.get(url);
		if (cached) {
			debugLog("*** CACHE HIT *** Using cached model data for:", url);
			modelCache.acquire(url);
			await this._loadFromCache(renderer, cached, loadStart);
			return;
		}

		// Check if another instance is loading this URL
		const loadingPromise = modelCache.getLoading(url);
		if (loadingPromise) {
			debugLog("*** WAITING *** Another instance is loading:", url);
			cached = await loadingPromise;
			modelCache.acquire(url);
			await this._loadFromCache(renderer, cached, loadStart);
			return;
		}

		// Fresh load - set loading promise
		debugLog("*** FRESH LOAD *** No cache, loading:", url);
		const loadPromise = this._loadFresh(renderer, url);
		modelCache.setLoading(url, loadPromise);

		try {
			cached = await loadPromise;
			modelCache.set(url, cached);
			await this._loadFromCache(renderer, cached, loadStart);
		} catch (err) {
			// Remove from loading map on failure
			modelCache.clearLoading(url);
			throw err;
		}
	}

	/**
	 * Load fresh document and textures into cache.
	 */
	private async _loadFresh(renderer: IRenderer, url: string): Promise<CachedModelData> {
		debugLog("Fetching and parsing glTF document...");
		const fetchStart = performance.now();
		const io = new WebIO();
		const document = await io.read(url);
		const root = document.getRoot();
		debugLog(`Document parsed in ${(performance.now() - fetchStart).toFixed(0)}ms`);

		// Load all textures
		debugLog("Loading textures...");
		const textureStart = performance.now();
		const loadedTextures: ITexture[] = [];
		const textureMap = await this._loadTextures(renderer, root, loadedTextures);
		debugLog(`${loadedTextures.length} textures loaded in ${(performance.now() - textureStart).toFixed(0)}ms`);

		// Extract skins (skeleton data)
		debugLog("Extracting skin data...");
		const skinStart = performance.now();
		const { skins, skinMap } = this._extractSkins(root);
		debugLog(`${skins.length} skin(s) extracted in ${(performance.now() - skinStart).toFixed(0)}ms`);

		// Extract animations
		debugLog("Extracting animation data...");
		const animStart = performance.now();
		const animations = this._extractAnimations(root, skins);
		debugLog(`${animations.length} animation(s) extracted in ${(performance.now() - animStart).toFixed(0)}ms`);

		// Extract per-mesh skinning data (JOINTS_0, WEIGHTS_0)
		// This is done during mesh processing, but we need to pass the skinMap
		// Store skinMap temporarily on the cached data for use during mesh creation
		const meshSkinningData = new Map<number, MeshSkinningData>();

		return {
			url,
			document,
			textureMap,
			refCount: 1,
			skins,
			meshSkinningData,
			animations
		};
	}

	/**
	 * Load meshes from cached document/textures.
	 */
	private async _loadFromCache(
		renderer: IRenderer,
		cached: CachedModelData,
		loadStart: number
	): Promise<void> {
		debugLog("_loadFromCache: Creating meshes from cached document/textures");
		const loadedMeshes: GltfMesh[] = [];
		this._totalVertices = 0;
		this._totalIndices = 0;

		try {
			debugLog("Processing nodes and meshes...");
			const meshStart = performance.now();
			const root = cached.document.getRoot();
			const sceneList = root.listScenes();
			debugLog(`Found ${sceneList.length} scene(s)`);

			// Rebuild skinMap from document (maps glTF Skin objects to indices in cached.skins)
			const skinMap = new Map<Skin, number>();
			const skinList = root.listSkins();
			for (let i = 0; i < skinList.length; i++) {
				skinMap.set(skinList[i], i);
			}

			// Build global nodeToJointIndex map (across all skins)
			const globalNodeToJointIndex = new Map<GltfNodeDef, number>();
			for (const skin of cached.skins) {
				for (const joint of skin.joints) {
					globalNodeToJointIndex.set(joint.node, joint.index);
				}
			}

			// Track mesh and node indices across the entire traversal
			const meshIndexCounter = { value: 0 };
			const nodeIndexCounter = { value: 0 };

			// Clear node hierarchy storage
			this._rootNodes = [];
			this._nodesByName.clear();

			for (const scene of sceneList) {
				const children = scene.listChildren();
				debugLog(`Scene has ${children.length} root node(s)`);
				for (const nodeDef of children) {
					const rootNode = this._processNode(
						renderer,
						nodeDef,
						cached.textureMap,
						null,  // No parent for root nodes
						loadedMeshes,
						skinMap,
						cached.meshSkinningData,
						meshIndexCounter,
						nodeIndexCounter,
						globalNodeToJointIndex
					);
					this._rootNodes.push(rootNode);
				}
			}
			debugLog(`Meshes processed in ${(performance.now() - meshStart).toFixed(0)}ms`);

			// Success - store resources (textures are referenced from cache, not owned)
			this._textures = [...cached.textureMap.values()];
			this._meshes = loadedMeshes;
			this._computeLocalCenter();

			// Store references to cached skinning/animation data
			this._skins = cached.skins;
			this._animations = cached.animations;
			this._meshSkinningData = cached.meshSkinningData;

			// Wire up skinning data to meshes
			let skinnedMeshCount = 0;
			for (let i = 0; i < loadedMeshes.length; i++) {
				const skinningData = cached.meshSkinningData.get(i);
				if (skinningData) {
					const skinData = cached.skins[skinningData.skinIndex];
					loadedMeshes[i].setSkinningData(skinningData, skinData);
					skinnedMeshCount++;
				}
			}
			if (skinnedMeshCount > 0) {
				debugLog(`Wired up skinning data for ${skinnedMeshCount} mesh(es)`);
			}

			this._isLoaded = true;

			// Setup worker pool if beneficial
			this._setupWorkerPool();

			debugLog(`Load complete in ${(performance.now() - loadStart).toFixed(0)}ms:`, {
				meshes: this._meshes.length,
				textures: this._textures.length,
				vertices: this._totalVertices,
				indices: this._totalIndices,
				skins: this._skins.length,
				animations: this._animations.length,
				skinnedMeshes: skinnedMeshCount,
				useWorkers: this._useWorkers
			});
		} catch (err) {
			debugWarn("Load failed, cleaning up partial resources...");
			// Cleanup any partially loaded meshes (cache owns textures)
			for (const mesh of loadedMeshes) {
				mesh.release();
			}
			throw err;
		}
	}

	/**
	 * Compute bounding box center across all mesh positions.
	 * Used as the pivot origin for rotation and scale.
	 */
	private _computeLocalCenter(): void {
		let minX = Infinity, minY = Infinity, minZ = Infinity;
		let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

		for (const mesh of this._meshes) {
			const positions = mesh.originalPositions;
			if (!positions) continue;

			for (let i = 0; i < positions.length; i += 3) {
				const x = positions[i];
				const y = positions[i + 1];
				const z = positions[i + 2];
				if (x < minX) minX = x;
				if (x > maxX) maxX = x;
				if (y < minY) minY = y;
				if (y > maxY) maxY = y;
				if (z < minZ) minZ = z;
				if (z > maxZ) maxZ = z;
			}
		}

		this._localCenter[0] = (minX + maxX) * 0.5;
		this._localCenter[1] = (minY + maxY) * 0.5;
		this._localCenter[2] = (minZ + maxZ) * 0.5;

		debugLog("Local center:", this._localCenter);
	}

	/**
	 * Setup worker pool based on options. Workers are enabled by default.
	 * Workers provide parallel transform computation with 1-frame latency.
	 * Uses a shared global pool (not per-model) for efficiency.
	 */
	private _setupWorkerPool(): void {
		// Workers are enabled by default (user can disable via useWorkers: false)
		if (this._options.useWorkers === false) {
			debugLog("Worker pool explicitly disabled");
			this._useWorkers = false;
			return;
		}

		try {
			// Use shared global pool instead of creating per-model pool
			this._workerPool = SharedWorkerPool.acquire();
			this._useWorkers = true;

			// Register all meshes with pool (regular transforms)
			for (const mesh of this._meshes) {
				mesh.registerWithPool(this._workerPool);
			}

			// Register skinned meshes with pool (for worker skinning)
			this._registerSkinnedMeshesWithPool();

			// Register static meshes with pool (for worker lighting)
			this._registerStaticMeshesForLightingWithPool();

			debugLog(`Using shared worker pool (${this._workerPool.workerCount} workers), ${this._meshes.length} meshes registered`);
		} catch (err) {
			debugWarn("Failed to acquire shared worker pool, falling back to sync transforms:", err);
			this._useWorkers = false;
			this._workerPool = null;
		}
	}

	/**
	 * Register all skinned meshes with the worker pool for worker-based skinning.
	 */
	private _registerSkinnedMeshesWithPool(): void {
		if (!this._workerPool) {
			debugLog(`_registerSkinnedMeshesWithPool: No worker pool`);
			return;
		}

		let skinnedCount = 0;
		let registeredCount = 0;
		for (const mesh of this._meshes) {
			if (mesh.isSkinned) {
				skinnedCount++;
				mesh.registerSkinnedWithPool(this._workerPool);
				if (mesh.isRegisteredSkinnedWithPool) {
					registeredCount++;
				}
			}
		}

		debugLog(`_registerSkinnedMeshesWithPool: ${skinnedCount} skinned, ${registeredCount} registered with pool`);
	}

	/**
	 * Register all static (non-skinned) meshes with the worker pool for worker-based lighting.
	 */
	private _registerStaticMeshesForLightingWithPool(): void {
		if (!this._workerPool) return;

		let staticCount = 0;
		let registeredCount = 0;
		for (const mesh of this._meshes) {
			if (!mesh.isSkinned && mesh.hasNormals) {
				staticCount++;
				mesh.registerStaticLightingWithPool(this._workerPool);
				if (mesh.isRegisteredStaticLightingWithPool) {
					registeredCount++;
				}
			}
		}

		if (registeredCount > 0) {
			debugLog(`_registerStaticMeshesForLightingWithPool: ${staticCount} static, ${registeredCount} registered with pool`);
		}
	}

	/**
	 * Queue worker-based skinning for all skinned meshes using the given bone matrices.
	 * Call this after AnimationController.update() to offload skinning to workers.
	 * @param boneMatrices Bone matrices from AnimationController.getBoneMatrices()
	 * @param lightConfig Optional lighting configuration to compute vertex colors in worker
	 */
	queueSkinning(boneMatrices: Float32Array, lightConfig?: WorkerLightConfig): void {
		if (!this._workerPool || !this._useWorkers) return;

		// Collect IDs of all skinned meshes registered with pool
		const meshIds: number[] = [];
		for (const mesh of this._meshes) {
			if (mesh.isSkinned && mesh.isRegisteredSkinnedWithPool) {
				meshIds.push(mesh.id);
			}
		}

		if (meshIds.length === 0) return;

		// Queue skinning with shared bone matrices and optional lighting
		this._workerPool.queueSkinning(meshIds, boneMatrices, lightConfig);

		// Schedule flush for end of frame
		SharedWorkerPool.scheduleFlush();
	}

	/**
	 * Queue worker-based lighting for all static (non-skinned) meshes.
	 * Skips if lighting version and rotation haven't changed (dirty tracking).
	 * @param lightConfig Lighting configuration (ambient, lights, modelRotation)
	 */
	queueStaticLighting(lightConfig: WorkerLightConfig): void {
		if (!this._workerPool || !this._useWorkers) return;

		// Dirty check: skip if nothing changed
		const currentVersion = getLightingVersion();
		const matrixChanged = this._hasMatrixChanged(
			lightConfig.modelMatrix,
			this._lastStaticLightingMatrix
		);
		const cameraChanged = this._hasCameraPositionChanged(lightConfig.cameraPosition);
		if (this._lastStaticLightingVersion === currentVersion && !matrixChanged && !cameraChanged) {
			return;
		}

		// Collect mesh IDs
		const meshIds: number[] = [];
		for (const mesh of this._meshes) {
			if (!mesh.isSkinned && mesh.isRegisteredStaticLightingWithPool) {
				meshIds.push(mesh.id);
			}
		}
		if (meshIds.length === 0) return;

		// Update dirty state and queue
		this._lastStaticLightingVersion = currentVersion;
		this._lastStaticLightingMatrix = lightConfig.modelMatrix
			? new Float32Array(lightConfig.modelMatrix)
			: null;
		this._lastCameraPosition = lightConfig.cameraPosition
			? new Float32Array(lightConfig.cameraPosition)
			: null;

		this._workerPool.queueStaticLighting(meshIds, lightConfig);
		SharedWorkerPool.scheduleFlush();
	}

	/**
	 * Check if model matrix changed.
	 * Compares rotation/scale (upper-left 3x3) AND translation (for spotlights).
	 */
	private _hasMatrixChanged(
		current: Float32Array | null | undefined,
		last: Float32Array | null
	): boolean {
		if (!current && !last) return false;
		if (!current || !last) return true;
		// Check rotation/scale (0,1,2,4,5,6,8,9,10) and translation (12,13,14)
		for (const i of [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14]) {
			if (Math.abs(last[i] - current[i]) > 0.0001) return true;
		}
		return false;
	}

	/**
	 * Check if camera position changed (for specular recalculation).
	 */
	private _hasCameraPositionChanged(
		current: Float32Array | number[] | null | undefined
	): boolean {
		const last = this._lastCameraPosition;
		if (!current && !last) return false;
		if (!current || !last) return true;
		for (let i = 0; i < 3; i++) {
			if (Math.abs(last[i] - current[i]) > 0.0001) return true;
		}
		return false;
	}

	/**
	 * Check if worker skinning is available for this model.
	 */
	get hasWorkerSkinning(): boolean {
		if (!this._workerPool) {
			debugLog(`hasWorkerSkinning: false (no worker pool)`);
			return false;
		}
		if (!this._useWorkers) {
			debugLog(`hasWorkerSkinning: false (workers disabled)`);
			return false;
		}
		let skinnedCount = 0;
		let registeredCount = 0;
		for (const mesh of this._meshes) {
			if (mesh.isSkinned) {
				skinnedCount++;
				if (mesh.isRegisteredSkinnedWithPool) {
					registeredCount++;
				}
			}
		}
		if (registeredCount > 0) {
			debugLog(`hasWorkerSkinning: true (${registeredCount}/${skinnedCount} registered)`);
			return true;
		}
		debugLog(`hasWorkerSkinning: false (${skinnedCount} skinned, ${registeredCount} registered)`);
		return false;
	}

	/**
	 * Check if worker static lighting is available for this model.
	 */
	get hasWorkerStaticLighting(): boolean {
		if (!this._workerPool || !this._useWorkers) return false;

		for (const mesh of this._meshes) {
			if (!mesh.isSkinned && mesh.isRegisteredStaticLightingWithPool) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Enable or disable worker pool at runtime.
	 * When disabling, releases reference to shared pool.
	 * When enabling, acquires reference to shared pool.
	 */
	setWorkersEnabled(enabled: boolean): void {
		if (enabled === this._useWorkers) return;

		if (!enabled) {
			// Disable workers - release reference to shared pool
			if (this._workerPool) {
				SharedWorkerPool.release();
				this._workerPool = null;
			}
			this._useWorkers = false;
			debugLog("Workers disabled");
		} else {
			// Enable workers - acquire reference to shared pool
			if (this._meshes.length === 0) {
				debugLog("No meshes to register with workers");
				return;
			}

			try {
				this._workerPool = SharedWorkerPool.acquire();
				this._useWorkers = true;

				// Re-register all meshes with shared pool (regular transforms)
				for (const mesh of this._meshes) {
					mesh.registerWithPool(this._workerPool);
				}

				// Re-register skinned meshes for worker skinning
				this._registerSkinnedMeshesWithPool();

				// Re-register static meshes for worker lighting
				this._registerStaticMeshesForLightingWithPool();

				debugLog(`Workers enabled using shared pool (${this._workerPool.workerCount} workers)`);
			} catch (err) {
				debugWarn("Failed to enable workers:", err);
				this._useWorkers = false;
				this._workerPool = null;
			}
		}
	}

	/**
	 * Get the number of active workers (0 if workers disabled).
	 */
	getWorkerCount(): number {
		return this._workerPool?.workerCount ?? 0;
	}

	/**
	 * Load all textures, return map for lookup.
	 */
	private async _loadTextures(
		renderer: IRenderer,
		root: Root,
		loadedTextures: ITexture[]
	): Promise<Map<Texture, ITexture>> {
		const map = new Map<Texture, ITexture>();
		const textureList = root.listTextures();
		debugLog(`Found ${textureList.length} texture(s) in document`);

		let textureIndex = 0;
		for (const texture of textureList) {
			const imageData = texture.getImage();
			if (imageData) {
				const mimeType = texture.getMimeType() || "image/png";
				const blob = new Blob([imageData], { type: mimeType });
				const bitmap = await createImageBitmap(blob);

				debugLog(`Texture ${textureIndex}: ${bitmap.width}x${bitmap.height} (${mimeType}, ${imageData.byteLength} bytes)`);

				try {
					const c3Texture = await renderer.createStaticTexture(bitmap, {
						sampling: "bilinear",
						mipMap: true,
						wrapX: "repeat",
						wrapY: "repeat"
					});

					loadedTextures.push(c3Texture);
					map.set(texture, c3Texture);
				} finally {
					// Always close bitmap to free memory
					bitmap.close();
				}
			} else {
				debugWarn(`Texture ${textureIndex}: No image data`);
			}
			textureIndex++;
		}

		return map;
	}

	/**
	 * Process a glTF node recursively, building node tree and adding meshes to flat array.
	 * @param parentNode Parent GltfNode (null for root nodes)
	 * @param globalNodeToJointIndex Map from glTF node to joint index (across all skins)
	 * @returns The created GltfNode
	 */
	private _processNode(
		renderer: IRenderer,
		nodeDef: GltfNodeDef,
		textureMap: Map<Texture, ITexture>,
		parentNode: GltfNode | null,
		loadedMeshes: GltfMesh[],
		skinMap: Map<Skin, number>,
		meshSkinningData: Map<number, MeshSkinningData>,
		meshIndexCounter: { value: number },
		nodeIndexCounter: { value: number },
		globalNodeToJointIndex: Map<GltfNodeDef, number>,
		depth: number = 0
	): GltfNode {
		// Generate node name with fallback for unnamed nodes
		const rawName = nodeDef.getName();
		const nodeName = rawName || `node_${nodeIndexCounter.value}`;
		nodeIndexCounter.value++;

		const indent = "  ".repeat(depth);
		debugLog(`${indent}Processing node: "${nodeName}"${rawName ? "" : " (generated)"}`);

		// Create node with LOCAL matrix (not world - world is computed on demand)
		const localMatrix = this._getLocalMatrix(nodeDef);
		const node = new GltfNode(nodeName, localMatrix);

		// Link to parent
		if (parentNode) {
			parentNode.addChild(node);
		}

		// Store in lookup map
		this._nodesByName.set(nodeName, node);

		// Check if this node is a joint
		const jointIndex = globalNodeToJointIndex.get(nodeDef);
		if (jointIndex !== undefined) {
			node.jointIndex = jointIndex;
			debugLog(`${indent}  Node is joint (index ${jointIndex})`);
		}

		// Store node world transform for bone attachment queries (computed from hierarchy)
		this._nodeTransforms.set(nodeName, new Float32Array(node.getWorldMatrix()));

		// Check if this node has a skin
		const skin = nodeDef.getSkin();
		const skinIndex = skin ? skinMap.get(skin) : undefined;
		if (skin && skinIndex !== undefined) {
			debugLog(`${indent}  Node has skin (index ${skinIndex})`);
		}

		const mesh = nodeDef.getMesh();

		if (mesh) {
			const primitives = mesh.listPrimitives();
			debugLog(`${indent}  Mesh has ${primitives.length} primitive(s)`);

			for (const primitive of primitives) {
				// Only process triangle primitives (mode 4 or undefined which defaults to triangles)
				const mode = primitive.getMode();
				if (mode !== GLTF_TRIANGLES && mode !== undefined) {
					debugWarn(`${indent}  Skipping non-triangle primitive (mode: ${mode})`);
					continue;
				}

				const currentMeshIndex = meshIndexCounter.value;

				const gltfMesh = this._createMesh(
					renderer,
					primitive,
					textureMap,
					skinIndex,
					node
				);

				if (gltfMesh) {
					// Set node name and parent node for identification and transform inheritance
					gltfMesh.name = nodeName;
					gltfMesh.parentNode = node;
					loadedMeshes.push(gltfMesh);

					// Extract skinning data if this node has a skin
					if (skinIndex !== undefined) {
						const skinningData = this._extractMeshSkinningData(primitive, skinIndex);
						if (skinningData) {
							meshSkinningData.set(currentMeshIndex, skinningData);
							debugLog(`${indent}    Mesh ${currentMeshIndex}: Skinning data extracted`);
						}
					}

					meshIndexCounter.value++;
				}
			}
		}

		// Recurse children
		const children = nodeDef.listChildren();
		if (children.length > 0) {
			debugLog(`${indent}  ${children.length} child node(s)`);
		}
		for (const child of children) {
			this._processNode(
				renderer, child, textureMap, node, loadedMeshes,
				skinMap, meshSkinningData, meshIndexCounter, nodeIndexCounter,
				globalNodeToJointIndex, depth + 1
			);
		}

		return node;
	}

	/**
	 * Create GltfMesh from primitive.
	 * For meshes with animated ancestors: keep positions in local space (runtime transforms)
	 * For meshes without animated ancestors: bake node world matrix into positions
	 * @param skinIndex If present, this mesh is skinned
	 * @param parentNode The parent GltfNode for this mesh
	 */
	private _createMesh(
		renderer: IRenderer,
		primitive: Primitive,
		textureMap: Map<Texture, ITexture>,
		skinIndex?: number,
		parentNode?: GltfNode
	): GltfMesh | null {
		// Extract raw data
		const posAccessor = primitive.getAttribute("POSITION");
		const uvAccessor = primitive.getAttribute("TEXCOORD_0");
		const normalAccessor = primitive.getAttribute("NORMAL");
		const indicesAccessor = primitive.getIndices();

		if (!posAccessor || !indicesAccessor) {
			debugWarn("Primitive missing POSITION or indices, skipping");
			return null;
		}

		const posArray = posAccessor.getArray();
		const indicesArray = indicesAccessor.getArray();

		if (!posArray || !indicesArray) {
			debugWarn("Primitive has null array data, skipping");
			return null;
		}

		// Ensure we have Float32Array for positions
		let positions: Float32Array;
		if (posArray instanceof Float32Array) {
			positions = posArray;
		} else {
			positions = new Float32Array(posArray);
		}

		// Get normals if available
		const normalArray = normalAccessor?.getArray();
		let normals: Float32Array | null = null;
		if (normalArray) {
			normals = new Float32Array(normalArray);
		}

		// Get UVs if available
		const uvArray = uvAccessor?.getArray();
		let texCoords: Float32Array | null = null;
		if (uvArray) {
			texCoords = new Float32Array(uvArray);

			// Debug: log UV range
			let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
			for (let i = 0; i < texCoords.length; i += 2) {
				minU = Math.min(minU, texCoords[i]);
				maxU = Math.max(maxU, texCoords[i]);
				minV = Math.min(minV, texCoords[i + 1]);
				maxV = Math.max(maxV, texCoords[i + 1]);
			}
			debugLog(`    UV range: U[${minU.toFixed(2)}-${maxU.toFixed(2)}], V[${minV.toFixed(2)}-${maxV.toFixed(2)}]`);
		}

		// Get indices - convert to appropriate type
		let indices: Uint16Array | Uint32Array;
		if (indicesArray instanceof Uint16Array || indicesArray instanceof Uint32Array) {
			indices = indicesArray;
		} else if (indicesArray instanceof Uint8Array) {
			indices = new Uint16Array(indicesArray);
		} else {
			indices = new Uint16Array(indicesArray);
		}

		const vertexCount = positions.length / 3;
		const indexCount = indices.length;
		const triangleCount = indexCount / 3;

		// Track stats
		this._totalVertices += vertexCount;
		this._totalIndices += indexCount;

		debugLog(`    Primitive: ${vertexCount} verts, ${triangleCount} tris, UVs: ${texCoords ? "yes" : "no"}, normals: ${normals ? "yes" : "computed"}, skinned: ${skinIndex !== undefined}`);

		// Determine if this mesh needs runtime transforms (has animated ancestor)
		const hasAnimatedAncestor = parentNode?.hasAnimatedAncestor() ?? false;

		if (skinIndex !== undefined) {
			// Skinned mesh: keep bind pose positions (skinning applies transforms at runtime)
			positions = new Float32Array(positions);
			if (normals) {
				normals = new Float32Array(normals);
			}
			debugLog(`    Skinned mesh: keeping bind pose positions`);
		} else if (hasAnimatedAncestor) {
			// Static mesh with animated ancestor: keep local positions (node hierarchy applies at runtime)
			positions = new Float32Array(positions);
			if (normals) {
				normals = new Float32Array(normals);
			}
			debugLog(`    Static mesh with animated ancestor: keeping local positions`);
		} else {
			// Static mesh without animated ancestor: bake node world transform
			const worldMatrix = parentNode?.getWorldMatrix();
			if (worldMatrix) {
				positions = this._transformPositions(new Float32Array(positions), worldMatrix as unknown as mat4);
				if (normals) {
					normals = this._transformNormals(new Float32Array(normals), worldMatrix as unknown as mat4);
				}
				debugLog(`    Static mesh: baked node world transform`);
			} else {
				positions = new Float32Array(positions);
				if (normals) {
					normals = new Float32Array(normals);
				}
			}
		}

		// Get texture from material
		let texture: ITexture | null = null;
		const material = primitive.getMaterial();
		if (material) {
			const baseColorTex = material.getBaseColorTexture();
			if (baseColorTex) {
				texture = textureMap.get(baseColorTex) || null;
				if (texture) {
					debugLog(`    Texture assigned from material`);
				} else {
					debugWarn(`    Material has texture but not found in map`);
				}
			}
		}

		// Create and return mesh
		const mesh = new GltfMesh();
		mesh.create(renderer, positions, texCoords, indices, texture, normals);
		return mesh;
	}

	/**
	 * Transform normals by the upper-left 3x3 of a matrix.
	 */
	private _transformNormals(normals: Float32Array, matrix: mat4): Float32Array {
		const result = new Float32Array(normals.length);
		const n = normals.length / 3;

		// Extract 3x3 rotation/scale part
		const m0 = matrix[0], m1 = matrix[1], m2 = matrix[2];
		const m4 = matrix[4], m5 = matrix[5], m6 = matrix[6];
		const m8 = matrix[8], m9 = matrix[9], m10 = matrix[10];

		for (let i = 0; i < n; i++) {
			const idx = i * 3;
			const nx = normals[idx];
			const ny = normals[idx + 1];
			const nz = normals[idx + 2];

			// Transform
			let tnx = m0 * nx + m4 * ny + m8 * nz;
			let tny = m1 * nx + m5 * ny + m9 * nz;
			let tnz = m2 * nx + m6 * ny + m10 * nz;

			// Normalize
			const len = Math.sqrt(tnx * tnx + tny * tny + tnz * tnz);
			if (len > 0.0001) {
				result[idx] = tnx / len;
				result[idx + 1] = tny / len;
				result[idx + 2] = tnz / len;
			} else {
				result[idx] = 0;
				result[idx + 1] = 1;
				result[idx + 2] = 0;
			}
		}

		return result;
	}

	/**
	 * Get local transform matrix for a node.
	 */
	private _getLocalMatrix(node: GltfNodeDef): mat4 {
		// glTF spec: if matrix is present, use it; otherwise use TRS
		const nodeMatrix = node.getMatrix();
		if (nodeMatrix) {
			// glTF-Transform returns number[], convert to mat4
			return mat4.fromValues(
				nodeMatrix[0], nodeMatrix[1], nodeMatrix[2], nodeMatrix[3],
				nodeMatrix[4], nodeMatrix[5], nodeMatrix[6], nodeMatrix[7],
				nodeMatrix[8], nodeMatrix[9], nodeMatrix[10], nodeMatrix[11],
				nodeMatrix[12], nodeMatrix[13], nodeMatrix[14], nodeMatrix[15]
			);
		}

		// Build from TRS components
		const t = node.getTranslation();
		const r = node.getRotation();
		const s = node.getScale();

		const result = mat4.create();
		mat4.fromRotationTranslationScale(
			result,
			quat.fromValues(r[0], r[1], r[2], r[3]),
			vec3.fromValues(t[0], t[1], t[2]),
			vec3.fromValues(s[0], s[1], s[2])
		);
		return result;
	}

	/**
	 * Transform positions by matrix using gl-matrix.
	 */
	private _transformPositions(positions: Float32Array, matrix: mat4): Float32Array {
		const result = new Float32Array(positions.length);
		const vertexCount = positions.length / 3;
		const tempVec = vec3.create();

		for (let i = 0; i < vertexCount; i++) {
			vec3.set(tempVec, positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
			vec3.transformMat4(tempVec, tempVec, matrix);
			result[i * 3] = tempVec[0];
			result[i * 3 + 1] = tempVec[1];
			result[i * 3 + 2] = tempVec[2];
		}

		return result;
	}

	// ========================================================================
	// Skin Extraction
	// ========================================================================

	/**
	 * Extract all skins from the document root.
	 * Creates a mapping from glTF Skin objects to our CachedSkinData.
	 */
	private _extractSkins(root: Root): { skins: CachedSkinData[]; skinMap: Map<Skin, number> } {
		const skins: CachedSkinData[] = [];
		const skinMap = new Map<Skin, number>();
		const skinList = root.listSkins();

		debugLog(`Found ${skinList.length} skin(s) in document`);

		for (const skin of skinList) {
			const skinIndex = skins.length;
			skinMap.set(skin, skinIndex);

			const skinData = this._extractSingleSkin(skin);
			skins.push(skinData);

			debugLog(`Skin ${skinIndex} "${skinData.name}": ${skinData.joints.length} joints`);
		}

		return { skins, skinMap };
	}

	/**
	 * Extract data from a single glTF Skin.
	 */
	private _extractSingleSkin(skin: Skin): CachedSkinData {
		const name = skin.getName() || "(unnamed skin)";
		const jointNodes = skin.listJoints();
		const nodeToJointIndex = new Map<GltfNodeDef, number>();

		// Build joint data with hierarchy
		const joints: JointData[] = [];
		for (let i = 0; i < jointNodes.length; i++) {
			const node = jointNodes[i];
			nodeToJointIndex.set(node, i);
		}

		// Second pass: build JointData with parent indices
		for (let i = 0; i < jointNodes.length; i++) {
			const node = jointNodes[i];
			const parent = node.getParentNode();

			// Find parent joint index (-1 if parent is not a joint)
			let parentIndex = -1;
			if (parent) {
				const parentJointIdx = nodeToJointIndex.get(parent);
				if (parentJointIdx !== undefined) {
					parentIndex = parentJointIdx;
				}
			}

			// Get local bind transform
			const localBindTransform = new Float32Array(16);
			const localMat = this._getLocalMatrix(node);
			localBindTransform.set(localMat);

			joints.push({
				index: i,
				name: node.getName() || `joint_${i}`,
				parentIndex,
				node,
				localBindTransform
			});
		}

		// Extract inverse bind matrices
		const ibmAccessor = skin.getInverseBindMatrices();
		let inverseBindMatrices: Float32Array;

		if (ibmAccessor) {
			const ibmArray = ibmAccessor.getArray();
			if (ibmArray instanceof Float32Array) {
				inverseBindMatrices = ibmArray;
			} else if (ibmArray) {
				inverseBindMatrices = new Float32Array(ibmArray);
			} else {
				// Fallback: identity matrices
				debugWarn(`Skin "${name}": No inverse bind matrix data, using identity`);
				inverseBindMatrices = new Float32Array(jointNodes.length * 16);
				for (let i = 0; i < jointNodes.length; i++) {
					mat4.identity(inverseBindMatrices.subarray(i * 16, i * 16 + 16) as unknown as mat4);
				}
			}
		} else {
			// Fallback: identity matrices
			debugWarn(`Skin "${name}": No inverse bind matrices accessor, using identity`);
			inverseBindMatrices = new Float32Array(jointNodes.length * 16);
			for (let i = 0; i < jointNodes.length; i++) {
				mat4.identity(inverseBindMatrices.subarray(i * 16, i * 16 + 16) as unknown as mat4);
			}
		}

		return {
			name,
			joints,
			inverseBindMatrices,
			nodeToJointIndex
		};
	}

	// ========================================================================
	// Animation Extraction
	// ========================================================================

	/**
	 * Extract all animations from the document root.
	 */
	private _extractAnimations(root: Root, skins: CachedSkinData[]): CachedAnimationData[] {
		const animations: CachedAnimationData[] = [];
		const animList = root.listAnimations();

		debugLog(`Found ${animList.length} animation(s) in document`);

		// Build a combined node-to-joint map from all skins
		const globalNodeToJoint = new Map<GltfNodeDef, number>();
		for (const skin of skins) {
			for (const [node, jointIdx] of skin.nodeToJointIndex) {
				globalNodeToJoint.set(node, jointIdx);
			}
		}

		for (const anim of animList) {
			const animData = this._extractSingleAnimation(anim, globalNodeToJoint);
			animations.push(animData);
			debugLog(`Animation "${animData.name}": ${animData.duration.toFixed(2)}s, ${animData.channels.length} channels, ${animData.samplers.length} samplers`);
		}

		return animations;
	}

	/**
	 * Extract data from a single glTF Animation.
	 */
	private _extractSingleAnimation(
		anim: Animation,
		nodeToJointIndex: Map<GltfNodeDef, number>
	): CachedAnimationData {
		const name = anim.getName() || "(unnamed animation)";
		const samplers: AnimationSamplerData[] = [];
		const channels: AnimationChannelData[] = [];
		let duration = 0;

		// glTF-transform: channels reference samplers directly
		const gltfChannels = anim.listChannels();
		const gltfSamplers = anim.listSamplers();

		// Build sampler map for index lookup
		const samplerIndexMap = new Map<ReturnType<Animation["listSamplers"]>[0], number>();
		for (let i = 0; i < gltfSamplers.length; i++) {
			samplerIndexMap.set(gltfSamplers[i], i);
		}

		// Extract samplers
		for (const gltfSampler of gltfSamplers) {
			const inputAccessor = gltfSampler.getInput();
			const outputAccessor = gltfSampler.getOutput();

			if (!inputAccessor || !outputAccessor) {
				debugWarn(`Animation "${name}": Sampler missing input or output accessor`);
				samplers.push({
					input: new Float32Array(0),
					output: new Float32Array(0),
					interpolation: "LINEAR"
				});
				continue;
			}

			const inputArray = inputAccessor.getArray();
			const outputArray = outputAccessor.getArray();

			const input = inputArray instanceof Float32Array
				? inputArray
				: new Float32Array(inputArray || []);

			const output = outputArray instanceof Float32Array
				? outputArray
				: new Float32Array(outputArray || []);

			// Track max time for duration
			if (input.length > 0) {
				const maxTime = input[input.length - 1];
				if (maxTime > duration) {
					duration = maxTime;
				}
			}

			const interpolation = (gltfSampler.getInterpolation() || "LINEAR") as AnimationInterpolation;

			samplers.push({
				input,
				output,
				interpolation
			});
		}

		// Extract channels
		for (const gltfChannel of gltfChannels) {
			const targetNode = gltfChannel.getTargetNode();
			const targetPath = gltfChannel.getTargetPath() as AnimationTargetPath;
			const sampler = gltfChannel.getSampler();

			if (!targetNode || !sampler) {
				debugWarn(`Animation "${name}": Channel missing target node or sampler`);
				continue;
			}

			const samplerIndex = samplerIndexMap.get(sampler);
			if (samplerIndex === undefined) {
				debugWarn(`Animation "${name}": Channel references unknown sampler`);
				continue;
			}

			// Look up joint index
			const targetJointIndex = nodeToJointIndex.get(targetNode) ?? -1;

			channels.push({
				targetJointIndex,
				targetNode: targetJointIndex === -1 ? targetNode : null,
				targetPath,
				samplerIndex
			});
		}

		return {
			name,
			duration,
			samplers,
			channels
		};
	}

	// ========================================================================
	// Mesh Skinning Attribute Extraction
	// ========================================================================

	/**
	 * Extract per-vertex skinning attributes (JOINTS_0, WEIGHTS_0) from a primitive.
	 * Returns null if the primitive doesn't have skinning data.
	 */
	private _extractMeshSkinningData(
		primitive: Primitive,
		skinIndex: number
	): MeshSkinningData | null {
		const jointsAccessor = primitive.getAttribute("JOINTS_0");
		const weightsAccessor = primitive.getAttribute("WEIGHTS_0");

		if (!jointsAccessor || !weightsAccessor) {
			return null;
		}

		const jointsArray = jointsAccessor.getArray();
		const weightsArray = weightsAccessor.getArray();

		if (!jointsArray || !weightsArray) {
			debugWarn("Skinning accessors have no data");
			return null;
		}

		// Convert joints to Uint8Array or Uint16Array
		let joints: Uint8Array | Uint16Array;
		if (jointsArray instanceof Uint8Array) {
			joints = jointsArray;
		} else if (jointsArray instanceof Uint16Array) {
			joints = jointsArray;
		} else {
			// Convert from other types (e.g., Uint32Array)
			const maxVal = Math.max(...Array.from(jointsArray));
			if (maxVal <= 255) {
				joints = new Uint8Array(jointsArray);
			} else {
				joints = new Uint16Array(jointsArray);
			}
		}

		// Convert weights to Float32Array
		const weights = weightsArray instanceof Float32Array
			? weightsArray
			: new Float32Array(weightsArray);

		const vertexCount = weights.length / 4;
		debugLog(`    Skinning: ${vertexCount} vertices, skin index ${skinIndex}`);

		return {
			joints,
			weights,
			skinIndex
		};
	}

	/**
	 * Update all mesh transforms synchronously (fallback mode).
	 */
	updateTransformSync(matrix: Float32Array): void {
		for (const mesh of this._meshes) {
			mesh.updateTransformSync(matrix);
		}
	}

	/**
	 * Update all mesh transforms using worker pool.
	 * Queues transforms and flushes, awaiting completion.
	 */
	async updateTransformAsync(matrix: Float32Array): Promise<void> {
		if (!this._workerPool || !this._useWorkers) {
			// Fallback to sync
			this.updateTransformSync(matrix);
			return;
		}

		// Queue transforms for all meshes
		for (const mesh of this._meshes) {
			mesh.queueTransform(matrix);
		}

		// Flush and await results
		await this._workerPool.flush();
	}

	/**
	 * Check if matrix has changed from last transform.
	 */
	private _isMatrixDirty(matrix: Float32Array): boolean {
		if (!this._lastMatrix) return true;
		for (let i = 0; i < 16; i++) {
			if (this._lastMatrix[i] !== matrix[i]) return true;
		}
		return false;
	}

	/**
	 * Update all mesh transforms. Uses workers if available, otherwise sync.
	 * Skips transform if matrix hasn't changed.
	 */
	updateTransform(matrix: Float32Array): void {
		// Skip if matrix hasn't changed
		if (!this._isMatrixDirty(matrix)) return;

		// Store copy of matrix for dirty checking
		if (!this._lastMatrix) {
			this._lastMatrix = new Float32Array(16);
		}
		this._lastMatrix.set(matrix);

		if (this._workerPool && this._useWorkers) {
			// Queue transforms for all meshes
			for (const mesh of this._meshes) {
				mesh.queueTransform(matrix);
			}
			// Schedule batched flush - all models' transforms sent together at frame end
			SharedWorkerPool.scheduleFlush();
		} else {
			this.updateTransformSync(matrix);
		}
	}

	/**
	 * Draw all meshes.
	 * @param renderer The C3 renderer
	 * @param frameId Current frame number (used to set cull mode once per frame)
	 */
	draw(renderer: IRenderer, frameId: number = 0): void {
		// Set cull mode once per frame (not per model)
		if (frameId !== lastCullModeFrame) {
			renderer.setCullFaceMode("back");
			lastCullModeFrame = frameId;
		}

		// Track last texture to avoid redundant state changes
		// undefined = first draw (forces state setup), null = no texture
		let lastTexture: ITexture | null | undefined = undefined;
		for (const mesh of this._meshes) {
			lastTexture = mesh.draw(renderer, lastTexture);
		}
	}

	// ==================== Mesh Visibility API ====================

	/**
	 * Set visibility of a mesh by name.
	 * @param name Node name to match (case-sensitive)
	 * @param visible Whether matching meshes should be rendered
	 * @returns Number of meshes affected
	 */
	setMeshVisibleByName(name: string, visible: boolean): number {
		let count = 0;
		for (const mesh of this._meshes) {
			if (mesh.name === name) {
				mesh.visible = visible;
				count++;
			}
		}
		return count;
	}

	/**
	 * Get visibility of the first mesh matching a name.
	 * @param name Node name to match
	 * @returns Visibility state, or undefined if no mesh found
	 */
	getMeshVisibleByName(name: string): boolean | undefined {
		for (const mesh of this._meshes) {
			if (mesh.name === name) {
				return mesh.visible;
			}
		}
		return undefined;
	}

	/**
	 * Set visibility of a mesh by index.
	 * @param index Mesh index (0-based)
	 * @param visible Whether the mesh should be rendered
	 * @returns true if mesh was found, false otherwise
	 */
	setMeshVisibleByIndex(index: number, visible: boolean): boolean {
		if (index < 0 || index >= this._meshes.length) return false;
		this._meshes[index].visible = visible;
		return true;
	}

	/**
	 * Get visibility of a mesh by index.
	 * @param index Mesh index (0-based)
	 * @returns Visibility state, or undefined if index out of range
	 */
	getMeshVisibleByIndex(index: number): boolean | undefined {
		if (index < 0 || index >= this._meshes.length) return undefined;
		return this._meshes[index].visible;
	}

	/**
	 * Show all meshes.
	 */
	showAllMeshes(): void {
		for (const mesh of this._meshes) {
			mesh.visible = true;
		}
	}

	/**
	 * Hide all meshes.
	 */
	hideAllMeshes(): void {
		for (const mesh of this._meshes) {
			mesh.visible = false;
		}
	}

	/**
	 * Get all unique mesh names in the model.
	 * @returns Array of unique node names
	 */
	getMeshNames(): string[] {
		const names = new Set<string>();
		for (const mesh of this._meshes) {
			names.add(mesh.name);
		}
		return Array.from(names);
	}

	// ==================== Node Transform API (Bone Attachments) ====================

	/**
	 * Get the world matrix for a named node (non-skinned models).
	 * For skinned models, use AnimationController.getJointWorldMatrix() instead.
	 * @param name Node name
	 * @returns World matrix (16 floats) or null if not found
	 */
	getNodeWorldMatrix(name: string): Float32Array | null {
		return this._nodeTransforms.get(name) ?? null;
	}

	/**
	 * Get all named node names in the model.
	 * @returns Array of node names
	 */
	getNodeNames(): string[] {
		return Array.from(this._nodeTransforms.keys());
	}

	/**
	 * Check if a named node exists.
	 * @param name Node name
	 * @returns true if node exists
	 */
	hasNode(name: string): boolean {
		return this._nodeTransforms.has(name);
	}

	/**
	 * Sync joint nodes with animation controller's computed local transforms.
	 * Call this after AnimationController.update() to update node hierarchy.
	 * @param animController The animation controller with updated joint transforms
	 */
	updateJointNodes(animController: AnimationController): void {
		for (const node of this._nodesByName.values()) {
			if (node.jointIndex >= 0) {
				const localTransform = animController.getJointLocalTransform(node.jointIndex);
				if (localTransform) {
					node.setLocalMatrix(localTransform);
				}
			}
		}
	}

	/**
	 * Update static mesh positions based on their parent node's world matrix.
	 * Call this after updateJointNodes() to update static meshes under animated joints.
	 * Skinned meshes are skipped (handled separately via bone matrices).
	 */
	updateStaticMeshTransforms(): void {
		for (const mesh of this._meshes) {
			if (!mesh.isSkinned && mesh.parentNode) {
				mesh.updateNodeTransform();
			}
		}
	}

	/**
	 * Release all resources.
	 * Meshes are released directly, textures are released via cache (shared).
	 * Skinning/animation data is shared via cache and not directly deleted.
	 */
	release(renderer: IRenderer): void {
		// Release all meshes first (they will unregister from pool)
		for (const mesh of this._meshes) {
			mesh.release();
		}
		this._meshes = [];
		this._lastMatrix = null;

		// Release reference to shared worker pool (pool will dispose when no refs left)
		if (this._workerPool) {
			SharedWorkerPool.release();
			this._workerPool = null;
		}
		this._useWorkers = false;

		// Clear references to shared skinning/animation data (cache owns this data)
		this._skins = [];
		this._animations = [];
		this._meshSkinningData = new Map();
		this._nodeTransforms.clear();
		this._rootNodes = [];
		this._nodesByName.clear();

		// Don't delete textures directly - release via cache
		this._textures = [];
		if (this._cachedUrl) {
			modelCache.release(this._cachedUrl, renderer);
			this._cachedUrl = "";
		}

		this._isLoaded = false;
	}
}
