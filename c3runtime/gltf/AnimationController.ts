import { vec3, quat, mat4 } from "gl-matrix";
import type {
	CachedSkinData,
	CachedAnimationData,
	MeshSkinningData,
	JointTransform,
	AnimationChannelData,
	AnimationSamplerData
} from "./types.js";

// Debug logging
const DEBUG = false;
const LOG_PREFIX = "[AnimationController]";

function debugLog(...args: unknown[]): void {
	if (DEBUG) console.log(LOG_PREFIX, ...args);
}

function debugWarn(...args: unknown[]): void {
	if (DEBUG) console.warn(LOG_PREFIX, ...args);
}

/** Performance warning threshold for CPU skinning */
const MAX_CPU_SKINNING_VERTICES = 10000;
const CPU_WARNING_LOGGED = new WeakSet<AnimationController>();

/** Mesh data required by AnimationController */
export interface AnimationMeshData {
	/** Original bind pose positions (Float32Array, 3 floats per vertex) */
	originalPositions: Float32Array;
	/** Original bind pose normals (Float32Array, 3 floats per vertex, optional) */
	originalNormals?: Float32Array | null;
	/** Per-vertex skinning data (joint indices and weights) */
	skinningData: MeshSkinningData;
}

/** Options for AnimationController construction */
export interface AnimationControllerOptions {
	/** Skin (skeleton) data */
	skinData: CachedSkinData;
	/** All available animations */
	animations: CachedAnimationData[];
	/** Mesh data for skinning */
	meshes: AnimationMeshData[];
}

/** Cached channel data for fast evaluation (populated on play()) */
interface ActiveChannel {
	channel: AnimationChannelData;
	sampler: AnimationSamplerData;
}

/**
 * AnimationController handles skeletal animation playback and CPU skinning.
 *
 * Main thread implementation - call update() each frame to advance animation
 * and compute skinned vertex positions.
 *
 * Usage:
 * ```typescript
 * const controller = new AnimationController({ skinData, animations, meshes });
 * controller.play("Walk");
 *
 * // Each frame:
 * controller.update(deltaTime);
 * for (let i = 0; i < meshes.length; i++) {
 *   mesh.updateSkinnedPositions(controller.getSkinnedPositions(i));
 * }
 * ```
 */
export class AnimationController {
	// Input data (references, not owned)
	private readonly _skinData: CachedSkinData;
	private readonly _animations: CachedAnimationData[];
	private readonly _meshes: AnimationMeshData[];
	private readonly _animationMap: Map<string, CachedAnimationData>;

	// Animation state
	private _currentAnimation: CachedAnimationData | null = null;
	private _time: number = 0;
	private _isPlaying: boolean = false;
	private _isPaused: boolean = false;

	// Playback properties
	public playbackRate: number = 1.0;
	public loop: boolean = true;

	// Worker skinning mode: when true, skip main thread skinning (workers will do it)
	public useWorkerSkinning: boolean = false;

	// Event callback
	public onComplete?: () => void;

	// Pre-allocated joint transform state
	private readonly _jointTransforms: JointTransform[];
	private readonly _jointWorldMatrices: Float32Array;  // 16 floats per joint, flattened
	private readonly _boneMatrices: Float32Array;        // 16 floats per joint, flattened
	private readonly _jointComputed: Uint8Array;         // Track which joints have been computed this frame

	// Pre-allocated skinned position output buffers (one per mesh)
	private readonly _skinnedPositions: Float32Array[];
	// Pre-allocated skinned normal output buffers (one per mesh, if mesh has normals)
	private readonly _skinnedNormals: (Float32Array | null)[];

	// Cached active channels (populated on play() to avoid lookup each frame)
	private _activeChannels: ActiveChannel[] = [];

	// Pre-allocated temp vectors/matrices (reused each frame to avoid GC)
	private readonly _tempVec3A: Float32Array;
	private readonly _tempVec3B: Float32Array;
	private readonly _tempQuatA: Float32Array;
	private readonly _tempQuatB: Float32Array;
	private readonly _tempMat4A: Float32Array;
	private readonly _tempMat4B: Float32Array;

	// Scale correction factor for skeleton/animation translations
	// Detected from IBM scale mismatch (e.g., Blender exports with unapplied scale)
	private _translationScale: number = 1.0;

	constructor(options: AnimationControllerOptions) {
		this._skinData = options.skinData;
		this._animations = options.animations;
		this._meshes = options.meshes;

		// Build animation name lookup
		this._animationMap = new Map();
		for (const anim of options.animations) {
			this._animationMap.set(anim.name, anim);
		}

		const jointCount = this._skinData.joints.length;
		debugLog(`Initializing with ${jointCount} joints, ${options.animations.length} animations, ${options.meshes.length} meshes`);

		// Pre-allocate joint transforms (TRS per joint)
		this._jointTransforms = new Array(jointCount);
		for (let i = 0; i < jointCount; i++) {
			this._jointTransforms[i] = {
				translation: new Float32Array(3),
				rotation: new Float32Array(4),
				scale: new Float32Array(3)
			};
		}

		// Pre-allocate joint world matrices and bone matrices
		this._jointWorldMatrices = new Float32Array(jointCount * 16);
		this._boneMatrices = new Float32Array(jointCount * 16);
		this._jointComputed = new Uint8Array(jointCount);

		// Pre-allocate skinned position output buffers
		this._skinnedPositions = new Array(options.meshes.length);
		this._skinnedNormals = new Array(options.meshes.length);
		let totalVertices = 0;
		for (let i = 0; i < options.meshes.length; i++) {
			const vertexCount = options.meshes[i].originalPositions.length;
			this._skinnedPositions[i] = new Float32Array(vertexCount);
			// Also allocate normal buffers if mesh has normals
			if (options.meshes[i].originalNormals) {
				this._skinnedNormals[i] = new Float32Array(vertexCount);
			} else {
				this._skinnedNormals[i] = null;
			}
			totalVertices += vertexCount / 3;
		}

		// Warn about high vertex counts (review suggestion)
		if (totalVertices > MAX_CPU_SKINNING_VERTICES && !CPU_WARNING_LOGGED.has(this)) {
			console.warn(
				`${LOG_PREFIX} CPU skinning ${totalVertices} vertices (>${MAX_CPU_SKINNING_VERTICES}). ` +
				`Consider using worker-based skinning for better performance.`
			);
			CPU_WARNING_LOGGED.add(this);
		}

		// Pre-allocate temp buffers
		this._tempVec3A = new Float32Array(3);
		this._tempVec3B = new Float32Array(3);
		this._tempQuatA = new Float32Array(4);
		this._tempQuatB = new Float32Array(4);
		this._tempMat4A = new Float32Array(16);
		this._tempMat4B = new Float32Array(16);

		// Detect IBM scale mismatch (e.g., Blender exports with unapplied scale)
		// The first column of the first IBM should have unit length for a properly scaled model
		const ibm = this._skinData.inverseBindMatrices;
		if (jointCount > 0) {
			const ibmScale = Math.sqrt(ibm[0] * ibm[0] + ibm[1] * ibm[1] + ibm[2] * ibm[2]);
			if (ibmScale > 0.001 && Math.abs(ibmScale - 1.0) > 0.1) {
				this._translationScale = 1.0 / ibmScale;
				debugLog(`IBM scale detected: ${ibmScale.toFixed(4)}, translation scale: ${this._translationScale.toFixed(4)}`);
			}
		}

		// Initialize to bind pose
		this._resetToBindPose();
		this._computeJointWorldMatrices();
		this._computeBoneMatrices();
		this._applyAllSkinning();
	}

	// ========================================================================
	// Playback Control
	// ========================================================================

	/**
	 * Start playing an animation by name.
	 * @param name Animation name
	 * @param startTime Optional start time in seconds (default: 0)
	 */
	play(name: string, startTime: number = 0): void {
		const anim = this._animationMap.get(name);
		if (!anim) {
			debugWarn(`Animation "${name}" not found`);
			return;
		}
		this._playAnimation(anim, name, startTime);
	}

	/**
	 * Start playing an animation by index.
	 * Useful when you don't know the animation names.
	 * @param index Animation index (0-based)
	 * @param startTime Optional start time in seconds (default: 0)
	 */
	playByIndex(index: number, startTime: number = 0): void {
		if (index < 0 || index >= this._animations.length) {
			debugWarn(`Animation index ${index} out of range (0-${this._animations.length - 1})`);
			return;
		}
		const anim = this._animations[index];
		this._playAnimation(anim, anim.name, startTime);
	}

	/**
	 * Internal: Start playing a specific animation.
	 */
	private _playAnimation(anim: CachedAnimationData, name: string, startTime: number): void {
		// Only reset if switching animations or explicitly restarting
		const isNewAnimation = this._currentAnimation?.name !== name;

		this._currentAnimation = anim;
		this._time = Math.max(0, Math.min(startTime, anim.duration));
		this._isPlaying = true;
		this._isPaused = false;

		// Cache active channels for this animation
		this._cacheActiveChannels(anim);

		if (isNewAnimation) {
			// Reset to bind pose before applying new animation
			this._resetToBindPose();
		}

		// Evaluate at start time
		this._evaluateAnimation(this._time);
		this._computeJointWorldMatrices();
		this._computeBoneMatrices();

		// Skip main thread skinning if workers will do it
		if (!this.useWorkerSkinning) {
			this._applyAllSkinning();
		}

		debugLog(`Playing "${name}" from ${startTime.toFixed(2)}s (duration: ${anim.duration.toFixed(2)}s)`);
	}

	/**
	 * Stop playback and keep current pose.
	 */
	stop(): void {
		this._isPlaying = false;
		this._isPaused = false;
		debugLog("Stopped");
	}

	/**
	 * Pause playback (can resume later).
	 */
	pause(): void {
		if (this._isPlaying && !this._isPaused) {
			this._isPaused = true;
			debugLog("Paused");
		}
	}

	/**
	 * Resume paused playback.
	 */
	resume(): void {
		if (this._isPlaying && this._isPaused) {
			this._isPaused = false;
			debugLog("Resumed");
		}
	}

	// ========================================================================
	// Time Control
	// ========================================================================

	/**
	 * Advance animation by delta time and recompute skinned positions.
	 * Call this once per frame.
	 * @param deltaTime Time elapsed since last update in seconds
	 */
	update(deltaTime: number): void {
		if (!this._isPlaying || this._isPaused || !this._currentAnimation) {
			return;
		}

		const duration = this._currentAnimation.duration;
		if (duration <= 0) return;

		// Advance time with playback rate
		this._time += deltaTime * this.playbackRate;

		// Handle looping (review suggestion: use subtraction, not modulo)
		if (this.loop) {
			while (this._time >= duration) {
				this._time -= duration;
			}
			while (this._time < 0) {
				this._time += duration;
			}
		} else {
			// Clamp to duration
			if (this._time >= duration) {
				this._time = duration;
				this._isPlaying = false;
				if (this.onComplete) {
					this.onComplete();
				}
			} else if (this._time < 0) {
				this._time = 0;
				this._isPlaying = false;
				if (this.onComplete) {
					this.onComplete();
				}
			}
		}

		// Reset to bind pose, then apply animation
		// (review suggestion: could optimize by tracking which joints have channels)
		this._resetToBindPose();
		this._evaluateAnimation(this._time);
		this._computeJointWorldMatrices();
		this._computeBoneMatrices();

		// Skip main thread skinning if workers will do it
		if (!this.useWorkerSkinning) {
			this._applyAllSkinning();
		}
	}

	/**
	 * Jump to a specific time in the current animation.
	 * @param time Time in seconds
	 */
	setTime(time: number): void {
		if (!this._currentAnimation) return;

		this._time = Math.max(0, Math.min(time, this._currentAnimation.duration));

		this._resetToBindPose();
		this._evaluateAnimation(this._time);
		this._computeJointWorldMatrices();
		this._computeBoneMatrices();

		// Skip main thread skinning if workers will do it
		if (!this.useWorkerSkinning) {
			this._applyAllSkinning();
		}
	}

	/**
	 * Get current playback time in seconds.
	 */
	getTime(): number {
		return this._time;
	}

	/**
	 * Get current time as normalized 0-1 value (review suggestion).
	 */
	getNormalizedTime(): number {
		if (!this._currentAnimation || this._currentAnimation.duration <= 0) {
			return 0;
		}
		return this._time / this._currentAnimation.duration;
	}

	// ========================================================================
	// State Queries
	// ========================================================================

	/**
	 * Check if animation is currently playing (not stopped).
	 */
	isPlaying(): boolean {
		return this._isPlaying;
	}

	/**
	 * Check if animation is paused.
	 */
	isPaused(): boolean {
		return this._isPaused;
	}

	/**
	 * Get name of current animation (or null if none).
	 */
	getCurrentAnimation(): string | null {
		return this._currentAnimation?.name ?? null;
	}

	/**
	 * Get duration of current animation in seconds (0 if none).
	 */
	getDuration(): number {
		return this._currentAnimation?.duration ?? 0;
	}

	/**
	 * Get list of available animation names.
	 */
	getAnimationNames(): string[] {
		return Array.from(this._animationMap.keys());
	}

	/**
	 * Check if an animation exists by name.
	 */
	hasAnimation(name: string): boolean {
		return this._animationMap.has(name);
	}

	/**
	 * Get animation count.
	 */
	getAnimationCount(): number {
		return this._animations.length;
	}

	/**
	 * Get animation name at index.
	 * @param index Animation index (0-based)
	 * @returns Animation name or empty string if out of range
	 */
	getAnimationNameAt(index: number): string {
		if (index < 0 || index >= this._animations.length) {
			return "";
		}
		return this._animations[index].name;
	}

	// ========================================================================
	// Output
	// ========================================================================

	/**
	 * Get the skinned vertex positions for a mesh.
	 * @param meshIndex Index of the mesh
	 * @returns Skinned positions (Float32Array, 3 floats per vertex)
	 */
	getSkinnedPositions(meshIndex: number): Float32Array {
		if (meshIndex < 0 || meshIndex >= this._skinnedPositions.length) {
			throw new Error(`Invalid mesh index: ${meshIndex}`);
		}
		return this._skinnedPositions[meshIndex];
	}

	/**
	 * Get the skinned vertex normals for a mesh.
	 * @param meshIndex Index of the mesh
	 * @returns Skinned normals (Float32Array, 3 floats per vertex) or null if no normals
	 */
	getSkinnedNormals(meshIndex: number): Float32Array | null {
		if (meshIndex < 0 || meshIndex >= this._skinnedNormals.length) {
			throw new Error(`Invalid mesh index: ${meshIndex}`);
		}
		return this._skinnedNormals[meshIndex];
	}

	/**
	 * Get the bone matrices for worker-based skinning.
	 * Returns a VIEW into the internal buffer - do not modify.
	 * Call this after update() to get matrices for the current frame.
	 * @returns Bone matrices (Float32Array, 16 floats per joint, flattened)
	 */
	getBoneMatrices(): Float32Array {
		return this._boneMatrices;
	}

	/**
	 * Get the joint count (number of bones in skeleton).
	 */
	getJointCount(): number {
		return this._skinData.joints.length;
	}

	/**
	 * Get mesh skinning data for worker registration.
	 * Returns the joints and weights arrays needed for worker-based skinning.
	 * @param meshIndex Index of the mesh
	 */
	getMeshSkinningData(meshIndex: number): MeshSkinningData {
		if (meshIndex < 0 || meshIndex >= this._meshes.length) {
			throw new Error(`Invalid mesh index: ${meshIndex}`);
		}
		return this._meshes[meshIndex].skinningData;
	}

	/**
	 * Get original (bind pose) positions for a mesh.
	 * @param meshIndex Index of the mesh
	 */
	getOriginalPositions(meshIndex: number): Float32Array {
		if (meshIndex < 0 || meshIndex >= this._meshes.length) {
			throw new Error(`Invalid mesh index: ${meshIndex}`);
		}
		return this._meshes[meshIndex].originalPositions;
	}

	/**
	 * Get the number of meshes.
	 */
	getMeshCount(): number {
		return this._meshes.length;
	}

	// ========================================================================
	// Joint Query API (for Bone Attachments)
	// ========================================================================

	/**
	 * Get world matrix for a joint by index.
	 * Returns the joint's world-space transform (NOT bone matrix).
	 * Call after update() to get current animation pose.
	 * @param jointIndex Joint index (0-based)
	 * @returns Copy of the joint's world matrix (16 floats) or null if invalid index
	 */
	getJointWorldMatrix(jointIndex: number): Float32Array | null {
		if (jointIndex < 0 || jointIndex >= this._skinData.joints.length) {
			return null;
		}
		// Return a copy to prevent modification
		const offset = jointIndex * 16;
		return new Float32Array(this._jointWorldMatrices.subarray(offset, offset + 16));
	}

	/**
	 * Get all joint world matrices.
	 * Returns a VIEW into internal buffer - do not modify.
	 * @returns Joint world matrices (16 floats per joint, flattened)
	 */
	getJointWorldMatrices(): Float32Array {
		return this._jointWorldMatrices;
	}

	/**
	 * Get local transform matrix for a joint by index.
	 * Returns the joint's local-space transform (relative to parent).
	 * Call after update() to get current animation pose.
	 * @param jointIndex Joint index (0-based)
	 * @returns Copy of the joint's local matrix (16 floats) or null if invalid index
	 */
	getJointLocalTransform(jointIndex: number): Float32Array | null {
		if (jointIndex < 0 || jointIndex >= this._skinData.joints.length) {
			return null;
		}
		const t = this._jointTransforms[jointIndex];
		const mat = mat4.create();
		mat4.fromRotationTranslationScale(
			mat,
			t.rotation as unknown as quat,
			t.translation as unknown as vec3,
			t.scale as unknown as vec3
		);
		return new Float32Array(mat as Float32Array);
	}

	/**
	 * Find joint index by name.
	 * @param name Joint name
	 * @returns Joint index, or -1 if not found
	 */
	getJointIndexByName(name: string): number {
		const joints = this._skinData.joints;
		for (let i = 0; i < joints.length; i++) {
			if (joints[i].name === name) {
				return i;
			}
		}
		return -1;
	}

	/**
	 * Get joint name by index.
	 * @param jointIndex Joint index (0-based)
	 * @returns Joint name or empty string if invalid index
	 */
	getJointName(jointIndex: number): string {
		if (jointIndex < 0 || jointIndex >= this._skinData.joints.length) {
			return "";
		}
		return this._skinData.joints[jointIndex].name;
	}

	/**
	 * Get all joint names.
	 * @returns Array of joint names
	 */
	getJointNames(): string[] {
		return this._skinData.joints.map(j => j.name);
	}

	/**
	 * Check if a joint exists by name.
	 * @param name Joint name
	 * @returns true if joint exists
	 */
	hasJoint(name: string): boolean {
		return this.getJointIndexByName(name) >= 0;
	}

	// ========================================================================
	// Internal: Animation Evaluation
	// ========================================================================

	/**
	 * Cache the active channels for the current animation.
	 * Called once when play() is invoked to avoid map lookups each frame.
	 */
	private _cacheActiveChannels(anim: CachedAnimationData): void {
		this._activeChannels = [];
		for (const channel of anim.channels) {
			// Skip channels targeting non-joint nodes or invalid joints
			if (channel.targetJointIndex < 0 || channel.targetJointIndex >= this._skinData.joints.length) {
				continue;
			}
			const sampler = anim.samplers[channel.samplerIndex];
			if (!sampler || sampler.input.length === 0) {
				continue;
			}
			this._activeChannels.push({ channel, sampler });
		}
		debugLog(`Cached ${this._activeChannels.length} active channels`);
	}

	/**
	 * Reset all joints to their bind pose transforms.
	 */
	private _resetToBindPose(): void {
		const joints = this._skinData.joints;
		for (let i = 0; i < joints.length; i++) {
			const joint = joints[i];
			const transform = this._jointTransforms[i];
			const bindMat = joint.localBindTransform;

			// Decompose bind matrix into TRS
			// gl-matrix mat4.getTranslation, getRotation (as quat), getScaling
			mat4.getTranslation(transform.translation as vec3, bindMat as mat4);
			mat4.getRotation(transform.rotation as quat, bindMat as mat4);
			mat4.getScaling(transform.scale as vec3, bindMat as mat4);
		}
	}

	/**
	 * Evaluate all animation channels at the given time.
	 * Updates joint transforms in place.
	 */
	private _evaluateAnimation(time: number): void {
		for (const { channel, sampler } of this._activeChannels) {
			const jointIndex = channel.targetJointIndex;
			const transform = this._jointTransforms[jointIndex];
			const value = this._sampleChannel(sampler, time, channel.targetPath);

			if (!value) continue;

			switch (channel.targetPath) {
				case "translation":
					transform.translation[0] = value[0];
					transform.translation[1] = value[1];
					transform.translation[2] = value[2];
					break;
				case "rotation":
					transform.rotation[0] = value[0];
					transform.rotation[1] = value[1];
					transform.rotation[2] = value[2];
					transform.rotation[3] = value[3];
					break;
				case "scale":
					transform.scale[0] = value[0];
					transform.scale[1] = value[1];
					transform.scale[2] = value[2];
					break;
				// "weights" (morph targets) not implemented
			}
		}
	}

	/**
	 * Sample an animation channel at a specific time.
	 * Handles LINEAR and STEP interpolation for vec3 and quat values.
	 * @returns The interpolated value, or null if invalid
	 */
	private _sampleChannel(
		sampler: AnimationSamplerData,
		time: number,
		targetPath: string
	): Float32Array | null {
		const times = sampler.input;
		const values = sampler.output;

		if (times.length === 0) return null;

		// Determine value size (3 for translation/scale, 4 for rotation)
		const valueSize = targetPath === "rotation" ? 4 : 3;

		// Handle edge cases: before first or after last keyframe
		if (time <= times[0]) {
			return this._extractValueInto(values, 0, valueSize, "A");
		}
		if (time >= times[times.length - 1]) {
			return this._extractValueInto(values, times.length - 1, valueSize, "A");
		}

		// Find keyframe index (linear search - could optimize with binary search for long tracks)
		let i = 0;
		while (i < times.length - 1 && time > times[i + 1]) {
			i++;
		}

		const t0 = times[i];
		const t1 = times[i + 1];
		const factor = (time - t0) / (t1 - t0);

		// Get values at keyframes (use different buffers to avoid overwrite!)
		const v0 = this._extractValueInto(values, i, valueSize, "A");
		const v1 = this._extractValueInto(values, i + 1, valueSize, "B");

		if (!v0 || !v1) return null;

		// Interpolate based on mode
		if (sampler.interpolation === "STEP") {
			return v0;
		}

		// LINEAR interpolation
		if (valueSize === 4) {
			// Quaternion: use slerp
			quat.set(this._tempQuatA as quat, v0[0], v0[1], v0[2], v0[3]);
			quat.set(this._tempQuatB as quat, v1[0], v1[1], v1[2], v1[3]);
			quat.slerp(this._tempQuatA as quat, this._tempQuatA as quat, this._tempQuatB as quat, factor);
			return this._tempQuatA;
		} else {
			// Vec3: linear interpolation
			vec3.set(this._tempVec3A as vec3, v0[0], v0[1], v0[2]);
			vec3.set(this._tempVec3B as vec3, v1[0], v1[1], v1[2]);
			vec3.lerp(this._tempVec3A as vec3, this._tempVec3A as vec3, this._tempVec3B as vec3, factor);
			return this._tempVec3A;
		}
	}

	/**
	 * Extract a value from the output array at a given keyframe index into specified buffer.
	 * @param target The buffer to write into (A or B)
	 */
	private _extractValueInto(values: Float32Array, index: number, size: number, target: "A" | "B"): Float32Array | null {
		const offset = index * size;
		if (offset + size > values.length) return null;

		if (size === 4) {
			const buf = target === "A" ? this._tempQuatA : this._tempQuatB;
			buf[0] = values[offset];
			buf[1] = values[offset + 1];
			buf[2] = values[offset + 2];
			buf[3] = values[offset + 3];
			return buf;
		} else {
			const buf = target === "A" ? this._tempVec3A : this._tempVec3B;
			buf[0] = values[offset];
			buf[1] = values[offset + 1];
			buf[2] = values[offset + 2];
			return buf;
		}
	}

	// ========================================================================
	// Internal: World Matrix Computation
	// ========================================================================

	/**
	 * Compute world matrices for all joints.
	 * Uses recursive approach to handle any joint ordering (parents computed on-demand).
	 */
	private _computeJointWorldMatrices(): void {
		// Clear computed flags
		this._jointComputed.fill(0);

		// Compute world matrix for each joint (recursively ensures parents are computed first)
		for (let i = 0; i < this._skinData.joints.length; i++) {
			this._computeJointWorldMatrix(i);
		}
	}

	/**
	 * Recursively compute world matrix for a single joint.
	 * Ensures parent is computed before child.
	 */
	private _computeJointWorldMatrix(jointIndex: number): void {
		// Skip if already computed this frame
		if (this._jointComputed[jointIndex]) return;

		const joint = this._skinData.joints[jointIndex];
		const transform = this._jointTransforms[jointIndex];

		// Get destination subarray for this joint's world matrix
		const worldMatOffset = jointIndex * 16;
		const worldMat = this._jointWorldMatrices.subarray(worldMatOffset, worldMatOffset + 16);

		if (joint.parentIndex >= 0) {
			// Ensure parent is computed first (handles any joint ordering)
			// IMPORTANT: Do this BEFORE building local matrix, as recursion uses _tempMat4A
			this._computeJointWorldMatrix(joint.parentIndex);

			// Build local matrix from TRS (after recursion to avoid _tempMat4A corruption)
			mat4.fromRotationTranslationScale(
				this._tempMat4A as mat4,
				transform.rotation as quat,
				transform.translation as vec3,
				transform.scale as vec3
			);

			// Multiply parent world matrix * local matrix
			const parentOffset = joint.parentIndex * 16;
			const parentMat = this._jointWorldMatrices.subarray(parentOffset, parentOffset + 16);
			mat4.multiply(worldMat as mat4, parentMat as mat4, this._tempMat4A as mat4);
		} else {
			// Root joint: world matrix = local matrix
			// Build local matrix from TRS
			mat4.fromRotationTranslationScale(
				this._tempMat4A as mat4,
				transform.rotation as quat,
				transform.translation as vec3,
				transform.scale as vec3
			);
			worldMat.set(this._tempMat4A);
		}

		// Mark as computed
		this._jointComputed[jointIndex] = 1;
	}

	// ========================================================================
	// Internal: Bone Matrix Computation
	// ========================================================================

	/**
	 * Compute bone matrices (world * inverseBindMatrix) for all joints.
	 * These are the final matrices used for skinning.
	 */
	private _computeBoneMatrices(): void {
		const joints = this._skinData.joints;
		const ibm = this._skinData.inverseBindMatrices;
		const ibmScaleFactor = this._translationScale; // Pre-computed in constructor

		for (let i = 0; i < joints.length; i++) {
			const offset = i * 16;
			const worldMat = this._jointWorldMatrices.subarray(offset, offset + 16);
			const invBind = ibm.subarray(offset, offset + 16);
			const boneMat = this._boneMatrices.subarray(offset, offset + 16);

			if (ibmScaleFactor !== 1.0) {
				// Normalize IBM scale before multiplication
				// Only scale the rotation/scale part (columns 0-2 = indices 0-11)
				// Keep translation (column 3 = indices 12-14) at original scale
				// so it properly cancels with world matrix translation
				const normalizedIbm = this._tempMat4B;
				for (let j = 0; j < 12; j++) {
					normalizedIbm[j] = invBind[j] * ibmScaleFactor;
				}
				// Copy translation unchanged
				normalizedIbm[12] = invBind[12];
				normalizedIbm[13] = invBind[13];
				normalizedIbm[14] = invBind[14];
				normalizedIbm[15] = invBind[15]; // Keep w=1

				mat4.multiply(boneMat as mat4, worldMat as mat4, normalizedIbm as mat4);

				// Scale the resulting bone matrix translation to match vertex scale
				// At bind pose this is ~0 so no effect; during animation it scales movement
				boneMat[12] *= ibmScaleFactor;
				boneMat[13] *= ibmScaleFactor;
				boneMat[14] *= ibmScaleFactor;
			} else {
				// boneMatrix = worldMatrix * inverseBindMatrix
				mat4.multiply(boneMat as mat4, worldMat as mat4, invBind as mat4);
			}
		}
	}

	// ========================================================================
	// Internal: CPU Skinning
	// ========================================================================

	/**
	 * Apply skinning to all meshes.
	 */
	private _applyAllSkinning(): void {
		for (let i = 0; i < this._meshes.length; i++) {
			this._applySkinning(i);
		}
	}

	/**
	 * Apply CPU skinning to a single mesh.
	 * Transforms each vertex by weighted blend of up to 4 bone matrices.
	 * Also transforms normals if available.
	 */
	private _applySkinning(meshIndex: number): void {
		const meshData = this._meshes[meshIndex];
		const positions = meshData.originalPositions;
		const normals = meshData.originalNormals;
		const skinning = meshData.skinningData;
		const output = this._skinnedPositions[meshIndex];
		const normalOutput = this._skinnedNormals[meshIndex];

		const vertexCount = positions.length / 3;
		const joints = skinning.joints;
		const weights = skinning.weights;
		const hasNormals = normals && normalOutput;

		for (let v = 0; v < vertexCount; v++) {
			const posOffset = v * 3;
			const skinOffset = v * 4;

			// Read original position
			const px = positions[posOffset];
			const py = positions[posOffset + 1];
			const pz = positions[posOffset + 2];

			// Read original normal if available
			let nx = 0, ny = 0, nz = 0;
			if (hasNormals) {
				nx = normals[posOffset];
				ny = normals[posOffset + 1];
				nz = normals[posOffset + 2];
			}

			// Accumulate weighted transforms
			let rx = 0, ry = 0, rz = 0;
			let rnx = 0, rny = 0, rnz = 0;

			for (let j = 0; j < 4; j++) {
				const weight = weights[skinOffset + j];
				if (weight === 0) continue;

				const jointIdx = joints[skinOffset + j];

				// Defensive check (review suggestion)
				if (jointIdx >= this._skinData.joints.length) {
					debugWarn(`Invalid joint index ${jointIdx} for vertex ${v}`);
					continue;
				}

				const boneOffset = jointIdx * 16;
				const m = this._boneMatrices;

				// Transform position by bone matrix and accumulate with weight
				// result = boneMatrix * position (mat4 * vec3, with w=1)
				const tx = m[boneOffset + 0] * px + m[boneOffset + 4] * py + m[boneOffset + 8] * pz + m[boneOffset + 12];
				const ty = m[boneOffset + 1] * px + m[boneOffset + 5] * py + m[boneOffset + 9] * pz + m[boneOffset + 13];
				const tz = m[boneOffset + 2] * px + m[boneOffset + 6] * py + m[boneOffset + 10] * pz + m[boneOffset + 14];

				rx += tx * weight;
				ry += ty * weight;
				rz += tz * weight;

				// Transform normal by upper-left 3x3 of bone matrix (no translation)
				if (hasNormals) {
					const tnx = m[boneOffset + 0] * nx + m[boneOffset + 4] * ny + m[boneOffset + 8] * nz;
					const tny = m[boneOffset + 1] * nx + m[boneOffset + 5] * ny + m[boneOffset + 9] * nz;
					const tnz = m[boneOffset + 2] * nx + m[boneOffset + 6] * ny + m[boneOffset + 10] * nz;

					rnx += tnx * weight;
					rny += tny * weight;
					rnz += tnz * weight;
				}
			}

			// Write skinned position
			output[posOffset] = rx;
			output[posOffset + 1] = ry;
			output[posOffset + 2] = rz;

			// Write skinned normal (normalized)
			if (hasNormals && normalOutput) {
				const len = Math.sqrt(rnx * rnx + rny * rny + rnz * rnz);
				if (len > 0.0001) {
					normalOutput[posOffset] = rnx / len;
					normalOutput[posOffset + 1] = rny / len;
					normalOutput[posOffset + 2] = rnz / len;
				} else {
					normalOutput[posOffset] = 0;
					normalOutput[posOffset + 1] = 1;
					normalOutput[posOffset + 2] = 0;
				}
			}
		}
	}
}
