import { GltfModel } from "./GltfModel.js";
import { GltfMesh } from "./GltfMesh.js";
import { mat4, quat, vec3 } from "gl-matrix";

// ES module exports
export { GltfModel, GltfMesh, mat4, quat, vec3 };
export type { GltfModelStats } from "./GltfModel.js";

// Attach to globalThis for C3 worker compatibility
(globalThis as any).GltfBundle = { GltfModel, GltfMesh, mat4, vec3, quat };
