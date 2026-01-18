import { vec3, mat4 } from "gl-matrix";

/**
 * Represents a single mesh primitive with GPU-uploaded data.
 * Does NOT own texture - just holds reference (Model owns textures).
 */
export class GltfMesh {
	private _meshData: IMeshData | null = null;
	private _texture: ITexture | null = null;

	// Store original positions for runtime transform updates
	private _originalPositions: Float32Array | null = null;
	private _vertexCount: number = 0;

	// Reusable temp vector (avoid allocations in hot path)
	private static _tempVec: vec3 = vec3.create();

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

		// Store original positions for transform updates
		this._originalPositions = new Float32Array(positions);

		this._meshData = renderer.createMeshData(this._vertexCount, indexCount);

		// Upload positions (x, y, z per vertex)
		this._meshData.positions.set(positions);
		this._meshData.markDataChanged("positions", 0, this._vertexCount);

		// Upload UVs (u, v per vertex) - default to 0,0 if not present
		if (texCoords) {
			this._meshData.texCoords.set(texCoords);
		} else {
			// Initialize UVs to 0,0 to avoid garbage values
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
	 * Update vertex positions by applying a transform matrix to original positions.
	 * Uses gl-matrix for efficient transformation.
	 */
	updateTransform(matrix: Float32Array): void {
		if (!this._meshData || !this._originalPositions) return;

		const positions = this._meshData.positions;
		const original = this._originalPositions;
		const tempVec = GltfMesh._tempVec;

		for (let i = 0; i < this._vertexCount; i++) {
			const idx = i * 3;
			vec3.set(tempVec, original[idx], original[idx + 1], original[idx + 2]);
			vec3.transformMat4(tempVec, tempVec, matrix as unknown as mat4);
			positions[idx] = tempVec[0];
			positions[idx + 1] = tempVec[1];
			positions[idx + 2] = tempVec[2];
		}

		this._meshData.markDataChanged("positions", 0, this._vertexCount);
	}

	/**
	 * Draw this mesh with its texture.
	 */
	draw(renderer: IRenderer): void {
		if (!this._meshData) return;

		// Enable backface culling for better performance on closed meshes
		const prevCullMode = renderer.getCullFaceMode();
		renderer.setCullFaceMode("back");

		if (this._texture) {
			// Textured rendering
			renderer.setTextureFillMode();
			renderer.setTexture(this._texture);
		} else {
			// Solid color rendering when no texture
			renderer.setColorFillMode();
		}

		renderer.resetColor();
		renderer.drawMeshData(this._meshData);

		// Restore previous cull mode
		renderer.setCullFaceMode(prevCullMode);
	}

	/**
	 * Release GPU resources.
	 */
	release(): void {
		if (this._meshData) {
			this._meshData.release();
			this._meshData = null;
		}
		this._texture = null; // Don't delete - Model owns textures
		this._originalPositions = null;
		this._vertexCount = 0;
	}
}
