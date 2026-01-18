/**
 * Represents a glTF node containing meshes.
 * Transform is baked into vertex positions at load time.
 */
export class GltfNode {
    constructor() {
        this._meshes = [];
    }
    /**
     * Add a mesh to this node.
     */
    addMesh(mesh) {
        this._meshes.push(mesh);
    }
    /**
     * Check if this node has any meshes.
     */
    hasMeshes() {
        return this._meshes.length > 0;
    }
    /**
     * Update all mesh transforms with the given matrix.
     */
    updateTransform(matrix) {
        for (const mesh of this._meshes) {
            mesh.updateTransform(matrix);
        }
    }
    /**
     * Draw all meshes in this node.
     */
    draw(renderer) {
        for (const mesh of this._meshes) {
            mesh.draw(renderer);
        }
    }
    /**
     * Release all meshes.
     */
    release() {
        for (const mesh of this._meshes) {
            mesh.release();
        }
        this._meshes = [];
    }
}
