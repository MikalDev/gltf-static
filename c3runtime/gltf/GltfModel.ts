import { WebIO, Node as GltfNodeDef, Texture, Primitive, Root } from "@gltf-transform/core";
import { mat4, quat, vec3 } from "gl-matrix";
import { GltfMesh } from "./GltfMesh.js";
import { GltfNode } from "./GltfNode.js";

// glTF primitive modes
const GLTF_TRIANGLES = 4;

/**
 * Loads and manages a complete glTF model.
 * Owns all textures and nodes (responsible for cleanup).
 */
export class GltfModel {
	private _textures: ITexture[] = [];
	private _nodes: GltfNode[] = [];
	private _isLoaded: boolean = false;

	get isLoaded(): boolean {
		return this._isLoaded;
	}

	/**
	 * Load model from URL.
	 */
	async load(renderer: IRenderer, url: string): Promise<void> {
		// Track resources for cleanup on error
		const loadedTextures: ITexture[] = [];
		const loadedNodes: GltfNode[] = [];

		try {
			const io = new WebIO();
			const document = await io.read(url);
			const root = document.getRoot();

			// 1. Load all textures first
			const textureMap = await this._loadTextures(renderer, root, loadedTextures);

			// 2. Process nodes with meshes
			const identityMatrix = mat4.create();
			for (const scene of root.listScenes()) {
				for (const node of scene.listChildren()) {
					this._processNode(renderer, node, textureMap, identityMatrix, loadedNodes);
				}
			}

			// Success - store resources
			this._textures = loadedTextures;
			this._nodes = loadedNodes;
			this._isLoaded = true;
		} catch (err) {
			// Cleanup any partially loaded resources
			for (const node of loadedNodes) {
				node.release();
			}
			for (const texture of loadedTextures) {
				renderer.deleteTexture(texture);
			}
			throw err; // Re-throw so caller can handle
		}
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

		for (const texture of root.listTextures()) {
			const imageData = texture.getImage();
			if (imageData) {
				const mimeType = texture.getMimeType() || "image/png";
				const blob = new Blob([imageData], { type: mimeType });
				const bitmap = await createImageBitmap(blob);

				try {
					const c3Texture = await renderer.createStaticTexture(bitmap, {
						sampling: "bilinear",
						mipMap: true
					});

					loadedTextures.push(c3Texture);
					map.set(texture, c3Texture);
				} finally {
					// Always close bitmap to free memory
					bitmap.close();
				}
			}
		}

		return map;
	}

	/**
	 * Process a glTF node recursively, creating GltfNode with meshes.
	 */
	private _processNode(
		renderer: IRenderer,
		nodeDef: GltfNodeDef,
		textureMap: Map<Texture, ITexture>,
		parentMatrix: mat4,
		loadedNodes: GltfNode[]
	): void {
		// Compute world matrix for this node
		const localMatrix = this._getLocalMatrix(nodeDef);
		const worldMatrix = mat4.create();
		mat4.multiply(worldMatrix, parentMatrix, localMatrix);

		const mesh = nodeDef.getMesh();

		if (mesh) {
			const node = new GltfNode();

			for (const primitive of mesh.listPrimitives()) {
				// Only process triangle primitives (mode 4 or undefined which defaults to triangles)
				const mode = primitive.getMode();
				if (mode !== GLTF_TRIANGLES && mode !== undefined) {
					console.warn(`[GltfStatic] Skipping non-triangle primitive (mode: ${mode})`);
					continue;
				}

				const gltfMesh = this._createMesh(
					renderer,
					primitive,
					worldMatrix,
					textureMap
				);
				if (gltfMesh) {
					node.addMesh(gltfMesh);
				}
			}

			// Only add node if it has meshes
			if (node.hasMeshes()) {
				loadedNodes.push(node);
			}
		}

		// Recurse children with accumulated transform
		for (const child of nodeDef.listChildren()) {
			this._processNode(renderer, child, textureMap, worldMatrix, loadedNodes);
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
			return null;
		}

		const posArray = posAccessor.getArray();
		const indicesArray = indicesAccessor.getArray();

		if (!posArray || !indicesArray) {
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
			texCoords = uvArray instanceof Float32Array ? uvArray : new Float32Array(uvArray);
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

		// Apply world transform to positions (bake transform)
		positions = this._transformPositions(positions, worldMatrix);

		// Get texture from material
		let texture: ITexture | null = null;
		const material = primitive.getMaterial();
		if (material) {
			const baseColorTex = material.getBaseColorTexture();
			if (baseColorTex) {
				texture = textureMap.get(baseColorTex) || null;
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
	 * Update all mesh transforms with a new instance transform matrix.
	 */
	updateTransform(matrix: Float32Array): void {
		for (const node of this._nodes) {
			node.updateTransform(matrix);
		}
	}

	/**
	 * Draw all nodes.
	 */
	draw(renderer: IRenderer): void {
		for (const node of this._nodes) {
			node.draw(renderer);
		}
	}

	/**
	 * Release all resources.
	 */
	release(renderer: IRenderer): void {
		// Release nodes (which release meshes)
		for (const node of this._nodes) {
			node.release();
		}
		this._nodes = [];

		// Release owned textures
		for (const texture of this._textures) {
			renderer.deleteTexture(texture);
		}
		this._textures = [];

		this._isLoaded = false;
	}
}
