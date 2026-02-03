import { vec3, mat4, mat3 } from "gl-matrix";
import type { TransformWorkerPool } from "./TransformWorkerPool.js";
import type { MeshSkinningData, CachedSkinData } from "./types.js";
import type { GltfNode } from "./GltfNode.js";
import { calculateMeshLighting, getVersion as getLightingVersion } from "./Lighting.js";

const LOG_PREFIX = "[GltfMesh]";

function debugLog(...args: unknown[]): void {
	if (globalThis.gltfDebug) console.log(LOG_PREFIX, ...args);
}

/**
 * Represents a single mesh primitive with GPU-uploaded data.
 * Does NOT own texture - just holds reference (Model owns textures).
 *
 * Supports both sync transforms (fallback) and worker-based async transforms.
 * For skinned meshes, holds reference to shared skinning data from cache.
 */
export class GltfMesh {
	private _meshData: IMeshData | null = null;
	private _texture: ITexture | null = null;

	// Store original positions for runtime transform updates (sync fallback)
	// For skinned meshes, these are the bind pose positions
	private _originalPositions: Float32Array | null = null;
	private _originalNormals: Float32Array | null = null;
	private _transformedNormals: Float32Array | null = null;
	private _vertexCount: number = 0;
	private _hasNormals: boolean = false;

	// Matrix dirty tracking to avoid redundant GPU uploads
	private _lastMatrix: Float32Array | null = null;

	// Lighting dirty tracking
	private _lastLightingVersion: number = -1;
	private _lastRotationMatrix: Float32Array | null = null;
	private _lastCameraPosition: Float32Array | null = null;

	// Worker pool integration
	private _workerPool: TransformWorkerPool | null = null;
	private _isRegisteredWithPool = false;
	private _isRegisteredSkinnedWithPool = false;
	private _isRegisteredStaticLightingWithPool = false;

	// Skinning data (reference to shared cached data, NOT owned)
	private _skinningData: MeshSkinningData | null = null;
	private _skinData: CachedSkinData | null = null;

	// Debug: track mesh ID for logging
	private static _nextId: number = 0;
	private _id: number;

	// Node name from glTF (for identification)
	private _name: string = "";

	// Visibility flag (controls rendering, not processing)
	private _visible: boolean = true;

	// Parent node in scene graph (for transform inheritance)
	private _parentNode: GltfNode | null = null;

	constructor() {
		this._id = GltfMesh._nextId++;
	}

	/** Get unique mesh ID */
	get id(): number {
		return this._id;
	}

	/** Get node name from glTF */
	get name(): string {
		return this._name;
	}

	/** Set node name */
	set name(value: string) {
		this._name = value;
	}

	/** Whether this mesh is visible (rendered) */
	get visible(): boolean {
		return this._visible;
	}

	/** Set visibility (controls rendering, not processing) */
	set visible(value: boolean) {
		this._visible = value;
	}

	/** Get parent node in scene graph */
	get parentNode(): GltfNode | null {
		return this._parentNode;
	}

	/** Set parent node in scene graph */
	set parentNode(node: GltfNode | null) {
		this._parentNode = node;
	}

	/** Get vertex count */
	get vertexCount(): number {
		return this._vertexCount;
	}

	/** Get original (baked) positions for bounding box computation */
	get originalPositions(): Float32Array | null {
		return this._originalPositions;
	}

	/** Get original normals */
	get originalNormals(): Float32Array | null {
		return this._originalNormals;
	}

	/** Get transformed normals (after skinning/transform) */
	get transformedNormals(): Float32Array | null {
		return this._transformedNormals;
	}

	/** Whether this mesh has normals */
	get hasNormals(): boolean {
		return this._hasNormals;
	}

	/** Whether this mesh has skinning data */
	get isSkinned(): boolean {
		return this._skinningData !== null && this._skinData !== null;
	}

	/** Get per-vertex skinning attributes (joints/weights) */
	get skinningData(): MeshSkinningData | null {
		return this._skinningData;
	}

	/** Get the skin (skeleton) data for this mesh */
	get skinData(): CachedSkinData | null {
		return this._skinData;
	}

	/**
	 * Set skinning data for this mesh.
	 * References are to shared cached data - not owned by this mesh.
	 */
	setSkinningData(skinningData: MeshSkinningData | null, skinData: CachedSkinData | null): void {
		this._skinningData = skinningData;
		this._skinData = skinData;
	}

	/**
	 * Create GPU buffers and upload mesh data.
	 * Positions are stored for later transform updates.
	 * @param normals Optional vertex normals for lighting
	 */
	create(
		renderer: IRenderer,
		positions: Float32Array,
		texCoords: Float32Array | null,
		indices: Uint16Array | Uint32Array,
		texture: ITexture | null,
		normals?: Float32Array | null
	): void {
		this._vertexCount = positions.length / 3;
		const indexCount = indices.length;
		const expectedTexCoordLength = this._vertexCount * 2;

		debugLog(`Mesh #${this._id}: Creating (${this._vertexCount} verts, texture: ${texture ? "yes" : "no"}, normals: ${normals ? "yes" : "no"})`);

		// Store original positions for sync transform fallback
		this._originalPositions = new Float32Array(positions);

		// Store normals if provided with correct length
		if (normals && normals.length === positions.length) {
			this._originalNormals = new Float32Array(normals);
			this._transformedNormals = new Float32Array(normals.length);
			this._transformedNormals.set(normals);
			this._hasNormals = true;
		} else {
			// Compute normals from triangle faces if not provided or wrong length
			if (normals && normals.length !== positions.length) {
				console.warn(`${LOG_PREFIX} Mesh #${this._id}: normals length mismatch, computing normals`);
			}
			this._originalNormals = this._computeNormals(positions, indices);
			if (this._originalNormals) {
				this._transformedNormals = new Float32Array(this._originalNormals.length);
				this._transformedNormals.set(this._originalNormals);
				this._hasNormals = true;
			}
		}

		this._meshData = renderer.createMeshData(this._vertexCount, indexCount);

		// Upload positions (x, y, z per vertex)
		this._meshData.positions.set(positions);
		this._meshData.markDataChanged("positions", 0, this._vertexCount);

		// Upload UVs (u, v per vertex) - default to 0,0 if not present
		if (texCoords) {
			if (texCoords.length !== this._meshData.texCoords.length) {
				console.warn(`${LOG_PREFIX} Mesh #${this._id}: texCoords length mismatch`);
			}
			this._meshData.texCoords.set(texCoords);
		} else {
			this._meshData.texCoords.fill(0);
		}
		this._meshData.markDataChanged("texCoords", 0, this._vertexCount);

		// Upload indices
		this._meshData.indices.set(indices);
		this._meshData.markIndexDataChanged();

		// Fill vertex colors with white (unlit rendering)
		this._meshData.fillColor(1, 1, 1, 1);
		this._meshData.markDataChanged("colors", 0, this._vertexCount);

		this._texture = texture;
	}

	/**
	 * Compute vertex normals from triangle faces.
	 * Uses area-weighted averaging of face normals.
	 */
	private _computeNormals(positions: Float32Array, indices: Uint16Array | Uint32Array): Float32Array | null {
		const vertexCount = positions.length / 3;
		const normals = new Float32Array(positions.length);
		normals.fill(0);

		// Accumulate face normals at each vertex
		for (let i = 0; i < indices.length; i += 3) {
			const i0 = indices[i];
			const i1 = indices[i + 1];
			const i2 = indices[i + 2];

			// Get triangle vertices
			const p0x = positions[i0 * 3], p0y = positions[i0 * 3 + 1], p0z = positions[i0 * 3 + 2];
			const p1x = positions[i1 * 3], p1y = positions[i1 * 3 + 1], p1z = positions[i1 * 3 + 2];
			const p2x = positions[i2 * 3], p2y = positions[i2 * 3 + 1], p2z = positions[i2 * 3 + 2];

			// Edge vectors
			const e1x = p1x - p0x, e1y = p1y - p0y, e1z = p1z - p0z;
			const e2x = p2x - p0x, e2y = p2y - p0y, e2z = p2z - p0z;

			// Cross product (unnormalized - magnitude is proportional to area)
			const nx = e1y * e2z - e1z * e2y;
			const ny = e1z * e2x - e1x * e2z;
			const nz = e1x * e2y - e1y * e2x;

			// Add to all three vertices
			normals[i0 * 3] += nx; normals[i0 * 3 + 1] += ny; normals[i0 * 3 + 2] += nz;
			normals[i1 * 3] += nx; normals[i1 * 3 + 1] += ny; normals[i1 * 3 + 2] += nz;
			normals[i2 * 3] += nx; normals[i2 * 3 + 1] += ny; normals[i2 * 3 + 2] += nz;
		}

		// Normalize all normals
		for (let i = 0; i < vertexCount; i++) {
			const offset = i * 3;
			const nx = normals[offset], ny = normals[offset + 1], nz = normals[offset + 2];
			const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
			if (len > 0.0001) {
				normals[offset] = nx / len;
				normals[offset + 1] = ny / len;
				normals[offset + 2] = nz / len;
			} else {
				// Default to up if degenerate
				normals[offset] = 0;
				normals[offset + 1] = 1;
				normals[offset + 2] = 0;
			}
		}

		return normals;
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
	}

	/**
	 * Register this skinned mesh with a worker pool for async CPU skinning.
	 * Call after create() and setSkinningData(). Transfers positions, normals, joints, weights to worker.
	 */
	registerSkinnedWithPool(pool: TransformWorkerPool): void {
		if (this._isRegisteredSkinnedWithPool) return;
		if (!this._originalPositions || !this._skinningData) return;

		this._workerPool = pool;

		// Transfer copies to the worker (original stays for sync fallback)
		const positionsCopy = new Float32Array(this._originalPositions);
		const normalsCopy = this._originalNormals ? new Float32Array(this._originalNormals) : null;
		const jointsCopy = this._skinningData.joints instanceof Uint16Array
			? new Uint16Array(this._skinningData.joints)
			: new Uint8Array(this._skinningData.joints);
		const weightsCopy = new Float32Array(this._skinningData.weights);

		pool.registerSkinnedMesh(this._id, positionsCopy, normalsCopy, jointsCopy, weightsCopy, (skinnedPositions, skinnedNormals, skinnedColors) => {
			this._applyPositions(skinnedPositions);
			if (skinnedNormals) {
				this._applyNormals(skinnedNormals);
			}
			if (skinnedColors) {
				this._applyColors(skinnedColors);
			}
		});

		this._isRegisteredSkinnedWithPool = true;
	}

	/**
	 * Register this static mesh with a worker pool for async lighting calculations.
	 * Only for non-skinned meshes without animated ancestors. Call after create().
	 */
	registerStaticLightingWithPool(pool: TransformWorkerPool): void {
		if (this._isRegisteredStaticLightingWithPool) return;
		if (!this._originalNormals || !this._hasNormals) return;
		if (this.isSkinned) return; // Skinned meshes use queueSkinning with lightConfig

		// Don't use worker lighting for meshes with animated ancestors
		// Their positions change each frame, but worker has cached positions
		if (this._parentNode?.hasAnimatedAncestor()) return;

		this._workerPool = pool;

		// Transfer a copy of positions and normals to the worker
		// Positions are needed for spotlight calculations
		const positionsCopy = this._originalPositions ? new Float32Array(this._originalPositions) : null;
		const normalsCopy = new Float32Array(this._originalNormals);
		pool.registerStaticMeshForLighting(this._id, positionsCopy, normalsCopy, (colors) => {
			this._applyColors(colors);
		});

		this._isRegisteredStaticLightingWithPool = true;
	}

	/**
	 * Check if this mesh is registered for worker skinning.
	 */
	get isRegisteredSkinnedWithPool(): boolean {
		return this._isRegisteredSkinnedWithPool;
	}

	/**
	 * Check if this mesh is registered for worker static lighting.
	 */
	get isRegisteredStaticLightingWithPool(): boolean {
		return this._isRegisteredStaticLightingWithPool;
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
	}

	/**
	 * Apply transformed normals received from worker and invalidate lighting.
	 */
	private _applyNormals(normals: Float32Array): void {
		if (!this._transformedNormals || !this._hasNormals) return;
		this._transformedNormals.set(normals);
		this.invalidateLighting();
	}

	/**
	 * Apply vertex colors received from worker.
	 */
	private _applyColors(colors: Float32Array): void {
		if (!this._meshData) return;
		this._meshData.colors.set(colors);
		this._meshData.markDataChanged("colors", 0, this._vertexCount);
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
	}

	/**
	 * Legacy alias for updateTransformSync.
	 * @deprecated Use updateTransformSync or queueTransform + pool.flush()
	 */
	updateTransform(matrix: Float32Array): void {
		this.updateTransformSync(matrix);
	}

	/**
	 * Update positions based on parent node's world matrix only.
	 * Used for static meshes under animated joints.
	 * GPU will apply ModelView (instance TRS) during draw.
	 */
	updateNodeTransform(): void {
		if (!this._parentNode || !this._meshData || !this._originalPositions || this.isSkinned) return;

		const nodeWorld = this._parentNode.getWorldMatrix();

		// Skip if matrix hasn't changed
		if (!this._isMatrixDirty(nodeWorld)) return;

		// Store copy of matrix for dirty checking
		if (!this._lastMatrix) {
			this._lastMatrix = new Float32Array(16);
		}
		this._lastMatrix.set(nodeWorld);

		const positions = this._meshData.positions;
		const original = this._originalPositions;
		const n = this._vertexCount;

		// Pre-extract matrix elements
		const m0 = nodeWorld[0], m1 = nodeWorld[1], m2 = nodeWorld[2];
		const m4 = nodeWorld[4], m5 = nodeWorld[5], m6 = nodeWorld[6];
		const m8 = nodeWorld[8], m9 = nodeWorld[9], m10 = nodeWorld[10];
		const m12 = nodeWorld[12], m13 = nodeWorld[13], m14 = nodeWorld[14];

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

		// Also transform normals for correct lighting
		if (this._originalNormals && this._transformedNormals) {
			// Extract upper-left 3x3 for normal transformation
			for (let i = 0; i < n; i++) {
				const idx = i * 3;
				const nx = this._originalNormals[idx];
				const ny = this._originalNormals[idx + 1];
				const nz = this._originalNormals[idx + 2];

				let tnx = m0 * nx + m4 * ny + m8 * nz;
				let tny = m1 * nx + m5 * ny + m9 * nz;
				let tnz = m2 * nx + m6 * ny + m10 * nz;

				// Renormalize
				const len = Math.sqrt(tnx * tnx + tny * tny + tnz * tnz);
				if (len > 0.0001) {
					tnx /= len;
					tny /= len;
					tnz /= len;
				}

				this._transformedNormals[idx] = tnx;
				this._transformedNormals[idx + 1] = tny;
				this._transformedNormals[idx + 2] = tnz;
			}
		}
	}

	/**
	 * Update GPU positions from skinned vertex data.
	 * Used by AnimationController to push skinned positions to GPU.
	 * @param positions Skinned vertex positions (Float32Array, 3 floats per vertex)
	 */
	updateSkinnedPositions(positions: Float32Array): void {
		if (!this._meshData) return;

		// Verify length matches
		if (positions.length !== this._vertexCount * 3) {
			console.warn(`${LOG_PREFIX} Mesh #${this._id}: Position array length mismatch (expected ${this._vertexCount * 3}, got ${positions.length})`);
			return;
		}

		this._meshData.positions.set(positions);
		this._meshData.markDataChanged("positions", 0, this._vertexCount);

		// Clear last matrix since we're using raw positions now
		this._lastMatrix = null;
	}

	/**
	 * Update transformed normals from skinned normal data.
	 * @param normals Skinned vertex normals (Float32Array, 3 floats per vertex)
	 */
	updateSkinnedNormals(normals: Float32Array): void {
		if (!this._transformedNormals || !this._hasNormals) return;

		if (normals.length !== this._vertexCount * 3) {
			console.warn(`${LOG_PREFIX} Mesh #${this._id}: Normal array length mismatch`);
			return;
		}

		this._transformedNormals.set(normals);
	}

	/**
	 * Transform normals by a matrix (upper-left 3x3 only, for rotations).
	 * Used for non-skinned meshes when the model matrix changes.
	 * @param matrix The 4x4 model matrix
	 */
	transformNormals(matrix: Float32Array): void {
		if (!this._originalNormals || !this._transformedNormals) return;

		const n = this._vertexCount;

		// Extract upper-left 3x3 (rotation/scale part)
		// For proper normal transformation, we should use inverse transpose
		// but for uniform scale, upper 3x3 is sufficient
		const m0 = matrix[0], m1 = matrix[1], m2 = matrix[2];
		const m4 = matrix[4], m5 = matrix[5], m6 = matrix[6];
		const m8 = matrix[8], m9 = matrix[9], m10 = matrix[10];

		for (let i = 0; i < n; i++) {
			const idx = i * 3;
			const nx = this._originalNormals[idx];
			const ny = this._originalNormals[idx + 1];
			const nz = this._originalNormals[idx + 2];

			// Transform normal
			let tnx = m0 * nx + m4 * ny + m8 * nz;
			let tny = m1 * nx + m5 * ny + m9 * nz;
			let tnz = m2 * nx + m6 * ny + m10 * nz;

			// Renormalize (in case of non-uniform scale)
			const len = Math.sqrt(tnx * tnx + tny * tny + tnz * tnz);
			if (len > 0.0001) {
				tnx /= len;
				tny /= len;
				tnz /= len;
			}

			this._transformedNormals[idx] = tnx;
			this._transformedNormals[idx + 1] = tny;
			this._transformedNormals[idx + 2] = tnz;
		}
	}

	/**
	 * Apply vertex lighting based on transformed normals.
	 * Updates vertex colors in the mesh data.
	 * Skips recalculation if lighting hasn't changed (dirty tracking).
	 *
	 * @param modelMatrix Optional model matrix (4x4 mat4) to transform normals to world space
	 * @param force If true, recalculate even if lighting version unchanged
	 * @param cameraPosition Optional camera position for specular calculations
	 */
	applyLighting(modelMatrix?: Float32Array | null, force: boolean = false, cameraPosition?: Float32Array | null): void {
		if (!this._meshData || !this._hasNormals || !this._transformedNormals) return;

		const currentVersion = getLightingVersion();
		const rotationChanged = this._hasRotationChanged(modelMatrix);
		const cameraChanged = this._hasCameraPositionChanged(cameraPosition);
		const hasAnimatedAncestor = this._parentNode?.hasAnimatedAncestor() ?? false;

		if (!force && this._lastLightingVersion === currentVersion && !rotationChanged && !cameraChanged) {
			return; // Nothing changed, skip
		}
		this._lastLightingVersion = currentVersion;
		this._updateLastRotation(modelMatrix);
		this._updateLastCameraPosition(cameraPosition);

		// For meshes with animated ancestors: use GPU positions (transformed by updateNodeTransform)
		// For other meshes: use _originalPositions (already baked with node world transform)
		const positions = hasAnimatedAncestor
			? new Float32Array(this._meshData.positions)
			: this._originalPositions;

		calculateMeshLighting(
			positions,
			this._transformedNormals,
			this._meshData.colors,
			this._vertexCount,
			modelMatrix,
			cameraPosition
		);

		this._meshData.markDataChanged("colors", 0, this._vertexCount);
	}

	/**
	 * Check if model matrix changed from last applied.
	 * Compares rotation/scale (upper-left 3x3) and translation (for spotlight calculations).
	 */
	private _hasRotationChanged(modelMatrix?: Float32Array | null): boolean {
		if (!modelMatrix && !this._lastRotationMatrix) return false;
		if (!modelMatrix || !this._lastRotationMatrix) return true;

		// Compare rotation/scale elements (upper-left 3x3) and translation (for spotlights)
		const indices = [0, 1, 2, 4, 5, 6, 8, 9, 10, 12, 13, 14];
		for (const i of indices) {
			if (Math.abs(this._lastRotationMatrix[i] - modelMatrix[i]) > 0.0001) return true;
		}
		return false;
	}

	/**
	 * Store copy of rotation matrix for dirty checking.
	 */
	private _updateLastRotation(modelRotation?: Float32Array | null): void {
		if (!modelRotation) {
			this._lastRotationMatrix = null;
			return;
		}
		if (!this._lastRotationMatrix) {
			this._lastRotationMatrix = new Float32Array(16);
		}
		this._lastRotationMatrix.set(modelRotation);
	}

	/**
	 * Check if camera position changed (for specular recalculation).
	 */
	private _hasCameraPositionChanged(cameraPosition?: Float32Array | null): boolean {
		const last = this._lastCameraPosition;
		if (!cameraPosition && !last) return false;
		if (!cameraPosition || !last) return true;
		for (let i = 0; i < 3; i++) {
			if (Math.abs(last[i] - cameraPosition[i]) > 0.0001) return true;
		}
		return false;
	}

	/**
	 * Store copy of camera position for dirty checking.
	 */
	private _updateLastCameraPosition(cameraPosition?: Float32Array | null): void {
		if (!cameraPosition) {
			this._lastCameraPosition = null;
			return;
		}
		if (!this._lastCameraPosition) {
			this._lastCameraPosition = new Float32Array(3);
		}
		this._lastCameraPosition.set(cameraPosition);
	}

	/**
	 * Mark lighting as dirty so it recalculates next frame.
	 * Call when mesh normals change (e.g., after skinning).
	 */
	invalidateLighting(): void {
		this._lastLightingVersion = -1;
		this._lastRotationMatrix = null;
		this._lastCameraPosition = null;
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
		// Skip render if not visible (preserves texture state tracking)
		if (!this._visible) {
			return lastTexture === undefined ? null : lastTexture;
		}

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
		// Unregister from worker pool if registered
		if (this._workerPool && (this._isRegisteredWithPool || this._isRegisteredSkinnedWithPool || this._isRegisteredStaticLightingWithPool)) {
			this._workerPool.unregisterMesh(this._id);
			this._isRegisteredWithPool = false;
			this._isRegisteredSkinnedWithPool = false;
			this._isRegisteredStaticLightingWithPool = false;
		}
		this._workerPool = null;

		if (this._meshData) {
			this._meshData.release();
			this._meshData = null;
		}
		this._texture = null; // Don't delete - Model owns textures
		this._originalPositions = null;
		this._originalNormals = null;
		this._transformedNormals = null;
		this._hasNormals = false;
		this._lastMatrix = null;
		this._lastLightingVersion = -1;
		this._lastRotationMatrix = null;
		this._lastCameraPosition = null;
		this._vertexCount = 0;

		// Clear skinning references (not owned, just references to cached data)
		this._skinningData = null;
		this._skinData = null;
	}
}
