import { GltfMesh } from "./GltfMesh.js";

/**
 * Represents a glTF node containing meshes.
 * Transform is baked into vertex positions at load time.
 */
export class GltfNode {
	private _meshes: GltfMesh[] = [];

	/**
	 * Add a mesh to this node.
	 */
	addMesh(mesh: GltfMesh): void {
		this._meshes.push(mesh);
	}

	/**
	 * Check if this node has any meshes.
	 */
	hasMeshes(): boolean {
		return this._meshes.length > 0;
	}

	/**
	 * Update all mesh transforms with the given matrix.
	 */
	updateTransform(matrix: Float32Array): void {
		for (const mesh of this._meshes) {
			mesh.updateTransform(matrix);
		}
	}

	/**
	 * Draw all meshes in this node.
	 */
	draw(renderer: IRenderer): void {
		for (const mesh of this._meshes) {
			mesh.draw(renderer);
		}
	}

	/**
	 * Release all meshes.
	 */
	release(): void {
		for (const mesh of this._meshes) {
			mesh.release();
		}
		this._meshes = [];
	}
}
