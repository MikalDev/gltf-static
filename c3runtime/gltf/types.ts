import { Document, Texture } from "@gltf-transform/core";

// Debug logging
const DEBUG = true;
const LOG_PREFIX = "[ModelCache]";

function debugLog(...args: unknown[]): void {
	if (DEBUG) console.log(LOG_PREFIX, ...args);
}

/** Cached model data shared across instances loading the same URL */
export interface CachedModelData {
	url: string;
	document: Document;                    // glTF-Transform parsed document
	textureMap: Map<Texture, ITexture>;    // GPU textures keyed by glTF Texture
	refCount: number;                      // Reference counting for cleanup
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
