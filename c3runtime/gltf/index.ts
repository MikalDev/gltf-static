import { GltfModel } from "./GltfModel.js";
import { GltfMesh } from "./GltfMesh.js";
import { TransformWorkerPool } from "./TransformWorkerPool.js";
import { mat4, quat, vec3 } from "gl-matrix";

// ES module exports
export { GltfModel, GltfMesh, TransformWorkerPool, mat4, quat, vec3 };
export type { GltfModelStats, GltfModelOptions } from "./GltfModel.js";

// Attach to globalThis for C3 worker compatibility
(globalThis as any).GltfBundle = { GltfModel, GltfMesh, TransformWorkerPool, mat4, vec3, quat };
