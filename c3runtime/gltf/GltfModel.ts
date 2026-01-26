import { WebIO, Node as GltfNodeDef, Texture, Primitive, Root } from "@gltf-transform/core";
import { mat4, quat, vec3 } from "gl-matrix";
import { GltfMesh } from "./GltfMesh.js";
import { TransformWorkerPool, SharedWorkerPool } from "./TransformWorkerPool.js";
import { modelCache, CachedModelData } from "./types.js";

// Debug logging - set to false to disable
const DEBUG = true;
const LOG_PREFIX = "[GltfModel]";

function debugLog(...args: unknown[]): void {
	if (DEBUG) console.log(LOG_PREFIX, ...args);
}

function debugWarn(...args: unknown[]): void {
	if (DEBUG) console.warn(LOG_PREFIX, ...args);
}

// glTF primitive modes
const GLTF_TRIANGLES = 4;

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

	get isLoaded(): boolean {
		return this._isLoaded;
	}

	/** Whether worker pool is being used for transforms */
	get useWorkers(): boolean {
		return this._useWorkers && this._workerPool !== null;
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

		return {
			url,
			document,
			textureMap,
			refCount: 1
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
			const identityMatrix = mat4.create();
			const sceneList = root.listScenes();
			debugLog(`Found ${sceneList.length} scene(s)`);

			for (const scene of sceneList) {
				const children = scene.listChildren();
				debugLog(`Scene has ${children.length} root node(s)`);
				for (const node of children) {
					this._processNode(renderer, node, cached.textureMap, identityMatrix, loadedMeshes);
				}
			}
			debugLog(`Meshes processed in ${(performance.now() - meshStart).toFixed(0)}ms`);

			// Success - store resources (textures are referenced from cache, not owned)
			this._textures = [...cached.textureMap.values()];
			this._meshes = loadedMeshes;
			this._isLoaded = true;

			// Setup worker pool if beneficial
			this._setupWorkerPool();

			debugLog(`Load complete in ${(performance.now() - loadStart).toFixed(0)}ms:`, {
				meshes: this._meshes.length,
				textures: this._textures.length,
				vertices: this._totalVertices,
				indices: this._totalIndices,
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

			// Register all meshes with pool
			for (const mesh of this._meshes) {
				mesh.registerWithPool(this._workerPool);
			}

			debugLog(`Using shared worker pool (${this._workerPool.workerCount} workers), ${this._meshes.length} meshes registered`);
		} catch (err) {
			debugWarn("Failed to acquire shared worker pool, falling back to sync transforms:", err);
			this._useWorkers = false;
			this._workerPool = null;
		}
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

				// Re-register all meshes with shared pool
				for (const mesh of this._meshes) {
					mesh.registerWithPool(this._workerPool);
				}

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
	 * Process a glTF node recursively, adding meshes to flat array.
	 */
	private _processNode(
		renderer: IRenderer,
		nodeDef: GltfNodeDef,
		textureMap: Map<Texture, ITexture>,
		parentMatrix: mat4,
		loadedMeshes: GltfMesh[],
		depth: number = 0
	): void {
		const nodeName = nodeDef.getName() || "(unnamed)";
		const indent = "  ".repeat(depth);
		debugLog(`${indent}Processing node: "${nodeName}"`);

		// Compute world matrix for this node
		const localMatrix = this._getLocalMatrix(nodeDef);
		const worldMatrix = mat4.create();
		mat4.multiply(worldMatrix, parentMatrix, localMatrix);

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

				const gltfMesh = this._createMesh(
					renderer,
					primitive,
					worldMatrix,
					textureMap
				);
				if (gltfMesh) {
					loadedMeshes.push(gltfMesh);
				}
			}
		}

		// Recurse children with accumulated transform
		const children = nodeDef.listChildren();
		if (children.length > 0) {
			debugLog(`${indent}  ${children.length} child node(s)`);
		}
		for (const child of children) {
			this._processNode(renderer, child, textureMap, worldMatrix, loadedMeshes, depth + 1);
		}
	}

	/**
	 * Create GltfMesh from primitive, applying transform to positions.
	 */
	private _createMesh(
		renderer: IRenderer,
		primitive: Primitive,
		worldMatrix: mat4,
		textureMap: Map<Texture, ITexture>
	): GltfMesh | null {
		// Extract raw data
		const posAccessor = primitive.getAttribute("POSITION");
		const uvAccessor = primitive.getAttribute("TEXCOORD_0");
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

		debugLog(`    Primitive: ${vertexCount} verts, ${triangleCount} tris, UVs: ${texCoords ? "yes" : "no"}`);

		// Apply world transform to positions (bake transform)
		positions = this._transformPositions(positions, worldMatrix);

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
		mesh.create(renderer, positions, texCoords, indices, texture);
		return mesh;
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
	 */
	draw(renderer: IRenderer): void {
		// Set cull mode once for all meshes (performance optimization)
		const prevCullMode = renderer.getCullFaceMode();
		renderer.setCullFaceMode("back");

		for (const mesh of this._meshes) {
			mesh.draw(renderer);
		}

		// Restore previous cull mode
		renderer.setCullFaceMode(prevCullMode);
	}

	/**
	 * Release all resources.
	 * Meshes are released directly, textures are released via cache (shared).
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

		// Don't delete textures directly - release via cache
		this._textures = [];
		if (this._cachedUrl) {
			modelCache.release(this._cachedUrl, renderer);
			this._cachedUrl = "";
		}

		this._isLoaded = false;
	}
}
