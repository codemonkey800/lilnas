# Frontend Infrastructure Setup Tasks

## 🔍 Phase 1: Discovery & Analysis ✅ COMPLETED

### Monorepo Investigation

- [x] Check monorepo tool (pnpm-workspace.yaml, lerna.json, nx.json, or turbo.json)
  - **Result**: pnpm workspaces + Turbo v2.5.4
  - Build orchestration via `turbo.json` with dependency awareness
  - Outputs: `.next/**` and `dist/**`
- [x] Identify package manager (npm, yarn, or pnpm)
  - **Result**: pnpm@10.13.1 (specified in package.json)
- [x] Document existing package naming convention in `packages/` directory
  - **Result**: `@lilnas/<name>` format (e.g., @lilnas/apps, @lilnas/cli)
  - Existing packages: apps, cli, dashcam, download, equations, eslint-config-lilnas, me-token-tracker, prettier-config-lilnas, tdr-bot, tdr-horror-frontend, utils
- [x] Find root TypeScript config (tsconfig.json or tsconfig.base.json)
  - **Result**: No root tsconfig - each package defines its own
- [x] Locate root ESLint config (.eslintrc, eslint.config.js, or eslint.config.mjs)
  - **Result**: No root ESLint config - packages use shared `@lilnas/eslint` package
  - **Format**: Flat config (eslint.config.cjs) - NOT .eslintrc
- [x] Locate root Prettier config (.prettierrc, prettier.config.js)
  - **Result**: No root Prettier config - packages use shared `@lilnas/prettier` package
- [x] Check if there's a shared config package (e.g., `packages/eslint-config`, `packages/tsconfig`)
  - **Result**: Yes, two shared config packages exist:
    - `@lilnas/eslint` (eslint-config-lilnas/) - ESLint flat config with React plugins
    - `@lilnas/prettier` (prettier-config-lilnas/) - Prettier config
- [x] Identify CI/CD setup (GitHub Actions, CircleCI, etc.)
  - **Result**: GitHub Actions (.github/workflows/)
    - `test.yml` - Automated testing for changed packages
    - `claude.yml` - Claude AI issue/PR assistance
    - `claude-code-review.yml` - Automated code reviews
- [x] Check for existing build/dev scripts patterns in root package.json
  - **Result**: Root scripts pattern using `pnpm run -r` (recursive):
    - `build`: turbo run build
    - `lint`: pnpm run -r lint
    - `lint:fix`: pnpm run -r lint:fix
    - `type-check`: pnpm run -r type-check
    - `test`: pnpm run --recursive --if-present test
    - `test:watch`: pnpm run --recursive --if-present test:watch

### Key Findings for Frontend Setup

- **Shared Dependencies**: Use `workspace:*` protocol for internal packages
- **ESLint Format**: MUST use flat config (eslint.config.cjs), not .eslintrc
- **Config Pattern**: Extend from `@lilnas/eslint` and `@lilnas/prettier`
- **Script Pattern**: Each package should have: dev, build, lint, lint:fix, type-check
- **Vite Existing Pattern**: dashcam package uses Vite on port 8080
- **Next.js Pattern**: apps, tdr-bot, download use Next.js
- **Testing**: Jest + ts-jest for testing (see cli, utils, tdr-bot packages)

## 📦 Phase 2: Package Setup ✅ COMPLETED

### Create Package Structure

- [x] Create directory: `packages/tdr-horror-frontend`
- [x] Create subdirectories:
  - [x] `src/`
  - [x] `src/components/`
  - [x] `src/game/`
  - [x] `src/hooks/`
  - [x] `src/stores/`
  - [x] `src/utils/`
  - [x] `src/types/`
  - [x] `src/assets/`
  - [x] `public/`

### Package Configuration

- [x] Create `package.json` with name matching monorepo convention
  - **Name**: `@lilnas/tdr-horror-frontend`
  - **Version**: 0.2.0 (matching monorepo convention)
- [x] Add scripts (dev, build, preview, lint, format, type-check)
  - All scripts following dashcam pattern with `run-p` for parallel execution
- [x] Add production dependencies:
  - [x] React 19.0.0 & React DOM 19.0.0 (matching monorepo standard)
  - [x] Three.js 0.170.0
  - [x] React Three Fiber 9.3.0 (latest stable)
  - [x] React Three Drei 10.7.6 (latest stable)
  - [x] Zustand 5.0.2 (state management)
  - [x] Leva 0.9.35 (debug controls)
  - [x] Socket.io-client 4.8.1
- [x] Add dev dependencies:
  - [x] TypeScript (managed at root: 5.8.2)
  - [x] Vite 6.2.2
  - [x] @vitejs/plugin-react-swc 3.8.1
  - [x] vite-tsconfig-paths 5.1.4
  - [x] @types/three 0.170.0
  - [x] ESLint + Prettier (via @lilnas/eslint and @lilnas/prettier shared configs)

## ⚙️ Phase 3: Configuration Files ✅ COMPLETED

### TypeScript Setup

- [x] Create `tsconfig.json`:
  - [x] Configure for React 19 + Vite
  - [x] Set up path mapping for src imports (`"src/*": ["./src/*"]`)
  - [x] Enable strict mode
  - [x] Configure for Three.js types (@types/three in dependencies)
  - [x] Module resolution: "bundler", target: "ESNext"
- [x] ~~Create `tsconfig.node.json` for Vite config~~ (Not needed - no other package uses this pattern)

### Vite Configuration

- [x] Create `vite.config.ts`:
  - [x] Configure React plugin (@vitejs/plugin-react-swc)
  - [x] Set up path aliases via vite-tsconfig-paths
  - [x] Configure dev server (port 8080, enable HMR, host option)
  - [x] Configure build optimization for gaming:
    - [x] Manual chunks: three, react-three, vendor
    - [x] Source maps enabled
    - [x] Production optimizations
  - [x] Pre-bundle Three.js dependencies (optimizeDeps.include)

### ESLint Setup

- [x] Determined ESLint config format: **Flat config (eslint.config.cjs)**
- [x] Create ESLint config:
  - [x] Extend from @lilnas/eslint (base + react)
  - [x] Inherits React and React Hooks plugins from shared config
  - [x] TypeScript parser configured via shared config
  - [x] Browser environment configured via shared config
  - [x] Import sorting and organization from shared config
- [x] ~~Create `.eslintignore`~~ (Not needed - root patterns sufficient)

### Prettier Setup

- [x] ~~Create `.prettierrc` or `.prettierrc.json`~~ (Already configured in package.json: `"prettier": "@lilnas/prettier"`)
- [x] ~~Create `.prettierignore`~~ (Not needed - root patterns sufficient)

### Git Configuration

- [x] Create `.gitignore`:
  - [x] .vite/ (Vite cache)
  - [x] \*.local (local env files)
  - [x] .DS_Store (macOS files)
  - Note: node_modules, dist, .turbo covered by root .gitignore

### Package Configuration Updates

- [x] Updated `package.json`:
  - [x] Added @lilnas/eslint devDependency (workspace:\*)
  - [x] Added @lilnas/prettier devDependency (workspace:\*)
  - [x] Updated dev script port: 3000 → 8080 (matches dashcam pattern)
  - [x] Updated preview script port: 3000 → 8080

### Created Placeholder

- [x] Created `src/main.tsx` (minimal React entry point for validation)

### Verification

- [x] Ran `pnpm install` - workspace dependencies linked successfully
- [x] Ran `pnpm type-check` - passes ✅
- [x] Ran `pnpm lint` - passes ✅ (ESLint + Prettier)

## 🎮 Phase 4: Initial Game Structure

### Core Files

- [x] Create `src/main.tsx` (entry point) - Basic placeholder created
- [x] Create `src/App.tsx` (main app component)
- [x] Create `src/index.css` (global styles)

## 🔗 Phase 5: Monorepo Integration ⏸️ SKIPPED (Pending Backend)

**Status**: Deferred until backend package is created

### Investigation Results

**✅ Already Complete (No Action Needed):**

- [x] **Root workspace config** - Already includes `packages/*` in pnpm-workspace.yaml
- [x] **Turbo configuration** - Already configured for `.next/**` and `dist/**` outputs
- [x] **Shared dependencies** - Already using `workspace:*` protocol for @lilnas/eslint and @lilnas/prettier
- [x] **TypeScript project references** - Not used in this monorepo (each package is independent)

**⏸️ Deferred Until Backend Exists:**

- [ ] **Root package.json scripts**: Monorepo does NOT have package-specific convenience scripts
  - Current pattern uses: `pnpm --filter @lilnas/tdr-horror-frontend dev`
  - No need for `frontend:dev`, `frontend:build`, etc. in root package.json
- [ ] **Shared types package**: No `@lilnas/tdr-horror-shared` needed yet
  - Will be created when backend package exists and types need to be shared
  - Should include WebSocket events, API types, game state types, etc.
- [ ] **Environment variables**: Create `.env.example` when backend URLs are known
  - Will need: Backend API URL, WebSocket server URL, feature flags, etc.
  - Reference pattern: Check other packages like @lilnas/download for examples

### Next Steps (When Backend is Ready)

1. Create `@lilnas/tdr-horror-backend` package
2. Create `@lilnas/tdr-horror-shared` for shared TypeScript types
3. Add `.env.example` with backend connection details
4. Update both packages to import from shared types

## ✅ Phase 6: Validation & Testing

### Development Environment

- [ ] Run `pnpm install` (or appropriate package manager)
- [ ] Verify `pnpm dev` starts Vite dev server
- [ ] Verify HMR works with React components
- [ ] Verify Three.js scene renders
- [ ] Check that TypeScript path aliases resolve

### Code Quality

- [ ] Run `pnpm type-check` - should pass
- [ ] Run `pnpm lint` - should pass
- [ ] Run `pnpm format:check` - should pass
- [ ] Test `pnpm build` - should create dist folder
- [ ] Verify source maps are generated

### Performance Checks

- [ ] Verify 60fps in basic scene
- [ ] Check bundle size (should be chunked properly)
- [ ] Verify Three.js is pre-bundled (fast initial load)
- [ ] Test WebSocket connection to backend (if backend exists)

## 🚀 Phase 7: Initial Features

### Basic Game Loop

- [ ] Implement basic movement (WASD)
- [ ] Implement mouse look
- [ ] Add collision detection with ground
- [ ] Add basic gravity
- [ ] Implement running with shift key
- [ ] Add stamina system

### Atmosphere

- [ ] Set up dark/foggy environment
- [ ] Implement flashlight attached to camera
- [ ] Add ambient forest sounds setup (even if not implemented)
- [ ] Create basic terrain with placeholder trees

### Debug Tools

- [ ] Add Leva controls for:
  - [ ] Player speed
  - [ ] Jump height
  - [ ] Fog density
  - [ ] Flashlight intensity
- [ ] Add FPS counter
- [ ] Add performance stats panel

## 📝 Phase 8: Documentation

### Create Documentation

- [ ] Create `packages/tdr-horror-frontend/README.md`:
  - [ ] Setup instructions
  - [ ] Available scripts
  - [ ] Architecture overview
  - [ ] Development guidelines
- [ ] Document folder structure
- [ ] Add JSDoc comments to main components
- [ ] Create `CONTRIBUTING.md` with code style guide

### CI/CD Updates

- [ ] Update CI workflow to include frontend:
  - [ ] Lint step
  - [ ] Type check step
  - [ ] Build step
  - [ ] (Optional) Deploy preview for PRs

## 🎯 Completion Checklist

### Final Validation

- [ ] All TypeScript files compile without errors
- [ ] ESLint passes with no errors
- [ ] Prettier formatting is consistent
- [ ] Development server runs at 60fps
- [ ] Build completes successfully
- [ ] Bundle size is reasonable (<1MB initial, <3MB total)
- [ ] All team members can run the project locally
- [ ] CI/CD pipeline passes

---

## Notes for Claude Code

When implementing these tasks:

1. Always check existing patterns in the monorepo first
2. Prefer extending root configs over creating new ones
3. Use the same package manager as the rest of the monorepo
4. Follow existing naming conventions
5. Ensure TypeScript strict mode is enabled for better type safety in game logic
6. Optimize for performance from the start (this is a 60fps game)
7. Keep Three.js render loop separate from React re-renders
8. Use React.memo and useMemo aggressively for performance

## Priority Order

1. **Critical** (Do First): Phases 1-3 (Discovery through Configuration)
2. **Important** (Do Second): Phases 4-5 (Initial Structure & Integration)
3. **Nice to Have** (Do Third): Phases 6-8 (Validation through Documentation)
