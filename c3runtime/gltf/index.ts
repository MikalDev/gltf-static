import { GltfModel } from "./GltfModel.js";
import { GltfMesh } from "./GltfMesh.js";
import { TransformWorkerPool, SharedWorkerPool } from "./TransformWorkerPool.js";
import { AnimationController } from "./AnimationController.js";
import { modelCache } from "./types.js";
import { mat4, quat, vec3 } from "gl-matrix";

// ES module exports
export { GltfModel, GltfMesh, TransformWorkerPool, SharedWorkerPool, AnimationController, modelCache, mat4, quat, vec3 };
export type { GltfModelStats, GltfModelOptions } from "./GltfModel.js";
export type { AnimationMeshData, AnimationControllerOptions } from "./AnimationController.js";
export type {
	CachedModelData,
	CachedSkinData,
	CachedAnimationData,
	MeshSkinningData,
	JointData,
	JointTransform,
	AnimationSamplerData,
	AnimationChannelData,
	AnimationInterpolation,
	AnimationTargetPath
} from "./types.js";

// Attach to globalThis for C3 worker compatibility
(globalThis as any).GltfBundle = { GltfModel, GltfMesh, TransformWorkerPool, SharedWorkerPool, AnimationController, modelCache, mat4, vec3, quat };
