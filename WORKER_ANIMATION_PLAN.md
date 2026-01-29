# Worker-Based Animation Plan

**Status: IMPLEMENTED**

## Principles
- **KISS**: Extend existing TransformWorkerPool pattern, minimal new abstractions
- **SOLID**: Single responsibility - workers do skinning, main thread does animation logic
- **YAGNI**: Only offload CPU skinning (the bottleneck), keep animation evaluation on main thread

## Analysis: Where Time Is Spent

| Operation | Cost | Location |
|-----------|------|----------|
| Animation evaluation (sampling keyframes) | Low | `_evaluateAnimation()` |
| World matrix computation | Medium | `_computeJointWorldMatrices()` |
| Bone matrix computation | Medium | `_computeBoneMatrices()` |
| **CPU skinning** | **High** | `_applySkinning()` - O(vertices × 4 bones) |

**Conclusion**: Offload CPU skinning to workers. Animation/matrix logic stays on main thread (simpler, avoids transferring animation data).

## Design

### Option A: Extend TransformWorkerPool (Recommended)
Add a new message type `SKIN_BATCH` that accepts bone matrices and performs skinning.

**Pros**:
- Reuses existing worker infrastructure
- Same batching/flush pattern
- Minimal new code

**Cons**:
- Workers need skinning data (joints, weights) in addition to positions

### Option B: Separate SkinningWorkerPool
Create a dedicated pool for skinning operations.

**Pros**:
- Clean separation of concerns
- Optimized for skinning workload

**Cons**:
- More code, more workers
- YAGNI - existing pool works fine

### Recommendation: Option A

## Implementation Steps

### Phase 1: Worker Skinning Support

1. **Extend worker code** to handle `REGISTER_SKINNED` message:
   ```js
   case "REGISTER_SKINNED": {
     meshCache.set(msg.meshId, {
       original: msg.positions,
       joints: msg.joints,      // Uint8Array or Uint16Array
       weights: msg.weights,    // Float32Array
       vertexCount: msg.vertexCount
     });
     break;
   }
   ```

2. **Add `SKIN_BATCH` message handler**:
   ```js
   case "SKIN_BATCH": {
     // msg.requests: Array<{ meshId, boneMatrices: Float32Array }>
     // Perform CPU skinning using cached joints/weights
     // Return packed skinned positions
   }
   ```

3. **Add AnimationController method** `getSkinnedPositionsWorker()`:
   - Returns bone matrices instead of skinned positions
   - Worker does the skinning

### Phase 2: Instance Integration

4. **Add user option** in C3 plugin:
   - `useWorkerSkinning: boolean` (default: false for backwards compatibility)
   - Action: "Set worker skinning" (enabled/disabled)

5. **Modify `_updateSkinnedMeshes()`**:
   ```typescript
   if (this._useWorkerSkinning) {
     // Queue skinning to worker pool
     const boneMatrices = this._animationController.getBoneMatrices();
     SharedWorkerPool.queueSkinning(meshId, boneMatrices);
   } else {
     // Existing CPU skinning path
     mesh.updateSkinnedPositions(controller.getSkinnedPositions(i));
   }
   ```

### Phase 3: Cleanup

6. **Test with high-poly models** to verify performance improvement
7. **Add fallback** if worker pool unavailable (use main thread)

## Data Flow

### Current (Main Thread)
```
[Animation Tick]
    → evaluateAnimation()
    → computeJointWorldMatrices()
    → computeBoneMatrices()
    → applySkinning() ← SLOW for high vertex counts
    → updateMeshPositions()
```

### With Workers
```
[Animation Tick - Main Thread]
    → evaluateAnimation()
    → computeJointWorldMatrices()
    → computeBoneMatrices()
    → queueSkinning(boneMatrices) ← Just queue, no work

[Worker Pool Flush]
    → Workers receive bone matrices
    → Workers perform skinning in parallel
    → Workers return skinned positions

[Callbacks]
    → updateMeshPositions()
```

## API Changes

### TransformWorkerPool
```typescript
// New methods
registerSkinnedMesh(meshId: number, positions: Float32Array,
                    joints: Uint8Array, weights: Float32Array,
                    callback: TransformCallback): void;

queueSkinning(meshId: number, boneMatrices: Float32Array): void;
```

### AnimationController
```typescript
// New method - returns bone matrices for worker skinning
getBoneMatrices(): Float32Array;
```

### Instance
```typescript
// New property
_useWorkerSkinning: boolean = false;

// New action
SetWorkerSkinning(enabled: boolean): void;
```

## Estimated Effort

| Task | Effort |
|------|--------|
| Worker skinning code | ~50 lines |
| TransformWorkerPool extension | ~30 lines |
| AnimationController.getBoneMatrices() | ~5 lines |
| Instance integration | ~20 lines |
| C3 plugin action/property | ~15 lines |
| **Total** | **~120 lines** |

## Usage Example

```typescript
// Setup (done automatically when loading skinned models with workers enabled)
const model = new GltfModel();
await model.load(renderer, "character.glb", { useWorkers: true });
// Skinned meshes are auto-registered with worker pool

// Create animation controller
const controller = new AnimationController({
    skinData: model.skins[0],
    animations: model.animations,
    meshes: model.meshes.map((mesh, i) => ({
        originalPositions: mesh.originalPositions!,
        skinningData: model.getMeshSkinningData(i)!
    }))
});

// Each frame - Option A: Main thread skinning (original path)
controller.update(deltaTime);
for (let i = 0; i < controller.getMeshCount(); i++) {
    model.meshes[i].updateSkinnedPositions(controller.getSkinnedPositions(i));
}

// Each frame - Option B: Worker-based skinning (new path)
controller.update(deltaTime);  // Still evaluates animation on main thread
model.queueSkinning(controller.getBoneMatrices());  // Offloads skinning to workers
// Worker results applied via callbacks during SharedWorkerPool.flushIfPending()
```

## Implementation Details

### Files Modified
- `AnimationController.ts`: Added `getBoneMatrices()`, `getJointCount()`, `getMeshSkinningData()`, `getOriginalPositions()`
- `TransformWorkerPool.ts`: Added `REGISTER_SKIN`, `SKIN_BATCH` message handlers, `registerSkinnedMesh()`, `queueSkinning()`
- `GltfMesh.ts`: Added `registerSkinnedWithPool()`, `isRegisteredSkinnedWithPool`
- `GltfModel.ts`: Added `queueSkinning()`, `hasWorkerSkinning`, auto-registration of skinned meshes

### Data Transfer (per frame)
- Bone matrices sent once per skeleton (50 joints = 3,200 bytes)
- Skinned positions returned per mesh (packed buffer with zero-copy views)
- Uses transferables (not SharedArrayBuffer) due to security restrictions

## Future Considerations (YAGNI - Don't Implement Yet)

- Animation blending in workers
- GPU skinning via compute shaders
- Shared ArrayBuffer for zero-copy bone matrices
- Worker-based animation evaluation (only if animation logic becomes bottleneck)
