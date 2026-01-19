/**
 * Editor-specific glTF model loader.
 * Parses glTF/GLB files and stores raw arrays for use with DrawMesh.
 * Does NOT create GPU resources - just stores data for CPU-side rendering.
 */

// Debug logging
const DEBUG = true;
const LOG_PREFIX = "[EditorGltfModel]";

function debugLog(...args: unknown[]): void {
	if (DEBUG) console.log(LOG_PREFIX, ...args);
}

function debugWarn(...args: unknown[]): void {
	if (DEBUG) console.warn(LOG_PREFIX, ...args);
}

/** Raw mesh data for editor rendering */
export interface EditorMeshData {
	positions: Float32Array;  // x, y, z per vertex
	uvs: Float32Array;        // u, v per vertex
	indices: Uint16Array;     // triangle indices
	vertexCount: number;
}

/** glTF accessor types */
interface GltfAccessor {
	bufferView: number;
	byteOffset?: number;
	componentType: number;  // 5126=FLOAT, 5123=UNSIGNED_SHORT, 5125=UNSIGNED_INT, 5121=UNSIGNED_BYTE
	count: number;
	type: string;  // SCALAR, VEC2, VEC3, VEC4
}

interface GltfBufferView {
	buffer: number;
	byteOffset?: number;
	byteLength: number;
	byteStride?: number;
}

interface GltfMeshPrimitive {
	attributes: {
		POSITION?: number;
		TEXCOORD_0?: number;
	};
	indices?: number;
	mode?: number;  // 4 = TRIANGLES (default)
}

interface GltfMesh {
	primitives: GltfMeshPrimitive[];
}

interface GltfNode {
	mesh?: number;
	children?: number[];
	translation?: number[];
	rotation?: number[];
	scale?: number[];
	matrix?: number[];
}

interface GltfScene {
	nodes?: number[];
}

interface GltfDocument {
	accessors?: GltfAccessor[];
	bufferViews?: GltfBufferView[];
	buffers?: { byteLength: number }[];
	meshes?: GltfMesh[];
	nodes?: GltfNode[];
	scenes?: GltfScene[];
	scene?: number;
}

/** Simple 4x4 matrix operations */
function mat4Identity(): Float32Array {
	const m = new Float32Array(16);
	m[0] = m[5] = m[10] = m[15] = 1;
	return m;
}

function mat4Multiply(out: Float32Array, a: Float32Array, b: Float32Array): Float32Array {
	const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
	const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
	const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
	const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];

	let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
	out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

	b0 = b[4]; b1 = b[5]; b2 = b[6]; b3 = b[7];
	out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

	b0 = b[8]; b1 = b[9]; b2 = b[10]; b3 = b[11];
	out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

	b0 = b[12]; b1 = b[13]; b2 = b[14]; b3 = b[15];
	out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
	out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
	out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
	out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;

	return out;
}

function mat4FromRotationTranslationScale(out: Float32Array, q: number[], t: number[], s: number[]): Float32Array {
	// Quaternion to rotation matrix
	const x = q[0], y = q[1], z = q[2], w = q[3];
	const x2 = x + x, y2 = y + y, z2 = z + z;
	const xx = x * x2, xy = x * y2, xz = x * z2;
	const yy = y * y2, yz = y * z2, zz = z * z2;
	const wx = w * x2, wy = w * y2, wz = w * z2;
	const sx = s[0], sy = s[1], sz = s[2];

	out[0] = (1 - (yy + zz)) * sx;
	out[1] = (xy + wz) * sx;
	out[2] = (xz - wy) * sx;
	out[3] = 0;
	out[4] = (xy - wz) * sy;
	out[5] = (1 - (xx + zz)) * sy;
	out[6] = (yz + wx) * sy;
	out[7] = 0;
	out[8] = (xz + wy) * sz;
	out[9] = (yz - wx) * sz;
	out[10] = (1 - (xx + yy)) * sz;
	out[11] = 0;
	out[12] = t[0];
	out[13] = t[1];
	out[14] = t[2];
	out[15] = 1;

	return out;
}

function transformPoint(out: number[], p: number[], m: Float32Array): void {
	const x = p[0], y = p[1], z = p[2];
	const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
	out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
	out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
	out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
}

/**
 * Editor glTF model - stores parsed mesh data for CPU rendering.
 */
export class EditorGltfModel {
	private _meshes: EditorMeshData[] = [];
	private _isLoaded: boolean = false;

	get isLoaded(): boolean {
		return this._isLoaded;
	}

	get meshes(): EditorMeshData[] {
		return this._meshes;
	}

	/**
	 * Load model from URL.
	 */
	async load(url: string): Promise<void> {
		debugLog("Loading from:", url);
		const loadStart = performance.now();

		try {
			const response = await fetch(url);
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${response.statusText}`);
			}

			const arrayBuffer = await response.arrayBuffer();
			debugLog(`Fetched ${arrayBuffer.byteLength} bytes`);

			// Detect format from magic bytes or extension
			const isGlb = this._isGlbFormat(arrayBuffer) || url.toLowerCase().endsWith('.glb');

			if (isGlb) {
				await this._parseGlb(arrayBuffer);
			} else {
				await this._parseGltf(arrayBuffer, url);
			}

			this._isLoaded = true;
			debugLog(`Load complete in ${(performance.now() - loadStart).toFixed(0)}ms:`, {
				meshCount: this._meshes.length,
				totalVertices: this._meshes.reduce((sum, m) => sum + m.vertexCount, 0)
			});
		} catch (err) {
			debugWarn("Load failed:", err);
			throw err;
		}
	}

	private _isGlbFormat(buffer: ArrayBuffer): boolean {
		const view = new DataView(buffer);
		// GLB magic: 0x46546C67 ("glTF" in little-endian)
		return view.getUint32(0, true) === 0x46546C67;
	}

	private async _parseGlb(buffer: ArrayBuffer): Promise<void> {
		const view = new DataView(buffer);

		// Parse GLB header
		const magic = view.getUint32(0, true);
		if (magic !== 0x46546C67) {
			throw new Error("Invalid GLB magic");
		}

		const version = view.getUint32(4, true);
		if (version !== 2) {
			throw new Error(`Unsupported GLB version: ${version}`);
		}

		// const totalLength = view.getUint32(8, true);
		debugLog("GLB version:", version);

		// Parse chunks
		let offset = 12;
		let jsonData: GltfDocument | null = null;
		let binaryBuffer: ArrayBuffer | null = null;

		while (offset < buffer.byteLength) {
			const chunkLength = view.getUint32(offset, true);
			const chunkType = view.getUint32(offset + 4, true);
			offset += 8;

			if (chunkType === 0x4E4F534A) {  // "JSON"
				const jsonBytes = new Uint8Array(buffer, offset, chunkLength);
				const jsonString = new TextDecoder().decode(jsonBytes);
				jsonData = JSON.parse(jsonString) as GltfDocument;
				debugLog("Parsed JSON chunk");
			} else if (chunkType === 0x004E4942) {  // "BIN\0"
				binaryBuffer = buffer.slice(offset, offset + chunkLength);
				debugLog("Found binary chunk:", chunkLength, "bytes");
			}

			offset += chunkLength;
		}

		if (!jsonData) {
			throw new Error("GLB missing JSON chunk");
		}

		this._processDocument(jsonData, binaryBuffer ? [binaryBuffer] : []);
	}

	private async _parseGltf(buffer: ArrayBuffer, baseUrl: string): Promise<void> {
		const jsonString = new TextDecoder().decode(buffer);
		const jsonData = JSON.parse(jsonString) as GltfDocument;

		// Load external buffers if needed
		const buffers: ArrayBuffer[] = [];
		if (jsonData.buffers) {
			for (const bufferDef of jsonData.buffers) {
				// For now, assume embedded data or single buffer in GLB
				// External buffer loading would go here
				debugWarn("External buffer loading not implemented, skipping");
			}
		}

		this._processDocument(jsonData, buffers);
	}

	private _processDocument(doc: GltfDocument, buffers: ArrayBuffer[]): void {
		if (!doc.meshes || doc.meshes.length === 0) {
			debugWarn("No meshes in document");
			return;
		}

		// Process all scenes, or just the default scene
		const sceneIndices = doc.scene !== undefined ? [doc.scene] :
			(doc.scenes ? doc.scenes.map((_, i) => i) : []);

		for (const sceneIdx of sceneIndices) {
			const scene = doc.scenes?.[sceneIdx];
			if (!scene?.nodes) continue;

			for (const nodeIdx of scene.nodes) {
				this._processNode(doc, buffers, nodeIdx, mat4Identity());
			}
		}
	}

	private _processNode(doc: GltfDocument, buffers: ArrayBuffer[], nodeIdx: number, parentMatrix: Float32Array): void {
		const node = doc.nodes?.[nodeIdx];
		if (!node) return;

		// Compute local matrix
		let localMatrix = mat4Identity();
		if (node.matrix) {
			localMatrix = new Float32Array(node.matrix);
		} else {
			const t = node.translation || [0, 0, 0];
			const r = node.rotation || [0, 0, 0, 1];
			const s = node.scale || [1, 1, 1];
			mat4FromRotationTranslationScale(localMatrix, r, t, s);
		}

		// Compute world matrix
		const worldMatrix = mat4Identity();
		mat4Multiply(worldMatrix, parentMatrix, localMatrix);

		// Process mesh if present
		if (node.mesh !== undefined) {
			const mesh = doc.meshes?.[node.mesh];
			if (mesh) {
				this._processMesh(doc, buffers, mesh, worldMatrix);
			}
		}

		// Recurse to children
		if (node.children) {
			for (const childIdx of node.children) {
				this._processNode(doc, buffers, childIdx, worldMatrix);
			}
		}
	}

	private _processMesh(doc: GltfDocument, buffers: ArrayBuffer[], mesh: GltfMesh, worldMatrix: Float32Array): void {
		for (const primitive of mesh.primitives) {
			// Only process triangles (mode 4 is default)
			if (primitive.mode !== undefined && primitive.mode !== 4) {
				debugWarn("Skipping non-triangle primitive, mode:", primitive.mode);
				continue;
			}

			const meshData = this._extractPrimitive(doc, buffers, primitive, worldMatrix);
			if (meshData) {
				this._meshes.push(meshData);
			}
		}
	}

	private _extractPrimitive(doc: GltfDocument, buffers: ArrayBuffer[], primitive: GltfMeshPrimitive, worldMatrix: Float32Array): EditorMeshData | null {
		const posIdx = primitive.attributes.POSITION;
		const uvIdx = primitive.attributes.TEXCOORD_0;
		const idxIdx = primitive.indices;

		if (posIdx === undefined || idxIdx === undefined) {
			debugWarn("Primitive missing POSITION or indices");
			return null;
		}

		// Extract positions
		const positions = this._getAccessorData(doc, buffers, posIdx);
		if (!positions) {
			debugWarn("Failed to extract positions");
			return null;
		}

		// Extract UVs (optional)
		let uvs: Float32Array;
		if (uvIdx !== undefined) {
			const uvData = this._getAccessorData(doc, buffers, uvIdx);
			uvs = uvData ? new Float32Array(uvData) : new Float32Array(positions.length / 3 * 2);
		} else {
			uvs = new Float32Array(positions.length / 3 * 2);  // Default to 0,0
		}

		// Extract indices
		const indicesData = this._getAccessorData(doc, buffers, idxIdx);
		if (!indicesData) {
			debugWarn("Failed to extract indices");
			return null;
		}

		// Convert indices to Uint16Array (DrawMesh requires Uint16Array)
		let indices: Uint16Array;
		if (indicesData instanceof Uint16Array) {
			indices = indicesData;
		} else if (indicesData instanceof Uint32Array) {
			// Check for index overflow - Uint16 max is 65535
			let maxIndex = 0;
			for (let i = 0; i < indicesData.length; i++) {
				if (indicesData[i] > maxIndex) maxIndex = indicesData[i];
			}
			if (maxIndex > 65535) {
				debugWarn(`Mesh has ${maxIndex} vertices but DrawMesh only supports 65535. Indices will be truncated.`);
			}
			indices = new Uint16Array(indicesData);
		} else if (indicesData instanceof Uint8Array) {
			indices = new Uint16Array(indicesData);
		} else {
			indices = new Uint16Array(indicesData);
		}

		const vertexCount = positions.length / 3;

		// Transform positions by world matrix
		const transformedPositions = new Float32Array(positions.length);
		const tempPoint = [0, 0, 0];
		for (let i = 0; i < vertexCount; i++) {
			const idx = i * 3;
			tempPoint[0] = positions[idx];
			tempPoint[1] = positions[idx + 1];
			tempPoint[2] = positions[idx + 2];
			transformPoint(tempPoint, tempPoint, worldMatrix);
			transformedPositions[idx] = tempPoint[0];
			transformedPositions[idx + 1] = tempPoint[1];
			transformedPositions[idx + 2] = tempPoint[2];
		}

		debugLog(`Primitive: ${vertexCount} vertices, ${indices.length / 3} triangles`);

		return {
			positions: transformedPositions,
			uvs: new Float32Array(uvs),
			indices,
			vertexCount
		};
	}

	private _getAccessorData(doc: GltfDocument, buffers: ArrayBuffer[], accessorIdx: number): Float32Array | Uint16Array | Uint32Array | Uint8Array | null {
		const accessor = doc.accessors?.[accessorIdx];
		if (!accessor) return null;

		const bufferView = doc.bufferViews?.[accessor.bufferView];
		if (!bufferView) return null;

		const buffer = buffers[bufferView.buffer];
		if (!buffer) return null;

		const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);

		// Component sizes
		const componentSizes: Record<number, number> = {
			5120: 1,  // BYTE
			5121: 1,  // UNSIGNED_BYTE
			5122: 2,  // SHORT
			5123: 2,  // UNSIGNED_SHORT
			5125: 4,  // UNSIGNED_INT
			5126: 4,  // FLOAT
		};

		// Type element counts
		const typeCounts: Record<string, number> = {
			'SCALAR': 1,
			'VEC2': 2,
			'VEC3': 3,
			'VEC4': 4,
			'MAT2': 4,
			'MAT3': 9,
			'MAT4': 16,
		};

		const componentSize = componentSizes[accessor.componentType] || 4;
		const typeCount = typeCounts[accessor.type] || 1;
		const elementCount = accessor.count * typeCount;

		// Handle interleaved data (byteStride)
		const byteStride = bufferView.byteStride;

		if (byteStride && byteStride !== componentSize * typeCount) {
			// Interleaved - need to extract
			const result = new Float32Array(elementCount);
			const view = new DataView(buffer);

			for (let i = 0; i < accessor.count; i++) {
				const elementOffset = byteOffset + i * byteStride;
				for (let j = 0; j < typeCount; j++) {
					if (accessor.componentType === 5126) {  // FLOAT
						result[i * typeCount + j] = view.getFloat32(elementOffset + j * 4, true);
					}
				}
			}
			return result;
		}

		// Contiguous data - copy to new array to handle alignment issues
		// (typed arrays require byte offset to be multiple of element size)
		const byteLength = elementCount * componentSize;
		const rawBytes = new Uint8Array(buffer, byteOffset, byteLength);

		switch (accessor.componentType) {
			case 5126: { // FLOAT
				const result = new Float32Array(elementCount);
				new Uint8Array(result.buffer).set(rawBytes);
				return result;
			}
			case 5123: { // UNSIGNED_SHORT
				const result = new Uint16Array(elementCount);
				new Uint8Array(result.buffer).set(rawBytes);
				return result;
			}
			case 5125: { // UNSIGNED_INT
				const result = new Uint32Array(elementCount);
				new Uint8Array(result.buffer).set(rawBytes);
				return result;
			}
			case 5121:  // UNSIGNED_BYTE
				return new Uint8Array(rawBytes);
			default:
				debugWarn("Unsupported component type:", accessor.componentType);
				return null;
		}
	}

	/**
	 * Release all resources.
	 */
	release(): void {
		this._meshes = [];
		this._isLoaded = false;
	}
}
