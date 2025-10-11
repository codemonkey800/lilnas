# Horror Game Frontend Implementation Plan

## 📋 Project Overview

**Package Location:** `packages/tdr-horror-frontend`
**Stack:** Vite + React + TypeScript + Three.js
**Purpose:** Multiplayer 3D horror game with 60fps performance target

---

## 🔍 Phase 1: Discovery & Analysis

### Monorepo Structure Analysis

- [x] Identify package manager (npm/yarn/pnpm)
  - **Package Manager:** pnpm@10.13.1 (enforced via `packageManager` field)
  - **Workspaces:** Configured via `pnpm-workspace.yaml` with pattern `packages/*`

- [x] Check for workspace configuration (`pnpm-workspace.yaml`, `lerna.json`, `nx.json`, etc.)
  - **Workspace Config:** `pnpm-workspace.yaml` exists with simple `packages/*` pattern
  - **No Lerna/Nx:** Project uses pnpm workspaces only

- [x] Document existing packages structure
  - **Frontend Apps:**
    - `@lilnas/apps` - Next.js portal/dashboard
    - `@lilnas/dashcam` - Vite+React dashcam viewer (reference for our implementation)
  - **Full-Stack Apps:**
    - `@lilnas/tdr-bot` - Discord bot with NestJS + Next.js
    - `@lilnas/download` - Video download service with web UI
  - **Backend Services:**
    - `@lilnas/equations` - LaTeX rendering service
    - `@lilnas/me-token-tracker` - Crypto tracking bot
  - **Dev Tools:**
    - `@lilnas/cli` - Docker Compose management CLI
    - `@lilnas/utils` - Shared utilities and types
    - `@lilnas/eslint` - Shared ESLint config package
    - `@lilnas/prettier` - Shared Prettier config package

- [x] Identify root-level configs (ESLint, Prettier, TypeScript)
  - **No root tsconfig.json** - Each package has its own TypeScript config
  - **Shared configs via packages:**
    - ESLint: `@lilnas/eslint` package (workspace:*)
    - Prettier: `@lilnas/prettier` package (workspace:*)
  - **Root devDependencies:** ESLint, Prettier, TypeScript, Turbo, Jest, etc.

- [x] Check for shared dependencies in root `package.json`
  - **Common devDependencies in root:**
    - `@lilnas/eslint` and `@lilnas/prettier` (workspace packages)
    - `typescript@5.8.2`, `eslint@9.23.0`, `prettier@3.5.3`
    - `@nestjs/cli`, `@swc/cli`, `@swc/core`, `tsx@4.19.3`
    - `jest@29.7.0`, `ts-jest@29.2.6`
    - `@types/react@19.0.12`, `@types/react-dom@19.0.4`
    - `tailwindcss@4.0.15`, `autoprefixer@10.4.21`

- [x] Identify build tool (Turborepo, Nx, Lerna, etc.)
  - **Build Tool:** Turbo v2.5.4
  - **Configuration:** `turbo.json` with build task dependency graph
  - **Build outputs:** `.next/**` and `dist/**`
  - **Scripts:** Root `package.json` uses `turbo run build`

### Existing Configuration Audit

- [x] Locate and analyze `.eslintrc*` or `eslint.config.*` files
  - **Format:** All packages use new flat config format (`eslint.config.cjs`)
  - **Location:** Each package has its own `eslint.config.cjs`
  - **Pattern:** Packages extend from `@lilnas/eslint` workspace package
  - **Example (dashcam):** `const { base, react } = require('@lilnas/eslint'); module.exports = [...base, ...react]`

- [x] Locate and analyze `.prettierrc*` or `prettier.config.*` files
  - **Format:** Prettier config is a package (`@lilnas/prettier`)
  - **Configuration:**
    - `arrowParens: 'avoid'`
    - `semi: false`
    - `singleQuote: true`
    - `tabWidth: 2`
    - `trailingComma: 'all'`
  - **Usage:** Packages reference via `"prettier": "@lilnas/prettier"` in package.json

- [x] Check for root `tsconfig.json` and any extending configs
  - **No root tsconfig.json** - Each package maintains independent TypeScript config
  - **Reference Config (dashcam/tsconfig.json):**
    - `jsx: "react-jsx"`
    - `module: "ESNext"`, `moduleResolution: "bundler"`
    - `strict: true`, `noEmit: true`
    - Path aliases: `"src/*": ["./src/*"]`, `"@lilnas/utils/*": ["../utils/dist/*"]`
    - `baseUrl: "."`, `composite: true`, `isolatedModules: true`

- [x] Document any custom ESLint rules or plugins
  - **Base Config (`@lilnas/eslint/base.js`):**
    - TypeScript ESLint with recommended rules
    - Import plugin with TypeScript resolver
    - Simple import sort (groups: side effects, node:, packages, src, absolute, relative)
    - Unused imports detection
    - No relative import paths (enforced with `rootDir: 'src', prefix: 'src'`)
  - **React Config (`@lilnas/eslint/react.js`):**
    - React plugin with recommended + jsx-runtime configs
    - React hooks rules
    - Auto-detect React version

- [x] Check for existing Vite/React packages to follow patterns
  - **Reference Package:** `@lilnas/dashcam` (Vite + React + TypeScript)
  - **Key Dependencies:**
    - `vite@6.2.2`, `@vitejs/plugin-react-swc@3.8.1`
    - `vite-tsconfig-paths@5.1.4` (for path aliases)
    - `react@19.0.0`, `react-dom@19.0.0`
  - **Scripts Pattern:**
    - `dev: "vite --port 8080 --host"`
    - `build: "tsc && vite build"`
    - `preview: "vite preview --port 8080"`
    - `lint: "run-p -l 'lint:!(fix)'"` (parallel linting)
    - Separate lint:eslint and lint:prettier tasks

- [x] Identify CI/CD configuration files
  - **Location:** `.github/workflows/`
  - **Workflows:**
    - `test.yml` - Automated testing for changed packages
    - `claude.yml` - Claude AI integration for issues/PRs
    - `claude-code-review.yml` - Automated AI code reviews
  - **Test Workflow Features:**
    - Detects changed packages in PRs
    - Runs tests only for affected packages
    - Executes lint and type-check for changed code
    - Uses pnpm caching for fast builds

---

## 🏗️ Phase 2: Package Infrastructure Setup ✅ COMPLETED

### Create Package Structure

- [x] Create directory: `packages/tdr-horror-frontend`
- [x] Initialize package.json with proper naming convention
- [x] Set package.json fields:
  - [x] name: `@lilnas/tdr-horror-frontend`
  - [x] version: `0.2.0`
  - [x] private: true
  - [x] type: "module"

### Vite Configuration

- [x] Install Vite and React dependencies (React 19.0.0, Vite 6.2.2)
- [x] Create `vite.config.ts`:
  - [x] Configure React plugin with SWC for performance
  - [x] Set up path aliases via vite-tsconfig-paths
  - [x] Configure build output directory
  - [x] Add source maps for development
  - [x] Configure optimizeDeps for Three.js
  - [x] Set server port 8080 (matches dashcam pattern)
  - [x] Manual chunks: three, react-three, vendor

### TypeScript Configuration

- [x] Create `tsconfig.json` (no root config extends - per package pattern)
- [x] Configure for React 19 + Three.js:
  - [x] jsx: "react-jsx"
  - [x] module: "ESNext", moduleResolution: "bundler"
  - [x] strict: true
  - [x] Path mapping: "src/*": ["./src/*"]

---

## 🎨 Phase 3: Linting & Formatting Configuration ✅ COMPLETED

### ESLint Setup

- [x] Create `eslint.config.cjs` with flat config format
- [x] Extend from `@lilnas/eslint` (base + react)
- [x] React and React Hooks plugins configured via shared config
- [x] Validation: `pnpm lint` passes ✅

### Prettier Setup

- [x] Extend from `@lilnas/prettier` via package.json
- [x] Validation: Prettier checks pass ✅

### Scripts Configuration

- [x] Add to package.json scripts:
  - [x] dev, build, preview (port 8080)
  - [x] type-check, lint, lint:fix
  - [x] Parallel execution with run-p (matches dashcam pattern)
- [x] Validation: `pnpm type-check` passes ✅

---

## 🎮 Phase 4: Initial React + Vite Structure ✅ COMPLETED

### Basic File Structure

- [x] Create directory structure:
  - [x] public/
  - [x] src/assets/, src/components/, src/game/
  - [x] src/hooks/, src/stores/, src/types/, src/utils/
  - [x] package.json, tsconfig.json, vite.config.ts
  - [x] eslint.config.cjs, .gitignore

### Entry Files

- [x] Create `src/main.tsx` with React 19 root
- [x] Create `src/App.tsx` with basic component
- [x] Create `src/index.css` with reset and base styles

---

## 🎯 Phase 5: Three.js & Game Libraries Setup ✅ COMPLETED

### Core 3D Dependencies

- [x] Install Three.js ecosystem:
  - [x] three@0.170.0
  - [x] @react-three/fiber@9.3.0
  - [x] @react-three/drei@10.7.6
  - [x] @types/three@0.170.0
- [x] Install game utilities:
  - [x] zustand@5.0.2 (state management)
  - [x] leva@0.9.35 (debug controls)
  - [x] socket.io-client@4.8.1 (multiplayer ready)

### Game Directory Structure ✅ COMPLETED

- [x] Create game-specific structure:
  ```
  src/game/
  ├── components/
  │   ├── Scene.tsx
  │   ├── Player.tsx
  │   ├── Terrain.tsx
  │   ├── Lighting.tsx
  │   └── Environment.tsx
  ├── controllers/
  │   ├── InputManager.ts
  │   ├── FirstPersonController.ts
  │   └── CameraController.ts
  ├── systems/
  │   ├── PhysicsSystem.ts
  │   ├── AudioSystem.ts
  │   └── GameStateManager.ts
  ├── store/
  │   ├── gameStore.ts
  │   └── playerStore.ts
  ├── types/
  │   └── game.types.ts
  ├── utils/
  │   └── helpers.ts
  └── constants/
      └── gameSettings.ts
  ```

### Initial Game Components

**Recommended Implementation Order:**

Components should be implemented in the following order to ensure a logical, bottom-up approach:

1. **Scene Setup** ✅ COMPLETED - Foundation for everything else
2. **Lighting System** ✅ COMPLETED - Essential for visibility and atmosphere; needed before testing other components
3. **Terrain Component** ✅ COMPLETED - Provides ground and collision surfaces for player movement
4. **Input Manager** - Core system for capturing keyboard/mouse input; foundation for player control
5. **First Person Controller** - Movement physics and stamina system; depends on Input Manager
6. **Player Controller** - Ties together input, movement, and camera; the final piece that makes the game playable

**Rationale:**
- **Bottom-up approach**: Build foundational systems (lighting, terrain) before dependent systems (player, movement)
- **Testable increments**: Each component can be tested independently as it's added
- **Dependency order**: Later components depend on earlier ones functioning correctly
- **Visual feedback**: Having lighting and terrain in place makes testing player movement much easier

---

#### Scene Setup (`src/game/components/Scene.tsx`) ✅ COMPLETED

- [x] Create Canvas wrapper with proper settings:
  - [x] Set shadows
  - [x] Configure camera (FOV 75, near 0.1, far 1000)
  - [x] Set pixel ratio for performance (dpr={[1, 2]})
  - [x] Configure tone mapping for dark atmosphere (ACESFilmicToneMapping, exposure 0.5)
- [x] Add performance monitoring (Stats component)
- [x] Add fog for atmosphere (exponential fog, density 0.02)
- [x] Set dark background color (#000000)
- [x] ESLint configured for React Three Fiber properties
- [x] App.tsx updated to render Scene component
- [x] Temporary test cube and lighting added for verification

#### Lighting System (`src/game/components/Lighting.tsx`) ✅ COMPLETED

- [x] Configure ambient light (very dim, 0.05 intensity)
- [x] Create flashlight (SpotLight):
  - [x] Attach to camera
  - [x] Angle: 30 degrees
  - [x] Range: 20 units
  - [x] Intensity: 1
  - [x] Add volumetric fog effect (optional - skipped for MVP)
- [x] Add moon light (directional, very dim)
- [x] Configure shadow settings

#### Terrain Component (`src/game/components/Terrain.tsx`) ✅ COMPLETED

- [x] Create basic ground plane (500x500 units)
- [ ] Add physics collider (deferred to Player Controller phase)
- [x] Apply dark grass/dirt texture (or color) - Using #3a4a2a greenish-brown
- [ ] Add height variation (optional for MVP - skipped)
- [x] Place placeholder tree meshes:
  - [x] Simple cylinder trunks (dark brown #3d2817)
  - [x] Cone or sphere canopies (cone geometry, dark green #1a3a1a)
  - [x] Random positioning algorithm (40 trees with 8-unit minimum distance)
  - [x] Collision boxes for trees (shadow casting/receiving implemented, physics deferred)

#### Input Manager (`src/game/controllers/InputManager.ts`) ✅ COMPLETED

- [x] Set up keyboard input detection:
  - [x] W/A/S/D for movement
  - [x] Shift for running
  - [x] Space for jumping
  - [x] Ctrl for crouching
  - [x] Tab for inventory (future)
  - [x] Escape for pause menu
- [x] Set up mouse input:
  - [x] Mouse move for camera rotation
  - [x] Click to interact (future)
  - [x] Pointer lock API integration
- [x] Create input state management
- [x] Handle multiple simultaneous inputs
- [x] Singleton pattern for global access
- [x] React hook wrapper (useInputManager) with useMemo fix

#### First Person Controller (`src/game/components/Scene.tsx`) ✅ COMPLETED

**Note:** Implemented as CameraController component in Scene.tsx instead of separate FirstPersonController.ts

- [x] Implement movement physics:
  - [x] Walk speed: 5 units/second (adjustable)
  - [x] Movement smoothing with velocity decay
  - [x] Camera rotation applied to movement direction
  - [ ] Run speed: 8 units/second (deferred - needs stamina system)
  - [ ] Jump velocity: 5 units (deferred - needs physics)
  - [ ] Crouch height reduction: 50% (deferred - needs physics)
- [ ] Add stamina system (deferred to Player component):
  - [ ] Max stamina: 100
  - [ ] Run drain: 20/second
  - [ ] Recovery rate: 10/second
  - [ ] Exhausted state when stamina = 0
- [ ] Implement camera head bob (deferred - polish feature)
- [x] Add movement smoothing/interpolation

#### Camera Controller (Integrated in Scene.tsx) ✅ COMPLETED

- [x] Mouse look with pointer lock
- [x] Vertical rotation clamping (prevents over-rotation)
- [x] Horizontal rotation (unlimited)
- [x] Smooth mouse sensitivity (0.002)
- [x] WASD movement with camera-relative directions
- [x] Camera positioned at eye level (1.7m)
- [x] Camera starts facing forward (no downward tilt)

#### Player Controller (`src/game/components/Player.tsx`)

**Status:** Partially implemented via CameraController, full Player component deferred

- [x] Implement first-person camera setup (done in CameraController)
- [ ] Create collision capsule for player (needs physics library)
- [ ] Add RigidBody from Rapier (needs @react-three/rapier)
- [x] Connect to input manager (done in CameraController)
- [x] Initial position and rotation (camera at [0, 1.7, 0])

### State Management

#### Game Store (`src/game/store/gameStore.ts`)

- [ ] Create Zustand store with:
  - [ ] Game state (menu/playing/paused/gameover)
  - [ ] Current objective
  - [ ] Players list (for multiplayer prep)
  - [ ] Monster position (future)
  - [ ] Cabin location
  - [ ] Items collected

#### Player Store (`src/game/store/playerStore.ts`)

- [ ] Create player-specific store:
  - [ ] Position and rotation
  - [ ] Health/alive status
  - [ ] Stamina level
  - [ ] Movement state (idle/walking/running/crouching/hiding)
  - [ ] Inventory items
  - [ ] Flashlight battery (future)

### Debug Tools

- [ ] Set up Leva controls panel:
  - [ ] Player settings folder:
    - [ ] Walk speed slider
    - [ ] Run speed slider
    - [ ] Jump height slider
    - [ ] Stamina drain rate
  - [ ] Environment folder:
    - [ ] Fog density
    - [ ] Ambient light intensity
    - [ ] Flashlight range
    - [ ] Time of day (for testing)
  - [ ] Debug folder:
    - [ ] Show collision boxes
    - [ ] Show FPS counter
    - [ ] Teleport to position
    - [ ] God mode toggle

---

## 🎵 Phase 6: Audio System Foundation

### Audio Setup (Basic)

- [ ] Create AudioSystem class
- [ ] Add spatial audio support (for 3D positioning)
- [ ] Implement basic sound categories:
  - [ ] Ambient (forest sounds)
  - [ ] Player (footsteps, breathing)
  - [ ] UI (menu clicks)
  - [ ] Monster (future)
- [ ] Add volume controls
- [ ] Create audio asset loader

---

## 🧪 Phase 7: Testing & Validation

### Performance Testing

- [ ] Verify 60 FPS on target hardware
- [ ] Check draw calls (aim for <100)
- [ ] Monitor memory usage
- [ ] Test with Chrome DevTools Performance tab
- [ ] Add FPS counter overlay

### Build Validation

- [ ] Run `pnpm build` successfully
- [ ] Check bundle size (should be <5MB for initial)
- [ ] Verify no TypeScript errors
- [ ] Ensure ESLint passes
- [ ] Test production build locally

### Integration Testing

- [ ] Verify monorepo scripts work
- [ ] Test hot module replacement (HMR)
- [ ] Confirm path aliases work
- [ ] Test in different browsers (Chrome, Firefox, Edge)

---

## 🚀 Phase 8: Monorepo Integration

### Update Root Configuration

- [ ] Add to root package.json scripts (if needed)
- [ ] Update CI/CD pipeline to include frontend
- [ ] Add to build order in monorepo tool
- [ ] Update README with frontend info

### Documentation

- [ ] Create `packages/tdr-horror-frontend/README.md`
- [ ] Document available scripts
- [ ] Add development setup instructions
- [ ] Create architecture decision records (ADRs)

---

## ✅ Completion Checklist

### MVP Ready Criteria

- [ ] Player can move in 3D space with WASD
- [ ] Mouse look controls work smoothly
- [ ] Flashlight illuminates dark environment
- [ ] Basic terrain with trees exists
- [ ] Stamina system functions
- [ ] Game runs at 60 FPS
- [ ] Debug tools available via Leva
- [ ] Build completes without errors
- [ ] Code passes linting
- [ ] TypeScript has no errors

### Next Sprint Ready

- [ ] Code structure supports multiplayer addition
- [ ] State management prepared for networking
- [ ] Monster AI system scaffolded
- [ ] Objective system framework in place
- [ ] Audio system ready for sounds
- [ ] Performance baseline established

---

## 📝 Notes for Claude Code

### Implementation Order

1. Start with Phase 1 (Discovery) - understand existing setup
2. Complete Phase 2-3 (Infrastructure) - critical foundation
3. Implement Phase 4-5 (React + Three.js) - core game
4. Add Phase 6-7 (Audio + Testing) - polish
5. Finish with Phase 8 (Integration) - deployment ready

### Key Considerations

- **Performance First**: Every decision should consider 60 FPS target
- **Type Safety**: Use TypeScript strictly, no `any` types
- **Modularity**: Keep systems decoupled for easier testing
- **Multiplayer Ready**: Structure code to easily add networking
- **Debug Friendly**: Include extensive debug tools from start

### Common Pitfalls to Avoid

- Don't use React state for game state (use Zustand)
- Avoid re-renders in game loop (use refs)
- Don't load assets in render functions
- Prevent memory leaks (cleanup Three.js objects)
- Use object pooling for frequently created/destroyed objects

### Performance Optimization Tips

- Use InstancedMesh for repeated objects (trees)
- Implement LOD (Level of Detail) for distant objects
- Use BufferGeometry instead of Geometry
- Batch draw calls where possible
- Implement frustum culling
- Use texture atlases to reduce draw calls

---

## 🔄 Progress Tracking

**Last Updated:** 2025-10-11
**Current Phase:** Phase 5 - Three.js & Game Libraries (Input/Movement Complete)
**Blockers:** None
**Next Steps:**
- Add stamina system
- Implement physics with Rapier for collisions
- Add jump mechanics
- Implement crouch/sprint functionality

---

## 🎯 Success Metrics

- [ ] Game loads in <3 seconds
- [ ] Maintains 60 FPS with 8 players (future)
- [ ] Input latency <16ms
- [ ] No memory leaks after 30 min play
- [ ] Bundle size <10MB total
- [ ] 100% TypeScript coverage
- [ ] 0 ESLint errors/warnings
