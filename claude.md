# Claude Code Guidelines for glTF Static Plugin

## Project Overview

This is a Construct 3 plugin for loading and rendering glTF 3D models. It supports:
- Static and animated models
- Worker-based skinning and lighting
- Mesh visibility control

## Construct 3 Plugin Conventions

### ACE Return Values

When expressions return lists or arrays, **always use JSON format** rather than delimited strings:

```typescript
// GOOD - Use JSON.stringify for array returns
_getMeshNames(): string {
    const names = this._model?.getMeshNames() ?? [];
    return JSON.stringify(names);  // Returns: '["mesh1","mesh2"]'
}

// BAD - Comma-separated breaks if values contain commas
_getMeshNames(): string {
    const names = this._model?.getMeshNames() ?? [];
    return names.join(",");  // Breaks if name contains comma
}
```

This pattern is used by:
- `MeshNames` - JSON array of unique mesh names
- `AnimationNames` - JSON array of animation names

### ACE Naming Patterns

- Conditions: `Is<Something>` or `On<Event>`
- Actions: `Set<Property>`, `Show<Thing>`, `Hide<Thing>`
- Expressions: `<PropertyName>` (PascalCase)

When providing both name-based and index-based access, use consistent suffixes:
- `SetMeshVisible(name)` / `SetMeshVisibleByIndex(index)`
- `IsMeshVisible(name)` / `IsMeshVisibleByIndex(index)`

### Lang File Structure

All user-facing strings go in `lang/en-US.json`. Structure:
```json
{
    "conditions": { "<id>": { "list-name", "display-text", "description", "params" } },
    "actions": { "<id>": { ... } },
    "expressions": { "<id>": { "description", "translated-name", "params" } }
}
```

## Architecture Notes

### Mesh Visibility

- Visibility is **runtime state only** - not persisted across model reloads
- Setting visibility to `false` skips only the draw call
- All other processing continues (animations, skinning, lighting)
- Multiple meshes can share the same name (from glTF nodes)

### Node Hierarchy

- glTF node hierarchy is **flattened at load time** into a flat mesh array
- Node names are preserved on each `GltfMesh` for identification
- Transforms are baked into mesh positions (static) or applied via skinning (animated)
