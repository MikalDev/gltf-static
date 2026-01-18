# glTF Static - Construct 3 Plugin Implementation Plan

## Overview
A Construct 3 drawing plugin that loads and renders static glTF 3D models using WebGL/WebGPU.

## Current Status
- [x] Plugin template created (SDK V2)
- [x] Basic file structure in place
- [x] Placeholder ACEs defined
- [ ] glTF loading implementation
- [ ] 3D rendering implementation

---

## Phase 1: glTF Loading
1. **Add glTF loader library**
   - Integrate a lightweight glTF parser (e.g., gltf-transform, or custom minimal parser)
   - Support both `.gltf` (JSON + separate files) and `.glb` (binary) formats
   - Handle embedded textures and external texture references

2. **Asset management**
   - Parse mesh geometry (vertices, normals, UVs, indices)
   - Extract material properties (base color, metallic, roughness)
   - Load and decode textures

3. **Caching**
   - Cache loaded models by URL
   - Reuse geometry and textures across instances

---

## Phase 2: 3D Rendering Pipeline
1. **WebGL/WebGPU setup**
   - Create custom shaders for glTF PBR materials
   - Set up projection and view matrices
   - Implement depth buffer handling

2. **Mesh rendering**
   - Render static meshes with textures
   - Apply model transformations (position, rotation, scale)
   - Support basic lighting (ambient + directional)

3. **Integration with Construct renderer**
   - Hook into the draw call system
   - Handle canvas/viewport sizing
   - Manage render state (blend modes, depth testing)

---

## Phase 3: Editor Integration
1. **Preview in Layout View**
   - Show placeholder or simplified preview of model
   - Display model bounds/wireframe in editor

2. **Properties panel**
   - Model URL picker with file browser
   - Rotation controls
   - Scale controls
   - Optional: camera/view angle presets

---

## Phase 4: Additional Features
1. **Actions**
   - `LoadModel(url)` - Load a model at runtime
   - `SetRotation(x, y, z)` - Set Euler rotation
   - `SetScale(x, y, z)` - Set scale
   - `SetPosition(x, y, z)` - Set 3D position offset

2. **Conditions**
   - `IsLoaded` - Model finished loading
   - `OnLoaded` - Trigger when load completes
   - `OnError` - Trigger on load failure

3. **Expressions**
   - `RotationX`, `RotationY`, `RotationZ`
   - `ScaleX`, `ScaleY`, `ScaleZ`
   - `ModelWidth`, `ModelHeight`, `ModelDepth`

---

## Technical Considerations

### Rendering Approach Options
1. **Option A: Render to texture**
   - Render 3D model to an offscreen canvas/texture
   - Draw texture as 2D quad in Construct
   - Pros: Simpler integration, works with effects
   - Cons: Extra render pass, limited interactivity

2. **Option B: Direct WebGL integration**
   - Intercept Construct's render pipeline
   - Draw 3D content directly to the canvas
   - Pros: Better performance, true 3D
   - Cons: Complex, may conflict with Construct rendering

### Dependencies
- Consider using [three.js](https://threejs.org/) GLTFLoader
- Or [babylon.js](https://www.babylonjs.com/) for simpler setup
- Or custom minimal loader for smallest bundle size

### Performance
- Limit draw calls with mesh batching
- Use LOD (level of detail) for complex models
- Implement frustum culling for multiple models

---

## File Structure
```
gltfStatic/
├── addon.json
├── aces.json
├── icon.svg
├── tsconfig.json
├── plugin.ts          # Editor plugin definition
├── type.ts            # Editor type class
├── instance.ts        # Editor instance (preview rendering)
├── c3runtime/
│   ├── main.ts        # Runtime entry point
│   ├── plugin.ts      # Runtime plugin class
│   ├── type.ts        # Runtime type (texture loading)
│   ├── instance.ts    # Runtime instance (3D rendering)
│   ├── conditions.ts  # Condition implementations
│   ├── actions.ts     # Action implementations
│   └── expressions.ts # Expression implementations
└── lang/
    └── en-US.json     # English localization
```

---

## Next Steps
1. Compile TypeScript to JavaScript (`tsc`)
2. Test plugin loads in Construct 3 (Developer Mode)
3. Implement glTF loading with a chosen library
4. Implement basic 3D rendering
5. Test with sample glTF models
