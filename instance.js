const PLUGIN_CLASS = SDK.Plugins.GltfStatic;
// Property indices (matching plugin.ts order, excluding link properties)
const PROP_MODEL_URL = "model-url";
const PROP_ROTATION_X = "rotation-x";
const PROP_ROTATION_Y = "rotation-y";
const PROP_ROTATION_Z = "rotation-z";
const PROP_SCALE = "scale";
// Degrees to radians conversion
const DEG_TO_RAD = Math.PI / 180;
// Debug logging
const DEBUG = true;
const LOG_PREFIX = "[GltfStaticEditor]";
function debugLog(...args) {
    if (DEBUG)
        console.log(LOG_PREFIX, ...args);
}
function debugWarn(...args) {
    if (DEBUG)
        console.warn(LOG_PREFIX, ...args);
}
/** Simple 4x4 matrix operations */
function mat4Identity() {
    const m = new Float32Array(16);
    m[0] = m[5] = m[10] = m[15] = 1;
    return m;
}
function mat4Multiply(out, a, b) {
    const a00 = a[0], a01 = a[1], a02 = a[2], a03 = a[3];
    const a10 = a[4], a11 = a[5], a12 = a[6], a13 = a[7];
    const a20 = a[8], a21 = a[9], a22 = a[10], a23 = a[11];
    const a30 = a[12], a31 = a[13], a32 = a[14], a33 = a[15];
    let b0 = b[0], b1 = b[1], b2 = b[2], b3 = b[3];
    out[0] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[1] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[2] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[3] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[4];
    b1 = b[5];
    b2 = b[6];
    b3 = b[7];
    out[4] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[5] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[6] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[7] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[8];
    b1 = b[9];
    b2 = b[10];
    b3 = b[11];
    out[8] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[9] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[10] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[11] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    b0 = b[12];
    b1 = b[13];
    b2 = b[14];
    b3 = b[15];
    out[12] = b0 * a00 + b1 * a10 + b2 * a20 + b3 * a30;
    out[13] = b0 * a01 + b1 * a11 + b2 * a21 + b3 * a31;
    out[14] = b0 * a02 + b1 * a12 + b2 * a22 + b3 * a32;
    out[15] = b0 * a03 + b1 * a13 + b2 * a23 + b3 * a33;
    return out;
}
function mat4FromRotationTranslationScale(out, q, t, s) {
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
function transformPoint(out, p, m) {
    const x = p[0], y = p[1], z = p[2];
    const w = m[3] * x + m[7] * y + m[11] * z + m[15] || 1;
    out[0] = (m[0] * x + m[4] * y + m[8] * z + m[12]) / w;
    out[1] = (m[1] * x + m[5] * y + m[9] * z + m[13]) / w;
    out[2] = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
}
/**
 * Editor glTF model - stores parsed mesh data for CPU rendering.
 */
class EditorGltfModel {
    constructor() {
        this._meshes = [];
        this._images = [];
        this._isLoaded = false;
    }
    get isLoaded() {
        return this._isLoaded;
    }
    get meshes() {
        return this._meshes;
    }
    get images() {
        return this._images;
    }
    /**
     * Load model from ArrayBuffer (used by editor which gets blob from project file).
     */
    async loadFromBuffer(arrayBuffer, filename) {
        debugLog("Loading from buffer:", filename, arrayBuffer.byteLength, "bytes");
        const loadStart = performance.now();
        try {
            // Detect format from magic bytes or extension
            const isGlb = this._isGlbFormat(arrayBuffer) || filename.toLowerCase().endsWith('.glb');
            if (isGlb) {
                await this._parseGlb(arrayBuffer);
            }
            else {
                await this._parseGltf(arrayBuffer, filename);
            }
            this._isLoaded = true;
            debugLog(`Load complete in ${(performance.now() - loadStart).toFixed(0)}ms:`, {
                meshCount: this._meshes.length,
                totalVertices: this._meshes.reduce((sum, m) => sum + m.vertexCount, 0)
            });
        }
        catch (err) {
            debugWarn("Load failed:", err);
            throw err;
        }
    }
    _isGlbFormat(buffer) {
        const view = new DataView(buffer);
        // GLB magic: 0x46546C67 ("glTF" in little-endian)
        return view.getUint32(0, true) === 0x46546C67;
    }
    async _parseGlb(buffer) {
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
        let jsonData = null;
        let binaryBuffer = null;
        while (offset < buffer.byteLength) {
            const chunkLength = view.getUint32(offset, true);
            const chunkType = view.getUint32(offset + 4, true);
            offset += 8;
            if (chunkType === 0x4E4F534A) { // "JSON"
                const jsonBytes = new Uint8Array(buffer, offset, chunkLength);
                const jsonString = new TextDecoder().decode(jsonBytes);
                jsonData = JSON.parse(jsonString);
                debugLog("Parsed JSON chunk");
            }
            else if (chunkType === 0x004E4942) { // "BIN\0"
                binaryBuffer = buffer.slice(offset, offset + chunkLength);
                debugLog("Found binary chunk:", chunkLength, "bytes");
            }
            offset += chunkLength;
        }
        if (!jsonData) {
            throw new Error("GLB missing JSON chunk");
        }
        await this._processDocument(jsonData, binaryBuffer ? [binaryBuffer] : []);
    }
    async _parseGltf(buffer, baseUrl) {
        const jsonString = new TextDecoder().decode(buffer);
        const jsonData = JSON.parse(jsonString);
        // Load external buffers if needed
        const buffers = [];
        if (jsonData.buffers) {
            for (const bufferDef of jsonData.buffers) {
                // For now, assume embedded data or single buffer in GLB
                // External buffer loading would go here
                debugWarn("External buffer loading not implemented, skipping");
            }
        }
        await this._processDocument(jsonData, buffers);
    }
    async _processDocument(doc, buffers) {
        if (!doc.meshes || doc.meshes.length === 0) {
            debugWarn("No meshes in document");
            return;
        }
        // Decode all embedded images first
        await this._decodeImages(doc, buffers);
        // Process all scenes, or just the default scene
        const sceneIndices = doc.scene !== undefined ? [doc.scene] :
            (doc.scenes ? doc.scenes.map((_, i) => i) : []);
        for (const sceneIdx of sceneIndices) {
            const scene = doc.scenes?.[sceneIdx];
            if (!scene?.nodes)
                continue;
            for (const nodeIdx of scene.nodes) {
                this._processNode(doc, buffers, nodeIdx, mat4Identity());
            }
        }
    }
    async _decodeImages(doc, buffers) {
        if (!doc.images || doc.images.length === 0) {
            debugLog("No images in document");
            return;
        }
        debugLog(`Decoding ${doc.images.length} images...`);
        for (let i = 0; i < doc.images.length; i++) {
            const image = doc.images[i];
            if (image.bufferView === undefined) {
                debugWarn(`Image ${i}: no bufferView (external images not supported)`);
                continue;
            }
            try {
                const bufferView = doc.bufferViews?.[image.bufferView];
                if (!bufferView) {
                    debugWarn(`Image ${i}: bufferView not found`);
                    continue;
                }
                const buffer = buffers[bufferView.buffer];
                if (!buffer) {
                    debugWarn(`Image ${i}: buffer not found`);
                    continue;
                }
                const byteOffset = bufferView.byteOffset || 0;
                const imageData = new Uint8Array(buffer, byteOffset, bufferView.byteLength);
                const blob = new Blob([imageData], { type: image.mimeType || 'image/png' });
                const imageBitmap = await createImageBitmap(blob);
                this._images[i] = imageBitmap;
                debugLog(`Image ${i}: ${imageBitmap.width}x${imageBitmap.height}`);
            }
            catch (err) {
                debugWarn(`Image ${i}: decode failed:`, err);
            }
        }
    }
    _processNode(doc, buffers, nodeIdx, parentMatrix) {
        const node = doc.nodes?.[nodeIdx];
        if (!node)
            return;
        // Compute local matrix
        let localMatrix = mat4Identity();
        if (node.matrix) {
            localMatrix = new Float32Array(node.matrix);
        }
        else {
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
    _processMesh(doc, buffers, mesh, worldMatrix) {
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
    _extractPrimitive(doc, buffers, primitive, worldMatrix) {
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
        let uvs;
        if (uvIdx !== undefined) {
            const uvData = this._getAccessorData(doc, buffers, uvIdx);
            uvs = uvData ? new Float32Array(uvData) : new Float32Array(positions.length / 3 * 2);
        }
        else {
            uvs = new Float32Array(positions.length / 3 * 2); // Default to 0,0
        }
        // Extract indices
        const indicesData = this._getAccessorData(doc, buffers, idxIdx);
        if (!indicesData) {
            debugWarn("Failed to extract indices");
            return null;
        }
        // Convert indices to Uint16Array (DrawMesh requires Uint16Array)
        let indices;
        if (indicesData instanceof Uint16Array) {
            indices = indicesData;
        }
        else if (indicesData instanceof Uint32Array) {
            // Check for index overflow - Uint16 max is 65535
            let maxIndex = 0;
            for (let i = 0; i < indicesData.length; i++) {
                if (indicesData[i] > maxIndex)
                    maxIndex = indicesData[i];
            }
            if (maxIndex > 65535) {
                debugWarn(`Mesh has ${maxIndex} vertices but DrawMesh only supports 65535. Indices will be truncated.`);
            }
            indices = new Uint16Array(indicesData);
        }
        else if (indicesData instanceof Uint8Array) {
            indices = new Uint16Array(indicesData);
        }
        else {
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
        // Look up texture index from material
        let textureIndex = -1;
        if (primitive.material !== undefined) {
            const material = doc.materials?.[primitive.material];
            const baseColorTexInfo = material?.pbrMetallicRoughness?.baseColorTexture;
            if (baseColorTexInfo !== undefined) {
                const texture = doc.textures?.[baseColorTexInfo.index];
                if (texture?.source !== undefined) {
                    textureIndex = texture.source;
                }
            }
        }
        debugLog(`Primitive: ${vertexCount} vertices, ${indices.length / 3} triangles, texture: ${textureIndex}`);
        return {
            positions: transformedPositions,
            uvs: new Float32Array(uvs),
            indices,
            vertexCount,
            textureIndex
        };
    }
    _getAccessorData(doc, buffers, accessorIdx) {
        const accessor = doc.accessors?.[accessorIdx];
        if (!accessor)
            return null;
        const bufferView = doc.bufferViews?.[accessor.bufferView];
        if (!bufferView)
            return null;
        const buffer = buffers[bufferView.buffer];
        if (!buffer)
            return null;
        const byteOffset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
        // Component sizes
        const componentSizes = {
            5120: 1, // BYTE
            5121: 1, // UNSIGNED_BYTE
            5122: 2, // SHORT
            5123: 2, // UNSIGNED_SHORT
            5125: 4, // UNSIGNED_INT
            5126: 4, // FLOAT
        };
        // Type element counts
        const typeCounts = {
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
                    if (accessor.componentType === 5126) { // FLOAT
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
            case 5121: // UNSIGNED_BYTE
                return new Uint8Array(rawBytes);
            default:
                debugWarn("Unsupported component type:", accessor.componentType);
                return null;
        }
    }
    /**
     * Release all resources.
     */
    release() {
        this._meshes = [];
        // Close ImageBitmaps to free resources
        for (const img of this._images) {
            if (img)
                img.close();
        }
        this._images = [];
        this._isLoaded = false;
    }
}
PLUGIN_CLASS.Instance = class GltfStaticEditorInstance extends SDK.IWorldInstanceBase {
    constructor(sdkType, inst) {
        super(sdkType, inst);
        // Model state
        this._model = null;
        this._isLoading = false;
        this._lastModelUrl = "";
        // Texture cache (WebGL textures created from model images)
        this._textures = [];
        this._texturesCreated = false;
        this._lastRenderer = null;
        this._layoutView = null;
        // Transform cache
        this._transformedMeshes = [];
        this._lastTransformKey = "";
    }
    Release() {
        this._releaseTextures();
        this._lastRenderer = null;
        this._layoutView = null;
        if (this._model) {
            this._model.release();
            this._model = null;
        }
        this._transformedMeshes = [];
    }
    _releaseTextures() {
        if (this._lastRenderer) {
            for (const tex of this._textures) {
                if (tex)
                    this._lastRenderer.DeleteTexture(tex);
            }
        }
        this._textures = [];
        this._texturesCreated = false;
    }
    OnCreate() {
        // Check if model URL is set and load if so
        const modelUrl = this._inst.GetPropertyValue(PROP_MODEL_URL);
        if (modelUrl && !this._isLoading) {
            this._loadModel(modelUrl);
        }
    }
    OnPlacedInLayout() {
        // Load model if URL is set
        const modelUrl = this._inst.GetPropertyValue(PROP_MODEL_URL);
        if (modelUrl && !this._model && !this._isLoading) {
            this._loadModel(modelUrl);
        }
    }
    /**
     * Load glTF model from project file
     */
    async _loadModel(url) {
        if (this._isLoading)
            return;
        if (!url)
            return;
        debugLog("Loading model:", url);
        this._isLoading = true;
        this._lastModelUrl = url;
        // Release previous model and textures
        if (this._model) {
            this._model.release();
            this._model = null;
        }
        this._releaseTextures();
        this._transformedMeshes = [];
        try {
            // Get the project file using SDK methods
            const project = this.GetProject();
            const projectFile = project.GetProjectFileByExportPath(url);
            if (!projectFile) {
                throw new Error(`Project file not found: ${url}`);
            }
            // Get blob from project file and convert to ArrayBuffer
            const blob = projectFile.GetBlob();
            const arrayBuffer = await blob.arrayBuffer();
            debugLog("Got project file blob:", arrayBuffer.byteLength, "bytes");
            this._model = new EditorGltfModel();
            await this._model.loadFromBuffer(arrayBuffer, url);
            debugLog("Model loaded successfully:", this._model.meshes.length, "meshes");
            // Clear transform cache to force rebuild
            this._lastTransformKey = "";
        }
        catch (err) {
            console.error(LOG_PREFIX, "Failed to load model:", err);
            this._model = null;
        }
        finally {
            this._isLoading = false;
            // Request redraw now that model is loaded
            if (this._layoutView)
                this._layoutView.Refresh();
        }
    }
    /**
     * Build transform key for cache invalidation
     */
    _getTransformKey() {
        const x = this._inst.GetX();
        const y = this._inst.GetY();
        const z = this._inst.GetZElevation();
        const w = this._inst.GetWidth();
        const h = this._inst.GetHeight();
        const angle = this._inst.GetAngle();
        const rotX = this._inst.GetPropertyValue(PROP_ROTATION_X) ?? 0;
        const rotY = this._inst.GetPropertyValue(PROP_ROTATION_Y) ?? 0;
        const rotZ = this._inst.GetPropertyValue(PROP_ROTATION_Z) ?? 0;
        const scale = this._inst.GetPropertyValue(PROP_SCALE) ?? 1;
        return `${x},${y},${z},${w},${h},${angle},${rotX},${rotY},${rotZ},${scale}`;
    }
    /**
     * Build and apply transform to mesh positions
     */
    _updateTransformedMeshes() {
        if (!this._model?.isLoaded)
            return;
        const transformKey = this._getTransformKey();
        if (transformKey === this._lastTransformKey)
            return;
        this._lastTransformKey = transformKey;
        this._transformedMeshes = [];
        // Get transform parameters
        const x = this._inst.GetX();
        const y = this._inst.GetY();
        const z = this._inst.GetZElevation();
        const width = this._inst.GetWidth();
        const angle = this._inst.GetAngle();
        const rotX = (this._inst.GetPropertyValue(PROP_ROTATION_X) ?? 0) * DEG_TO_RAD;
        const rotY = (this._inst.GetPropertyValue(PROP_ROTATION_Y) ?? 0) * DEG_TO_RAD;
        const rotZ = (this._inst.GetPropertyValue(PROP_ROTATION_Z) ?? 0) * DEG_TO_RAD;
        const scale = (this._inst.GetPropertyValue(PROP_SCALE) ?? 1) * width;
        // Build 4x4 transform matrix
        // Order: Scale -> 3D Rotations -> 2D Angle -> Translation
        const cosA = Math.cos(angle), sinA = Math.sin(angle);
        const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
        const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
        const cosZ = Math.cos(rotZ), sinZ = Math.sin(rotZ);
        for (const mesh of this._model.meshes) {
            const srcPos = mesh.positions;
            const dstPos = new Float32Array(srcPos.length);
            for (let i = 0; i < mesh.vertexCount; i++) {
                const idx = i * 3;
                let px = srcPos[idx] * scale;
                let py = srcPos[idx + 1] * scale;
                let pz = srcPos[idx + 2] * scale;
                // Apply rotations in reverse order to match runtime matrix multiplication
                // Runtime does: T * Rangle * Rx * Ry * Rz * S
                // So we apply: Z first, then Y, then X, then angle
                // Rotate around Z axis (3D rotation property)
                let temp = px;
                px = px * cosZ - py * sinZ;
                py = temp * sinZ + py * cosZ;
                // Rotate around Y axis
                temp = px;
                px = px * cosY + pz * sinY;
                pz = -temp * sinY + pz * cosY;
                // Rotate around X axis
                temp = py;
                py = py * cosX - pz * sinX;
                pz = temp * sinX + pz * cosX;
                // Apply 2D angle rotation
                temp = px;
                px = px * cosA - py * sinA;
                py = temp * sinA + py * cosA;
                // Translate
                dstPos[idx] = px + x;
                dstPos[idx + 1] = py + y;
                dstPos[idx + 2] = pz + z;
            }
            this._transformedMeshes.push({
                positions: dstPos,
                uvs: mesh.uvs,
                indices: mesh.indices,
                textureIndex: mesh.textureIndex
            });
        }
    }
    /**
     * Create WebGL textures from model ImageBitmaps
     */
    _createTextures(iRenderer) {
        if (this._texturesCreated || !this._model?.isLoaded)
            return;
        this._texturesCreated = true;
        this._lastRenderer = iRenderer;
        const images = this._model.images;
        debugLog(`Creating ${images.length} WebGL textures...`);
        for (let i = 0; i < images.length; i++) {
            const img = images[i];
            if (!img) {
                this._textures[i] = null;
                continue;
            }
            try {
                // Create dynamic texture with repeat wrapping (glTF default)
                const tex = iRenderer.CreateDynamicTexture(img.width, img.height, {
                    wrapX: "repeat",
                    wrapY: "repeat",
                    sampling: "trilinear",
                    mipMap: true
                });
                iRenderer.UpdateTexture(img, tex, { premultiplyAlpha: true });
                this._textures[i] = tex;
                debugLog(`Texture ${i}: ${img.width}x${img.height}`);
            }
            catch (err) {
                debugWarn(`Texture ${i}: creation failed:`, err);
                this._textures[i] = null;
            }
        }
    }
    Draw(iRenderer, iDrawParams) {
        // Store layout view for refresh after async loads
        this._layoutView = iDrawParams.GetLayoutView();
        // If model is loaded, render it
        if (this._model?.isLoaded) {
            // Update transformed positions if needed
            this._updateTransformedMeshes();
            // Create WebGL textures if not already done
            this._createTextures(iRenderer);
            // Draw each mesh
            for (const mesh of this._transformedMeshes) {
                const tex = mesh.textureIndex >= 0 ? this._textures[mesh.textureIndex] : null;
                if (tex) {
                    // Textured rendering
                    iRenderer.SetTextureFillMode();
                    iRenderer.SetTexture(tex);
                    iRenderer.ResetColor();
                }
                else {
                    // Fallback to gray color for non-textured meshes
                    iRenderer.SetColorFillMode();
                    iRenderer.SetColorRgba(0.7, 0.7, 0.7, 1);
                }
                iRenderer.DrawMesh(mesh.positions, mesh.uvs, mesh.indices);
            }
        }
        else {
            // Fallback: draw placeholder while loading or if no model
            const objectType = this.GetObjectType();
            const image = objectType.GetImage();
            const texture = image.GetCachedWebGLTexture();
            if (texture) {
                // Draw the textured quad
                iRenderer.SetTextureFillMode();
                iRenderer.SetTexture(texture);
                iRenderer.SetColor(this._inst.GetColor());
                iRenderer.Quad3(this._inst.GetQuad(), image.GetTexRect());
            }
            else {
                // Draw a placeholder rectangle when no texture is available
                iRenderer.SetColorFillMode();
                iRenderer.SetColorRgba(0.25, 0.25, 0.5, 1);
                iRenderer.Quad(this._inst.GetQuad());
            }
        }
    }
    OnMakeOriginalSize() {
        const objectType = this.GetObjectType();
        const image = objectType.GetImage();
        const width = image.GetWidth();
        const height = image.GetHeight();
        if (width > 0 && height > 0) {
            this._inst.SetSize(width, height);
        }
    }
    OnDoubleTap() {
        this.GetObjectType().EditImage();
    }
    HasDoubleTapHandler() {
        return true;
    }
    OnPropertyChanged(id, value) {
        // Reload model if URL changed
        if (id === PROP_MODEL_URL) {
            const url = value;
            if (url !== this._lastModelUrl) {
                this._loadModel(url);
            }
        }
        // Clear transform cache when any transform property changes
        // This will force recalculation on next Draw
        if (id === PROP_ROTATION_X || id === PROP_ROTATION_Y ||
            id === PROP_ROTATION_Z || id === PROP_SCALE) {
            this._lastTransformKey = "";
        }
    }
    LoadC2Property(name, valueString) {
        return false;
    }
};
export {};
