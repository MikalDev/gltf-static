# glTF Static - Construct 3 Plugin

A Construct 3 plugin for loading and displaying static glTF 3D models with high performance GPU rendering.

## Features

- Load glTF 2.0 models (.gltf and .glb formats)
- High-performance GPU rendering with instanced drawing
- Transform caching and state batching for optimal performance
- Web Worker pool for offloading heavy computations
- Support for animations and materials
- TypeScript-based development with full type safety

## Development Setup

This plugin is written in TypeScript and requires a build step to generate JavaScript files.

### Prerequisites

- Node.js (v14 or higher)
- npm (comes with Node.js)

### Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd gltfStatic
```

2. Install dependencies:
```bash
npm install
```

3. Build the plugin:
```bash
npm run build
```

This will:
- Bundle runtime modules with esbuild (`c3runtime/gltf-bundle.js`)
- Compile all TypeScript files to JavaScript (`tsc`)

### Development Workflow

#### Building

- **Full build**: `npm run build` - Runs both bundler and TypeScript compiler
- **Bundle only**: `npm run build:bundle` - Builds runtime bundle only
- **TypeScript only**: `npm run build:ts` - Compiles TypeScript only
- **Watch mode**: `npm run watch` - Auto-rebuild on file changes

#### Testing in Construct 3

1. Make sure you've run `npm run build` at least once
2. Open Construct 3 editor
3. Load the addon from this directory
4. Test your changes

**Important**: JavaScript files are NOT committed to version control. Always run `npm run build` after pulling changes or switching branches.

#### Making Changes

1. Edit TypeScript files (`.ts`) - these are the source of truth
2. Run `npm run build` or use `npm run watch` for auto-rebuild
3. Test in Construct 3
4. Commit only the TypeScript changes

### Project Structure

```
gltfStatic/
├── c3runtime/           # Runtime code (loaded in-game)
│   ├── actions.ts       # Plugin actions
│   ├── conditions.ts    # Plugin conditions
│   ├── expressions.ts   # Plugin expressions
│   ├── instance.ts      # Instance class
│   ├── main.ts          # Worker thread entry point
│   ├── plugin.ts        # Plugin definition
│   ├── type.ts          # Object type class
│   └── gltf/           # glTF parsing modules (bundled)
├── instance.ts          # Editor instance class
├── plugin.ts            # Editor plugin definition
├── type.ts              # Editor type class
├── ts-defs/            # TypeScript definitions for C3 SDK
├── build.js            # Build script (esbuild)
├── package.js          # Packaging script for distribution
└── addon.json          # Plugin manifest
```

### TypeScript Configuration

The project uses TypeScript with these settings:
- Target: ES2020
- Module: ES2020
- Strict type checking enabled
- In-place compilation (JS files generated next to TS files)

## Version Control Notes

### Why JS files are gitignored

This project follows TypeScript best practices:

1. **TypeScript is the source of truth** - all `.ts` files are version controlled
2. **JavaScript is generated** - `.js` files are built artifacts (like compiled binaries)
3. **Prevents drift** - impossible for JS and TS to get out of sync
4. **Cleaner history** - git diffs show actual logic changes, not generated code
5. **No merge conflicts** - developers never edit generated files

### Build Requirement

Contributors need to run `npm run build` before:
- Testing changes in Construct 3
- Creating a distribution package
- First time setup after cloning

### Distribution

When creating a release:
```bash
npm run package
```

This creates a distributable `.c3addon` file in the `dist/` directory with all necessary built files.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes to `.ts` files only
4. Run `npm run build` to generate JS files
5. Test in Construct 3
6. Commit only TypeScript changes (JS files are gitignored)
7. Submit a pull request

## Performance Optimizations

Recent improvements include:
- Tick/draw separation for reduced GPU overhead
- State batching to minimize WebGL calls
- Global worker pool with message batching
- Packed buffer format for worker communication
- Transform caching for static models

## License

MIT

## Credits

Built with:
- [glTF Transform](https://github.com/donmccurdy/glTF-Transform) - glTF processing
- [gl-matrix](https://github.com/toji/gl-matrix) - Matrix/vector math
- [esbuild](https://esbuild.github.io/) - Fast bundling
