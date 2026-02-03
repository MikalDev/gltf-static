import { mat4 } from "gl-matrix";

/**
 * Represents a node in the glTF scene graph.
 * Tracks parent-child relationships for transform inheritance.
 */
export class GltfNode {
	readonly name: string;
	parent: GltfNode | null = null;
	children: GltfNode[] = [];
	localMatrix: Float32Array;
	jointIndex: number = -1;  // -1 if not a joint

	private _worldMatrix: Float32Array;
	private _dirty: boolean = true;

	constructor(name: string, localMatrix: mat4 | Float32Array) {
		this.name = name;
		this.localMatrix = new Float32Array(localMatrix as Float32Array);
		this._worldMatrix = new Float32Array(16);
	}

	/** Get world matrix, computing if dirty */
	getWorldMatrix(): Float32Array {
		if (this._dirty) {
			if (this.parent) {
				mat4.multiply(
					this._worldMatrix as unknown as mat4,
					this.parent.getWorldMatrix() as unknown as mat4,
					this.localMatrix as unknown as mat4
				);
			} else {
				this._worldMatrix.set(this.localMatrix);
			}
			this._dirty = false;
		}
		return this._worldMatrix;
	}

	/** Mark this node and descendants as needing world matrix recomputation */
	invalidate(): void {
		this._dirty = true;
		for (const child of this.children) {
			child.invalidate();
		}
	}

	/** Update local matrix (e.g., from animation) and mark dirty */
	setLocalMatrix(matrix: Float32Array): void {
		this.localMatrix.set(matrix);
		this.invalidate();
	}

	/** Add a child node */
	addChild(child: GltfNode): void {
		child.parent = this;
		this.children.push(child);
	}

	/** Check if this node or any ancestor is a joint (animated) */
	hasAnimatedAncestor(): boolean {
		let node: GltfNode | null = this;
		while (node) {
			if (node.jointIndex >= 0) return true;
			node = node.parent;
		}
		return false;
	}
}
