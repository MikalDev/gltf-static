import { Document, Texture, Node as GltfNode } from "@gltf-transform/core";

// Debug logging
const DEBUG = false;
const LOG_PREFIX = "[ModelCache]";

function debugLog(...args: unknown[]): void {
	if (DEBUG) console.log(LOG_PREFIX, ...args);
}

// ============================================================================
// Skinning Data Types
// ============================================================================

/** Per-mesh skinning attributes (shared, immutable after load) */
export interface MeshSkinningData {
	/** Bone indices per vertex (4 per vertex, Uint8 or Uint16) */
	joints: Uint8Array | Uint16Array;
	/** Bone weights per vertex (4 per vertex, normalized to sum to 1.0) */
	weights: Float32Array;
	/** Index of the skin this mesh uses (references CachedSkinData) */
	skinIndex: number;
}

/** Skeleton joint info */
export interface JointData {
	/** Index in the joints array */
	index: number;
	/** Joint name (from glTF node) */
	name: string;
	/** Parent joint index (-1 for root joints) */
	parentIndex: number;
	/** Reference to the glTF node (for computing world transforms) */
	node: GltfNode;
	/** Local bind transform (rest pose) */
	localBindTransform: Float32Array;
}

/** Skin data (skeleton + inverse bind matrices) - shared across instances */
export interface CachedSkinData {
	/** Skin name */
	name: string;
	/** Ordered list of joints in this skin */
	joints: JointData[];
	/** Inverse bind matrices (16 floats per joint, flattened) */
	inverseBindMatrices: Float32Array;
	/** Map from glTF node to joint index for fast lookup */
	nodeToJointIndex: Map<GltfNode, number>;
}

// ============================================================================
// Joint Transform State (for runtime animation)
// ============================================================================

/** Per-joint transform state used during animation evaluation */
export interface JointTransform {
	/** Local translation (vec3) */
	translation: Float32Array;
	/** Local rotation (quaternion) */
	rotation: Float32Array;
	/** Local scale (vec3) */
	scale: Float32Array;
}

// ============================================================================
// Animation Data Types
// ============================================================================

/** Interpolation mode for animation samplers */
export type AnimationInterpolation = "LINEAR" | "STEP" | "CUBICSPLINE";

/** Animation target path */
export type AnimationTargetPath = "translation" | "rotation" | "scale" | "weights";

/** Single animation sampler (keyframe data) */
export interface AnimationSamplerData {
	/** Keyframe times in seconds */
	input: Float32Array;
	/** Keyframe values (vec3 for T/S, quat for R, float[] for weights) */
	output: Float32Array;
	/** Interpolation mode */
	interpolation: AnimationInterpolation;
}

/** Single animation channel (targets a specific node property) */
export interface AnimationChannelData {
	/** Target joint index (references JointData.index) or -1 if targeting non-joint node */
	targetJointIndex: number;
	/** Target node (for non-skinned animations or if joint not found) */
	targetNode: GltfNode | null;
	/** Which property to animate */
	targetPath: AnimationTargetPath;
	/** Index into the animation's samplers array */
	samplerIndex: number;
}

/** Complete animation clip - shared across instances */
export interface CachedAnimationData {
	/** Animation name */
	name: string;
	/** Duration in seconds (max of all sampler input times) */
	duration: number;
	/** All samplers (keyframe data) for this animation */
	samplers: AnimationSamplerData[];
	/** All channels (node/property targets) for this animation */
	channels: AnimationChannelData[];
}

// ============================================================================
// Cached Model Data (extended)
// ============================================================================

/** Cached model data shared across instances loading the same URL */
export interface CachedModelData {
	url: string;
	document: Document;                    // glTF-Transform parsed document
	textureMap: Map<Texture, ITexture>;    // GPU textures keyed by glTF Texture
	refCount: number;                      // Reference counting for cleanup

	// Skinning data (shared across all instances)
	skins: CachedSkinData[];               // All skins in the model
	meshSkinningData: Map<number, MeshSkinningData>;  // Mesh index -> skinning attributes

	// Animation data (shared across all instances)
	animations: CachedAnimationData[];     // All animation clips
}

/** Singleton model cache */
class ModelCacheImpl {
	private _cache = new Map<string, CachedModelData>();
	private _loading = new Map<string, Promise<CachedModelData>>();

	/** Check if URL is cached or loading */
	has(url: string): boolean {
		return this._cache.has(url) || this._loading.has(url);
	}

	/** Get cached data (undefined if not cached) */
	get(url: string): CachedModelData | undefined {
		return this._cache.get(url);
	}

	/** Get loading promise if URL is currently being loaded */
	getLoading(url: string): Promise<CachedModelData> | undefined {
		return this._loading.get(url);
	}

	/** Set loading promise for a URL */
	setLoading(url: string, promise: Promise<CachedModelData>): void {
		this._loading.set(url, promise);
	}

	/** Remove loading promise (on failure) */
	clearLoading(url: string): void {
		this._loading.delete(url);
	}

	/** Store loaded data and clear loading state */
	set(url: string, data: CachedModelData): void {
		this._cache.set(url, data);
		this._loading.delete(url);
		debugLog(`Cached model: ${url} (${data.textureMap.size} textures, refCount=${data.refCount})`);
	}

	/** Increment ref count and return data */
	acquire(url: string): CachedModelData | undefined {
		const data = this._cache.get(url);
		if (data) {
			data.refCount++;
			debugLog(`Acquired cached model: ${url} (refCount=${data.refCount}, sharing ${data.textureMap.size} textures)`);
		}
		return data;
	}

	/** Decrement ref count, cleanup textures when 0 */
	release(url: string, renderer: IRenderer): void {
		const data = this._cache.get(url);
		if (!data) return;

		data.refCount--;
		debugLog(`Released cached model: ${url} (refCount=${data.refCount})`);
		if (data.refCount <= 0) {
			// Delete all GPU textures
			debugLog(`Deleting ${data.textureMap.size} cached textures for: ${url}`);
			for (const texture of data.textureMap.values()) {
				renderer.deleteTexture(texture);
			}
			data.textureMap.clear();
			this._cache.delete(url);
		}
	}

	/** Clear entire cache (for debugging/testing) */
	clear(renderer: IRenderer): void {
		for (const data of this._cache.values()) {
			for (const texture of data.textureMap.values()) {
				renderer.deleteTexture(texture);
			}
		}
		this._cache.clear();
		this._loading.clear();
	}
}

export const modelCache = new ModelCacheImpl();
