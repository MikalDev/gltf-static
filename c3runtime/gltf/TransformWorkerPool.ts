/**
 * Manages a pool of transform workers for parallel vertex processing.
 *
 * Design principles:
 * - KISS: Simple callback-based API, no complex promise chains
 * - Single Responsibility: Only manages worker communication and batching
 * - Dependency Inversion: Meshes provide callbacks, pool doesn't know about meshData
 */

// Inline worker code as string for blob URL creation (avoids separate file bundling)
const WORKER_CODE = `
const meshCache = new Map();

// Transform vertices from original to output buffer at specified offset
function transformVerticesInto(original, output, offset, matrix, vertexCount) {
	const m0 = matrix[0], m1 = matrix[1], m2 = matrix[2];
	const m4 = matrix[4], m5 = matrix[5], m6 = matrix[6];
	const m8 = matrix[8], m9 = matrix[9], m10 = matrix[10];
	const m12 = matrix[12], m13 = matrix[13], m14 = matrix[14];

	for (let i = 0; i < vertexCount; i++) {
		const srcIdx = i * 3;
		const dstIdx = offset + srcIdx;
		const x = original[srcIdx];
		const y = original[srcIdx + 1];
		const z = original[srcIdx + 2];

		output[dstIdx] = m0 * x + m4 * y + m8 * z + m12;
		output[dstIdx + 1] = m1 * x + m5 * y + m9 * z + m13;
		output[dstIdx + 2] = m2 * x + m6 * y + m10 * z + m14;
	}
}

self.onmessage = (e) => {
	const msg = e.data;

	switch (msg.type) {
		case "REGISTER": {
			const positions = msg.positions;
			const vertexCount = positions.length / 3;
			meshCache.set(msg.meshId, {
				original: positions,
				vertexCount,
				floatCount: positions.length
			});
			break;
		}

		case "TRANSFORM_BATCH": {
			// Calculate total size needed for packed buffer
			let totalFloats = 0;
			const meshEntries = [];
			for (const req of msg.requests) {
				const entry = meshCache.get(req.meshId);
				if (!entry) continue;
				totalFloats += entry.floatCount;
				meshEntries.push({ req, entry });
			}

			if (meshEntries.length === 0) {
				// No valid meshes, send empty response
				self.postMessage({ type: "TRANSFORM_RESULTS", meshIds: new Uint32Array(0), offsets: new Uint32Array(1), positions: new Float32Array(0) }, []);
				break;
			}

			// Allocate single packed buffer
			const packedPositions = new Float32Array(totalFloats);
			const offsets = new Uint32Array(meshEntries.length + 1);
			const meshIds = new Uint32Array(meshEntries.length);

			let offset = 0;
			for (let i = 0; i < meshEntries.length; i++) {
				const { req, entry } = meshEntries[i];

				// Transform into packed buffer directly
				transformVerticesInto(entry.original, packedPositions, offset, req.matrix, entry.vertexCount);

				meshIds[i] = req.meshId;
				offsets[i] = offset;
				offset += entry.floatCount;
			}
			offsets[meshEntries.length] = offset; // End marker

			self.postMessage(
				{ type: "TRANSFORM_RESULTS", meshIds, offsets, positions: packedPositions },
				[packedPositions.buffer, meshIds.buffer, offsets.buffer]
			);
			break;
		}

		case "UNREGISTER": {
			meshCache.delete(msg.meshId);
			break;
		}

		case "CLEAR": {
			meshCache.clear();
			break;
		}
	}
};
`;

type TransformCallback = (positions: Float32Array) => void;

interface MeshRegistration {
	workerIndex: number;
	callback: TransformCallback;
}

interface PendingRequest {
	meshId: number;
	matrix: Float32Array;
}

export class TransformWorkerPool {
	private _workers: Worker[] = [];
	private _workerBlobUrl: string | null = null;
	private _meshRegistry = new Map<number, MeshRegistration>();
	private _pendingByWorker: Map<number, PendingRequest[]> = new Map();
	private _flushResolvers: Array<() => void> = [];
	private _pendingResponses = 0;
	private _nextWorkerIndex = 0;
	private _workerCount: number;
	private _disposed = false;

	constructor(workerCount?: number) {
		// Default: use available cores minus 1 for main thread, minimum 1, maximum 8
		const defaultCount = Math.max(1, (navigator.hardwareConcurrency || 4) - 1);
		this._workerCount = Math.min(workerCount ?? defaultCount, 8);
		this._initWorkers();
	}

	private _initWorkers(): void {
		// Create blob URL for worker code
		const blob = new Blob([WORKER_CODE], { type: "application/javascript" });
		this._workerBlobUrl = URL.createObjectURL(blob);

		for (let i = 0; i < this._workerCount; i++) {
			const worker = new Worker(this._workerBlobUrl);
			worker.onmessage = (e) => this._handleMessage(e.data);
			worker.onerror = (e) => console.error("[TransformWorkerPool] Worker error:", e);
			this._workers.push(worker);
			this._pendingByWorker.set(i, []);
		}
	}

	/**
	 * Register a mesh with the pool. Positions are transferred to worker (zero-copy).
	 * @param meshId Unique mesh identifier
	 * @param positions Original vertex positions (will be transferred, becomes unusable)
	 * @param callback Called with transformed positions after flush()
	 */
	registerMesh(meshId: number, positions: Float32Array, callback: TransformCallback): void {
		if (this._disposed) return;

		// Round-robin worker assignment
		const workerIndex = this._nextWorkerIndex;
		this._nextWorkerIndex = (this._nextWorkerIndex + 1) % this._workerCount;

		this._meshRegistry.set(meshId, { workerIndex, callback });

		// Transfer positions to worker (original becomes detached)
		this._workers[workerIndex].postMessage(
			{ type: "REGISTER", meshId, positions },
			[positions.buffer]
		);
	}

	/**
	 * Queue a transform request. Call flush() to execute batched requests.
	 */
	queueTransform(meshId: number, matrix: Float32Array): void {
		if (this._disposed) return;

		const registration = this._meshRegistry.get(meshId);
		if (!registration) {
			console.warn(`[TransformWorkerPool] Mesh ${meshId} not registered`);
			return;
		}

		this._pendingByWorker.get(registration.workerIndex)!.push({
			meshId,
			matrix: new Float32Array(matrix) // Copy matrix (small, avoids issues if caller reuses)
		});
	}

	/**
	 * Send all queued transforms to workers and wait for completion.
	 * Invokes registered callbacks with results.
	 */
	async flush(): Promise<void> {
		if (this._disposed) return;

		// Count workers with pending work
		let workersWithWork = 0;
		for (let i = 0; i < this._workerCount; i++) {
			const pending = this._pendingByWorker.get(i)!;
			if (pending.length > 0) {
				workersWithWork++;
				this._workers[i].postMessage({
					type: "TRANSFORM_BATCH",
					requests: pending
				});
				this._pendingByWorker.set(i, []); // Clear pending
			}
		}

		// Nothing to flush
		if (workersWithWork === 0) return;

		// Wait for all workers to respond
		this._pendingResponses = workersWithWork;
		return new Promise((resolve) => {
			this._flushResolvers.push(resolve);
		});
	}

	private _handleMessage(msg: {
		type: string;
		meshIds?: Uint32Array;
		offsets?: Uint32Array;
		positions?: Float32Array;
	}): void {
		if (msg.type === "TRANSFORM_RESULTS" && msg.positions && msg.meshIds && msg.offsets) {
			const { meshIds, offsets, positions } = msg;

			// Unpack and invoke callbacks
			for (let i = 0; i < meshIds.length; i++) {
				const meshId = meshIds[i];
				const start = offsets[i];
				const end = offsets[i + 1];

				const registration = this._meshRegistry.get(meshId);
				if (registration) {
					// Create view into packed buffer (no copy)
					const meshPositions = positions.subarray(start, end);
					registration.callback(meshPositions);
				}
			}

			// Check if all pending responses received
			this._pendingResponses--;
			if (this._pendingResponses === 0) {
				// Resolve all waiting flush promises
				const resolvers = this._flushResolvers;
				this._flushResolvers = [];
				for (const resolve of resolvers) {
					resolve();
				}
			}
		}
	}

	/**
	 * Remove a mesh from the pool.
	 */
	unregisterMesh(meshId: number): void {
		const registration = this._meshRegistry.get(meshId);
		if (registration && !this._disposed) {
			this._workers[registration.workerIndex].postMessage({
				type: "UNREGISTER",
				meshId
			});
		}
		this._meshRegistry.delete(meshId);
	}

	/**
	 * Get number of registered meshes.
	 */
	get meshCount(): number {
		return this._meshRegistry.size;
	}

	/**
	 * Get number of workers in pool.
	 */
	get workerCount(): number {
		return this._workerCount;
	}

	/**
	 * Clean up all workers and resources.
	 */
	dispose(): void {
		if (this._disposed) return;
		this._disposed = true;

		for (const worker of this._workers) {
			worker.terminate();
		}
		this._workers = [];

		if (this._workerBlobUrl) {
			URL.revokeObjectURL(this._workerBlobUrl);
			this._workerBlobUrl = null;
		}

		this._meshRegistry.clear();
		this._pendingByWorker.clear();

		// Resolve any pending flushes
		for (const resolve of this._flushResolvers) {
			resolve();
		}
		this._flushResolvers = [];
	}
}

/**
 * Shared global worker pool with reference counting and per-frame batching.
 * Creates a single pool of ~8 workers shared across all models.
 * Automatically batches all transform requests per frame using requestAnimationFrame.
 */
class SharedWorkerPool {
	private static _instance: TransformWorkerPool | null = null;
	private static _refCount = 0;
	private static _flushScheduled = false;
	private static _frameId: number | null = null;

	/**
	 * Acquire reference to the shared pool. Creates pool on first call.
	 */
	static acquire(): TransformWorkerPool {
		if (!SharedWorkerPool._instance) {
			SharedWorkerPool._instance = new TransformWorkerPool();
			console.log(`[SharedWorkerPool] Created shared pool with ${SharedWorkerPool._instance.workerCount} workers`);
		}
		SharedWorkerPool._refCount++;
		console.log(`[SharedWorkerPool] Acquired (refCount: ${SharedWorkerPool._refCount})`);
		return SharedWorkerPool._instance;
	}

	/**
	 * Release reference to the shared pool. Disposes pool when last reference released.
	 */
	static release(): void {
		if (SharedWorkerPool._refCount <= 0) return;

		SharedWorkerPool._refCount--;
		console.log(`[SharedWorkerPool] Released (refCount: ${SharedWorkerPool._refCount})`);

		if (SharedWorkerPool._refCount === 0 && SharedWorkerPool._instance) {
			// Cancel any pending flush
			if (SharedWorkerPool._frameId !== null) {
				cancelAnimationFrame(SharedWorkerPool._frameId);
				SharedWorkerPool._frameId = null;
				SharedWorkerPool._flushScheduled = false;
			}
			console.log(`[SharedWorkerPool] Disposing shared pool (no more references)`);
			SharedWorkerPool._instance.dispose();
			SharedWorkerPool._instance = null;
		}
	}

	/**
	 * Schedule a flush for the end of the current frame.
	 * Multiple calls in the same frame are batched into a single flush.
	 * This ensures all models' transforms are sent together.
	 */
	static scheduleFlush(): void {
		if (!SharedWorkerPool._instance || SharedWorkerPool._flushScheduled) return;

		SharedWorkerPool._flushScheduled = true;
		SharedWorkerPool._frameId = requestAnimationFrame(() => {
			SharedWorkerPool._flushScheduled = false;
			SharedWorkerPool._frameId = null;
			if (SharedWorkerPool._instance) {
				SharedWorkerPool._instance.flush();
			}
		});
	}

	/**
	 * Get current reference count (for debugging).
	 */
	static get refCount(): number {
		return SharedWorkerPool._refCount;
	}

	/**
	 * Check if shared pool exists.
	 */
	static get hasInstance(): boolean {
		return SharedWorkerPool._instance !== null;
	}
}

export { SharedWorkerPool };
