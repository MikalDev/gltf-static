import { vec3, mat4 } from "gl-matrix";
import type { TransformWorkerPool } from "./TransformWorkerPool.js";

// Debug logging - set to false to disable
const DEBUG = false;
const LOG_PREFIX = "[GltfMesh]";

function debugLog(...args: unknown[]): void {
	if (DEBUG) console.log(LOG_PREFIX, ...args);
}

/**
 * Represents a single mesh primitive with GPU-uploaded data.
 * Does NOT own texture - just holds reference (Model owns textures).
 *
 * Supports both sync transforms (fallback) and worker-based async transforms.
 */
export class GltfMesh {
	private _meshData: IMeshData | null = null;
	private _texture: ITexture | null = null;

	// Store original positions for runtime transform updates (sync fallback)
	private _originalPositions: Float32Array | null = null;
	private _vertexCount: number = 0;

	// Matrix dirty tracking to avoid redundant GPU uploads
	private _lastMatrix: Float32Array | null = null;

	// Worker pool integration
	private _workerPool: TransformWorkerPool | null = null;
	private _isRegisteredWithPool = false;

	// Debug: track mesh ID for logging
	private static _nextId: number = 0;
	private _id: number;

	constructor() {
		this._id = GltfMesh._nextId++;
	}

	/** Get unique mesh ID */
	get id(): number {
		return this._id;
	}

	/** Get vertex count */
	get vertexCount(): number {
		return this._vertexCount;
	}

	/** Get original (baked) positions for bounding box computation */
	get originalPositions(): Float32Array | null {
		return this._originalPositions;
	}

	/**
	 * Create GPU buffers and upload mesh data.
	 * Positions are stored for later transform updates.
	 */
	create(
		renderer: IRenderer,
		positions: Float32Array,
		texCoords: Float32Array | null,
		indices: Uint16Array | Uint32Array,
		texture: ITexture | null
	): void {
		this._vertexCount = positions.length / 3;
		const indexCount = indices.length;
		const expectedTexCoordLength = this._vertexCount * 2;

		debugLog(`Mesh #${this._id}: Creating GPU buffers (${this._vertexCount} verts, ${indexCount} indices, texture: ${texture ? "yes" : "no"})`);
		debugLog(`Mesh #${this._id}: positions.length=${positions.length}, texCoords.length=${texCoords?.length}, expected texCoords=${expectedTexCoordLength}`);

		// Store original positions for sync transform fallback
		this._originalPositions = new Float32Array(positions);

		this._meshData = renderer.createMeshData(this._vertexCount, indexCount);

		// Upload positions (x, y, z per vertex)
		this._meshData.positions.set(positions);
		this._meshData.markDataChanged("positions", 0, this._vertexCount);
		debugLog(`Mesh #${this._id}: markDataChanged("positions") - initial upload`);

		// Upload UVs (u, v per vertex) - default to 0,0 if not present
		if (texCoords) {
			debugLog(`Mesh #${this._id}: meshData.texCoords.length=${this._meshData.texCoords.length}`);
			// Verify lengths match
			if (texCoords.length !== this._meshData.texCoords.length) {
				debugLog(`Mesh #${this._id}: WARNING - texCoords length mismatch! source=${texCoords.length}, target=${this._meshData.texCoords.length}`);
			}
			this._meshData.texCoords.set(texCoords);
		} else {
			// Initialize UVs to 0,0 to avoid garbage values
			this._meshData.texCoords.fill(0);
		}
		this._meshData.markDataChanged("texCoords", 0, this._vertexCount);
		debugLog(`Mesh #${this._id}: markDataChanged("texCoords") - initial upload`);

		// Upload indices
		this._meshData.indices.set(indices);
		this._meshData.markIndexDataChanged();
		debugLog(`Mesh #${this._id}: markIndexDataChanged() - initial upload`);

		// Fill vertex colors with white (unlit rendering)
		this._meshData.fillColor(1, 1, 1, 1);
		this._meshData.markDataChanged("colors", 0, this._vertexCount);
		debugLog(`Mesh #${this._id}: markDataChanged("colors") - initial upload`);

		this._texture = texture;
	}

	/**
	 * Register this mesh with a worker pool for async transforms.
	 * Call after create(). Transfers a copy of positions to the worker.
	 */
	registerWithPool(pool: TransformWorkerPool): void {
		if (this._isRegisteredWithPool || !this._originalPositions) return;

		this._workerPool = pool;

		// Transfer a copy to the worker (keep original for sync fallback)
		const positionsCopy = new Float32Array(this._originalPositions);
		pool.registerMesh(this._id, positionsCopy, (transformedPositions) => {
			this._applyPositions(transformedPositions);
		});

		this._isRegisteredWithPool = true;
		debugLog(`Mesh #${this._id}: Registered with worker pool`);
	}

	/**
	 * Queue transform to worker pool. Must call pool.flush() to execute.
	 */
	queueTransform(matrix: Float32Array): void {
		if (!this._workerPool || !this._isRegisteredWithPool) return;
		this._workerPool.queueTransform(this._id, matrix);
	}

	/**
	 * Apply transformed positions received from worker.
	 */
	private _applyPositions(positions: Float32Array): void {
		if (!this._meshData) return;
		this._meshData.positions.set(positions);
		this._meshData.markDataChanged("positions", 0, this._vertexCount);
		// debugLog(`Mesh #${this._id}: markDataChanged("positions") - worker transform`);
	}

	/**
	 * Check if matrix has changed from last applied matrix.
	 */
	private _isMatrixDirty(matrix: Float32Array): boolean {
		if (!this._lastMatrix) return true;
		for (let i = 0; i < 16; i++) {
			if (this._lastMatrix[i] !== matrix[i]) return true;
		}
		return false;
	}

	/**
	 * Update vertex positions synchronously.
	 * Skips transform if matrix hasn't changed (avoids redundant GPU uploads).
	 * Uses inline matrix math for performance.
	 */
	updateTransformSync(matrix: Float32Array): void {
		if (!this._meshData || !this._originalPositions) return;

		// Skip if matrix hasn't changed
		if (!this._isMatrixDirty(matrix)) return;

		// Store copy of matrix for dirty checking
		if (!this._lastMatrix) {
			this._lastMatrix = new Float32Array(16);
		}
		this._lastMatrix.set(matrix);

		const positions = this._meshData.positions;
		const original = this._originalPositions;
		const n = this._vertexCount;

		// Pre-extract matrix elements (avoids repeated array access)
		const m0 = matrix[0], m1 = matrix[1], m2 = matrix[2];
		const m4 = matrix[4], m5 = matrix[5], m6 = matrix[6];
		const m8 = matrix[8], m9 = matrix[9], m10 = matrix[10];
		const m12 = matrix[12], m13 = matrix[13], m14 = matrix[14];

		for (let i = 0; i < n; i++) {
			const idx = i * 3;
			const x = original[idx];
			const y = original[idx + 1];
			const z = original[idx + 2];

			positions[idx] = m0 * x + m4 * y + m8 * z + m12;
			positions[idx + 1] = m1 * x + m5 * y + m9 * z + m13;
			positions[idx + 2] = m2 * x + m6 * y + m10 * z + m14;
		}

		this._meshData.markDataChanged("positions", 0, n);
		// debugLog(`Mesh #${this._id}: markDataChanged("positions") - sync transform`);
	}

	/**
	 * Legacy alias for updateTransformSync.
	 * @deprecated Use updateTransformSync or queueTransform + pool.flush()
	 */
	updateTransform(matrix: Float32Array): void {
		this.updateTransformSync(matrix);
	}

	/** Get texture reference for debugging */
	get texture(): ITexture | null {
		return this._texture;
	}

	/**
	 * Draw this mesh with its texture.
	 * Note: Cull mode is set at model level for performance.
	 * @param renderer The C3 renderer
	 * @param lastTexture The last texture that was bound (undefined = first draw, null = no texture)
	 * @returns The texture used by this mesh (for tracking)
	 */
	draw(renderer: IRenderer, lastTexture: ITexture | null | undefined = undefined): ITexture | null {
		if (!this._meshData) return lastTexture === undefined ? null : lastTexture;

		// Only change texture/fill mode if different from last (undefined means first draw)
		if (lastTexture === undefined || this._texture !== lastTexture) {
			if (this._texture) {
				renderer.setTextureFillMode();
				renderer.setTexture(this._texture);
			} else {
				renderer.setColorFillMode();
			}
		}

		renderer.drawMeshData(this._meshData);
		return this._texture;
	}

	/**
	 * Release GPU resources and unregister from worker pool.
	 */
	release(): void {
		debugLog(`Mesh #${this._id}: Releasing GPU resources`);

		// Unregister from worker pool if registered
		if (this._workerPool && this._isRegisteredWithPool) {
			this._workerPool.unregisterMesh(this._id);
			this._isRegisteredWithPool = false;
		}
		this._workerPool = null;

		if (this._meshData) {
			this._meshData.release();
			this._meshData = null;
		}
		this._texture = null; // Don't delete - Model owns textures
		this._originalPositions = null;
		this._lastMatrix = null;
		this._vertexCount = 0;
	}
}
