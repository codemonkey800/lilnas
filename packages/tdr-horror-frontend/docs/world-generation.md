# Procedural Forest Generation Implementation Plan

## TDR Horror Game - Frontend Environment System

---

## Current State vs Target Architecture

### What Already Exists

The tdr-horror-frontend has a **working prototype** with basic features:

**✅ Infrastructure:**

- Vite-based React Three Fiber app running on port 8080
- First-person camera with mouse look ([Scene.tsx](../src/game/components/Scene.tsx))
- Stamina system and movement ([playerStore.ts](../src/game/store/playerStore.ts))
- Game state management for 8 players ([gameStore.ts](../src/game/store/gameStore.ts))

**🚧 Prototype Forest (Basic Version):**

- Simple tree placement with `Math.random()` - 2000 trees ([Terrain.tsx](../src/game/components/Terrain.tsx))
- Basic collision avoidance between trees (MIN_DISTANCE=2)
- Simple radial path generation (4 geometric paths)
- Basic tree collision detection
- Atmospheric lighting with flashlight ([Lighting.tsx](../src/game/components/Lighting.tsx))
- Simple exponential fog (`fogExp2`)

**❌ Not Yet Implemented:**

- Noise-based density mapping
- Instanced rendering with LOD
- Poisson disc sampling
- Flow field pathfinding
- 8-player spawn point system
- Cabin placement
- Volumetric fog shaders
- Chunk-based loading

### What This Document Describes

This document outlines the **target production implementation** using sophisticated systems. Most of the current prototype code will be **replaced** (not enhanced) with the implementations described below.

---

## Project Overview

Building a procedural forest generation system for a multiplayer 3D horror game using React Three Fiber. The system must generate an atmospheric, foggy forest environment with 8-player spawn points, a central cabin, and interconnected paths while maintaining 60fps performance on gaming desktops.

### Core Requirements

- **Technology Stack**: React Three Fiber, TypeScript, Vite (✅ already configured)
- **Performance Target**: Consistent 60fps on GTX 1060 or equivalent
- **World Size**: 500x500 unit grid
- **Tree Count**: 2000-5000 instances (currently: 2000 with simple rendering)
- **Player Count**: 8 spawn points (currently: 1 spawn at origin)
- **Key Features**: Procedural generation, atmospheric fog, path network, cabin placement

---

## Technical Architecture

### 1. Noise-Based Procedural Generation System

#### 1.1 Forest Density Mapping

```typescript
// src/game/systems/forest/ForestGenerator.ts
import { SimplexNoise } from 'three/examples/jsm/math/SimplexNoise'
import { Vector3 } from 'three'

interface ForestConfig {
  worldSize: number // 500 units default
  treeCount: number // 2000-5000 range
  cellSize: number // 10 units for spatial grid
  clearingRadius: number // 25 units for cabin
  pathWidth: number // 3-4 units for trails
  seed: number // For reproducible generation
}

class ForestGenerator {
  private noise: SimplexNoise
  private densityMap: Float32Array
  private pathMap: Uint8Array
  private config: ForestConfig

  constructor(config: ForestConfig) {
    this.config = config
    this.noise = new SimplexNoise(config.seed)
    this.initializeMaps()
  }

  generateDensityMap(): Float32Array {
    const size = this.config.worldSize
    const resolution = size / this.config.cellSize
    const map = new Float32Array(resolution * resolution)

    for (let x = 0; x < resolution; x++) {
      for (let z = 0; z < resolution; z++) {
        const worldX = (x / resolution - 0.5) * size
        const worldZ = (z / resolution - 0.5) * size

        // Multi-octave noise for natural variation
        let density = 0
        density += this.noise.noise(worldX * 0.005, worldZ * 0.005) * 0.5
        density += this.noise.noise(worldX * 0.02, worldZ * 0.02) * 0.3
        density += this.noise.noise(worldX * 0.1, worldZ * 0.1) * 0.2

        // Edge falloff for natural boundaries
        const distFromCenter = Math.sqrt(worldX * worldX + worldZ * worldZ)
        const falloff = 1 - Math.min(distFromCenter / (size * 0.4), 1)
        density *= falloff

        map[x * resolution + z] = Math.max(0, density)
      }
    }
    return map
  }
}
```

#### 1.2 Poisson Disc Sampling for Tree Placement

```typescript
interface TreeInstance {
  position: Vector3
  rotation: number
  scale: number
  treeType: number // 0-3 for variety
}

class PoissonDiscSampler {
  private radius: number = 3 // Minimum distance between trees
  private maxAttempts: number = 30

  generatePoints(
    bounds: { min: Vector3; max: Vector3 },
    densityMap: Float32Array,
    count: number,
  ): Vector3[] {
    const points: Vector3[] = []
    const activeList: Vector3[] = []
    const cellSize = this.radius / Math.sqrt(2)
    const grid = new Map<string, Vector3>()

    // Implementation of Poisson disc sampling
    // Returns naturally spaced tree positions
    return points
  }
}
```

---

### 2. Instanced Rendering System

#### 2.1 Tree Instance Manager

```tsx
// src/game/components/TreeInstances.tsx (will replace current Terrain.tsx tree rendering)
import { useRef, useMemo, useEffect } from 'react'
import { InstancedMesh, Object3D, Group, LOD } from 'three'
import { useFrame } from '@react-three/fiber'

interface TreeInstancesProps {
  positions: Vector3[]
  rotations: number[]
  scales: number[]
  types: number[]
}

function TreeInstances({
  positions,
  rotations,
  scales,
  types,
}: TreeInstancesProps) {
  const groupRef = useRef<Group>()
  const lodRef = useRef<LOD[]>([])
  const tempObject = useMemo(() => new Object3D(), [])

  // Three LOD levels for performance
  const geometryLODs = useMemo(
    () => ({
      high: {
        trunk: new CylinderGeometry(0.5, 0.7, 8, 8, 4),
        leaves: new ConeGeometry(3, 10, 8, 3),
      },
      medium: {
        trunk: new CylinderGeometry(0.5, 0.7, 8, 6, 2),
        leaves: new ConeGeometry(3, 10, 6, 2),
      },
      low: {
        trunk: new CylinderGeometry(0.5, 0.7, 8, 4, 1),
        leaves: new ConeGeometry(3, 10, 4, 1),
      },
    }),
    [],
  )

  // LOD distances
  const LOD_DISTANCES = {
    high: 50,
    medium: 150,
    low: 300,
    cull: 400,
  }

  return <group ref={groupRef}>{/* Instance mesh implementation */}</group>
}
```

#### 2.2 Frustum Culling and Optimization

```typescript
class TreeCullingSystem {
  private frustum: Frustum
  private camera: Camera
  private visibleIndices: Set<number>

  updateVisibility(trees: TreeInstance[], camera: Camera): number[] {
    // Update frustum from camera
    this.frustum.setFromProjectionMatrix(camera.projectionMatrix)

    // Test each tree chunk against frustum
    const visible: number[] = []
    for (let i = 0; i < trees.length; i++) {
      if (this.frustum.containsPoint(trees[i].position)) {
        visible.push(i)
      }
    }
    return visible
  }
}
```

---

### 3. Location and Path Generation

#### 3.1 Critical Location Placement

```typescript
// src/game/systems/forest/LocationPlacement.ts
interface LocationGenerator {
  cabinPosition: Vector3
  spawnPoints: Vector3[] // 8 points (currently: 1 at origin)
  mainPaths: Path[]
  secondaryPaths: Path[]
}

class LocationPlacementSystem {
  private forestData: ForestData

  generateCriticalLocations(): LocationGenerator {
    const result: LocationGenerator = {
      cabinPosition: null,
      spawnPoints: [],
      mainPaths: [],
      secondaryPaths: [],
    }

    // Step 1: Find suitable cabin clearing
    result.cabinPosition = this.findClearing({
      minRadius: 25,
      maxRadius: 35,
      preferredDistance: this.config.worldSize * 0.3,
      avoidEdges: true,
    })

    // Step 2: Generate spawn points on perimeter
    const angleStep = (Math.PI * 2) / 8
    for (let i = 0; i < 8; i++) {
      const angle = angleStep * i + (Math.random() - 0.5) * angleStep * 0.5
      const distance = this.config.worldSize * 0.45
      result.spawnPoints.push(
        new Vector3(Math.cos(angle) * distance, 0, Math.sin(angle) * distance),
      )
    }

    // Step 3: Generate paths using flow fields
    result.mainPaths = this.generateMainPaths(
      result.spawnPoints,
      result.cabinPosition,
    )

    // Step 4: Add wandering secondary paths
    result.secondaryPaths = this.generateSecondaryPaths(5)

    return result
  }
}
```

#### 3.2 Flow Field Pathfinding

```typescript
// src/game/systems/forest/FlowFieldPathfinder.ts (will replace simple radial paths in Terrain.tsx)
class FlowFieldPathfinder {
  private flowField: Vector2[][]
  private obstacles: boolean[][]

  generatePath(
    start: Vector3,
    end: Vector3,
    avoidance: number = 0.5,
  ): Vector3[] {
    // Create flow field toward target
    this.calculateFlowField(end)

    // Follow field from start to end
    const path: Vector3[] = []
    let current = start.clone()
    const stepSize = 1.0
    const maxSteps = 500

    for (let i = 0; i < maxSteps; i++) {
      const flow = this.sampleFlowField(current)
      current.add(new Vector3(flow.x * stepSize, 0, flow.y * stepSize))

      // Add noise for organic feel
      current.x += (Math.random() - 0.5) * avoidance
      current.z += (Math.random() - 0.5) * avoidance

      path.push(current.clone())

      if (current.distanceTo(end) < 5) break
    }

    return path
  }
}
```

---

### 4. Atmosphere and Visual Effects

#### 4.1 Layered Fog System

```tsx
// src/game/components/ForestAtmosphere.tsx (will enhance existing Lighting.tsx and Scene.tsx fog)
import { extend } from '@react-three/fiber'
import { shaderMaterial } from '@react-three/drei'

const VolumetricFogMaterial = shaderMaterial(
  {
    fogColor: new Color('#0a0f0a'),
    fogNear: 5,
    fogFar: 80,
    fogDensity: 0.02,
    heightFalloff: 0.15,
    time: 0,
  },
  // Vertex shader
  `
    varying vec3 vWorldPosition;
    varying float vFogDepth;

    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      vFogDepth = length(cameraPosition - worldPosition.xyz);
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `,
  // Fragment shader
  `
    uniform vec3 fogColor;
    uniform float fogNear;
    uniform float fogFar;
    uniform float fogDensity;
    uniform float heightFalloff;
    uniform float time;
    varying vec3 vWorldPosition;
    varying float vFogDepth;

    void main() {
      float fogFactor = 1.0 - exp(-fogDensity * vFogDepth);
      fogFactor *= exp(-vWorldPosition.y * heightFalloff);

      // Animated fog wisps
      fogFactor += sin(vWorldPosition.x * 0.1 + time) * 0.05;
      fogFactor += cos(vWorldPosition.z * 0.1 - time * 0.5) * 0.05;

      fogFactor = clamp(fogFactor, 0.0, 1.0);
      gl_FragColor = vec4(fogColor, fogFactor);
    }
  `,
)

extend({ VolumetricFogMaterial })
```

#### 4.2 Lighting Configuration

> **Note:** [Lighting.tsx](../src/game/components/Lighting.tsx) already has good atmospheric lighting. This section describes potential enhancements.

```tsx
function ForestLighting() {
  return (
    <>
      {/* Base ambient - very dark */}
      <ambientLight intensity={0.02} color="#1a3a2a" />

      {/* Hemisphere for subtle sky/ground difference */}
      <hemisphereLight
        skyColor="#2a4a3a"
        groundColor="#000000"
        intensity={0.1}
      />

      {/* Moonlight through canopy - main light source */}
      <directionalLight
        position={[50, 100, -30]}
        intensity={0.15}
        color="#7aa891"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={500}
        shadow-camera-left={-100}
        shadow-camera-right={100}
        shadow-camera-top={100}
        shadow-camera-bottom={-100}
      />

      {/* Rim lighting for silhouettes */}
      <directionalLight
        position={[-30, 50, 50]}
        intensity={0.05}
        color="#4a6a5a"
      />
    </>
  )
}
```

---

### 5. Performance Optimization Systems

#### 5.1 Chunk-Based Loading

```typescript
// src/game/systems/forest/ChunkManager.ts
class ForestChunkManager {
  private chunkSize: number = 50 // 50x50 unit chunks
  private chunks: Map<string, TreeChunk>
  private activeChunks: Set<string>
  private loadDistance: number = 150

  updateVisibleChunks(playerPosition: Vector3): void {
    const playerChunkX = Math.floor(playerPosition.x / this.chunkSize)
    const playerChunkZ = Math.floor(playerPosition.z / this.chunkSize)
    const loadRadius = Math.ceil(this.loadDistance / this.chunkSize)

    const newActive = new Set<string>()

    for (let x = -loadRadius; x <= loadRadius; x++) {
      for (let z = -loadRadius; z <= loadRadius; z++) {
        const chunkKey = `${playerChunkX + x},${playerChunkZ + z}`
        const distance = Math.sqrt(x * x + z * z) * this.chunkSize

        if (distance <= this.loadDistance) {
          newActive.add(chunkKey)

          if (!this.activeChunks.has(chunkKey)) {
            this.loadChunk(chunkKey)
          }
        }
      }
    }

    // Unload distant chunks
    for (const chunk of this.activeChunks) {
      if (!newActive.has(chunk)) {
        this.unloadChunk(chunk)
      }
    }

    this.activeChunks = newActive
  }
}
```

#### 5.2 Quality Settings Manager

```typescript
interface QualitySettings {
  treeCount: number
  viewDistance: number
  shadowQuality: 'low' | 'medium' | 'high'
  fogQuality: 'simple' | 'volumetric'
  grassDensity: number
}

const QUALITY_PRESETS = {
  low: {
    treeCount: 2000,
    viewDistance: 200,
    shadowQuality: 'low',
    fogQuality: 'simple',
    grassDensity: 0,
  },
  medium: {
    treeCount: 3500,
    viewDistance: 300,
    shadowQuality: 'medium',
    fogQuality: 'simple',
    grassDensity: 0.5,
  },
  high: {
    treeCount: 5000,
    viewDistance: 400,
    shadowQuality: 'high',
    fogQuality: 'volumetric',
    grassDensity: 1.0,
  },
}
```

---

## Implementation Phases

### Phase 1: Core Generation System ❌ Not Implemented

**Duration**: 1-2 days
**Goal**: Replace simple random placement with noise-based generation
**Status**: Prototype exists using `Math.random()` in [Terrain.tsx](../src/game/components/Terrain.tsx)

Key files to create in `src/game/systems/forest/`:

- `ForestGenerator.ts` - Noise-based density mapping
- `NoiseUtils.ts` - Multi-octave noise utilities
- `PoissonDiscSampler.ts` - Proper tree distribution

### Phase 2: Instanced Rendering Pipeline ❌ Not Implemented

**Duration**: 2 days
**Goal**: Replace individual meshes with instanced rendering + LOD
**Status**: Current uses 2000 individual mesh objects (lines 123-139 in [Terrain.tsx](../src/game/components/Terrain.tsx))

Key components to create in `src/game/components/`:

- `TreeInstances.tsx` - InstancedMesh with LOD system
- `TreeGeometry.ts` - High/medium/low LOD geometries
- `TreeMaterials.ts` - Optimized material atlasing

### Phase 3: Critical Locations ❌ Not Implemented

**Duration**: 1-2 days
**Goal**: Add 8-player spawns and cabin placement
**Status**: Only single spawn at origin in [gameStore.ts](../src/game/store/gameStore.ts:49), no cabin

Key systems to create in `src/game/systems/forest/`:

- `LocationPlacement.ts` - 8 spawn points + cabin
- `ClearingDetector.ts` - Find suitable cabin site
- Update [gameStore.ts](../src/game/store/gameStore.ts) with spawn points

### Phase 4: Path Network 🚧 Prototype Only

**Duration**: 2 days
**Goal**: Replace geometric paths with flow field system
**Status**: Basic radial paths exist (lines 31-59 in [Terrain.tsx](../src/game/components/Terrain.tsx))

Key implementations to create in `src/game/systems/forest/`:

- `FlowFieldPathfinder.ts` - Proper pathfinding
- `PathRenderer.tsx` - Enhanced trail visualization
- `PathClearingSystem.ts` - Smart tree removal

### Phase 5: Atmosphere & Polish 🚧 Partial

**Duration**: 2 days
**Goal**: Add volumetric fog and polish lighting
**Status**: ✅ Good lighting in [Lighting.tsx](../src/game/components/Lighting.tsx), ❌ simple fog in [Scene.tsx](../src/game/components/Scene.tsx:171)

Key elements to create in `src/game/components/`:

- `ForestAtmosphere.tsx` - Volumetric fog shader (upgrade from `fogExp2`)
- Optional: `WindSystem.ts` - Tree sway animation
- Optional: `AmbientSounds.tsx` - Spatial audio

### Phase 6: Optimization ❌ Not Implemented

**Duration**: 1-2 days
**Goal**: Add chunking and culling for 60fps
**Status**: Basic collision only (lines 109-123 in [Scene.tsx](../src/game/components/Scene.tsx))

Key optimizations to create in `src/game/systems/forest/`:

- `ChunkManager.ts` - Spatial chunking
- `OcclusionCuller.ts` - Frustum culling
- `PerformanceMonitor.tsx` - FPS tracking with Leva

---

## Integration Guide

> **Note:** [Scene.tsx](../src/game/components/Scene.tsx) is already set up as the main entry point. Integration involves replacing/enhancing existing components.

### 1. Current Structure (Already Set Up)

```tsx
// src/App.tsx (already exists)
import { Scene } from './game/components/Scene'

export function App() {
  return <Scene /> // Main entry point
}
```

```tsx
// src/game/components/Scene.tsx (already exists - lines 190-224)
// Canvas is already configured with:
// - shadows enabled
// - camera at [0, 1.7, 0]
// - pointer lock for FPS controls
// Contains: <Lighting />, <Terrain />, <CameraController />
```

### 2. Integration Strategy

When implementing the systems described in this document:

**Option A: Enhance Terrain.tsx**

- Keep existing file structure
- Replace tree generation logic with ForestGenerator
- Replace Tree component with TreeInstances

**Option B: New ForestEnvironment Component**

- Create `src/game/components/Environment.tsx` (currently empty)
- Import all new forest systems there
- Replace `<Terrain />` with `<Environment />` in Scene.tsx

### 3. Connect to Existing Zustand Stores

```typescript
// Integrate with existing src/game/store/gameStore.ts
// Already has: cabinLocation, players with spawn points
// Add to gameStore interface:
interface GameStore {
  // ... existing fields ...

  // Add these for forest system:
  forestSeed: number
  treeData: TreeInstance[] // For collision detection
  spawnPoints: Vector3[] // Update from single spawn to 8 points

  generateForest: (seed: number) => void
}
```

### 4. Add debug controls with Leva (already installed)

```tsx
// Leva is already in package.json - add controls to any component
import { useControls } from 'leva'

function ForestDebugControls() {
  const controls = useControls('Forest', {
    seed: { value: 12345, min: 0, max: 99999, step: 1 },
    treeCount: { value: 3500, min: 1000, max: 10000, step: 100 },
    fogDensity: { value: 0.02, min: 0, max: 0.1, step: 0.001 },
    showPaths: false,
    showSpawnPoints: false,
    wireframe: false,
    regenerate: button(() => {
      gameStore.generateForest(Math.random() * 99999)
    }),
  })

  return null
}
```

---

## Performance Targets

### Minimum Requirements (60fps)

- **GPU**: GTX 1060 6GB or equivalent
- **CPU**: Intel i5-8400 or equivalent
- **RAM**: 8GB

### Performance Metrics

```typescript
const PERFORMANCE_TARGETS = {
  drawCalls: 50, // Maximum draw calls
  triangles: 500000, // Maximum triangles in view
  instances: 5000, // Maximum tree instances
  textureMemory: 256, // MB of texture memory
  fps: {
    minimum: 60,
    average: 75,
    percentile95: 65,
  },
}
```

### Optimization Checklist

- Instanced rendering for all trees
- LOD system with 3 levels + culling
- Frustum culling per frame
- Chunk-based loading beyond 150m
- Texture atlasing for tree varieties
- Baked lighting where possible
- Simplified collision meshes

---

## Task Tracking System

### Phase 1: Core Generation System ❌

- [ ] Create `src/game/systems/forest/ForestGenerator.ts` class
- [ ] Implement SimplexNoise density mapping (verify three@0.170.0 has SimplexNoise)
- [ ] Add multi-octave noise layering
- [ ] Create edge falloff gradient
- [ ] Add Poisson disc sampling algorithm (replace simple collision in Terrain.tsx)
- [ ] Test with 500 sample trees
- [ ] Verify reproducible generation with seeds

### Phase 2: Instanced Rendering Pipeline ❌

- [ ] Create `src/game/components/TreeInstances.tsx` component
- [ ] Replace individual Tree meshes (Terrain.tsx:123-139) with InstancedMesh
- [ ] Add LOD geometry definitions (high/medium/low)
- [ ] Implement distance-based LOD switching
- [ ] Add frustum culling system
- [ ] Add tree variation (4 types, height/width variance)
- [ ] Optimize material usage (single material atlas)
- [ ] Test performance with 5000 instances
- [ ] Verify 60fps on target hardware

### Phase 3: Critical Locations ❌

- [ ] Create `src/game/systems/forest/LocationPlacement.ts`
- [ ] Implement clearing detection algorithm
- [ ] Add cabin placement logic
- [ ] Generate 8 spawn points on perimeter (update gameStore.ts:49)
- [ ] Create visual markers for debug mode (use Leva)
- [ ] Test spawn point distribution
- [ ] Update gameStore to store spawnPoints array

### Phase 4: Path Network 🚧

- [ ] Create `src/game/systems/forest/FlowFieldPathfinder.ts`
- [ ] Replace radial paths (Terrain.tsx:31-59) with flow field generation
- [ ] Generate main paths (spawn to cabin)
- [ ] Add secondary wandering paths
- [ ] Create path texture/material (enhance current path rendering)
- [ ] Clear trees along paths (improve current clearance logic)

### Phase 5: Atmosphere & Polish 🚧

- [x] ✅ Basic lighting complete (Lighting.tsx)
- [x] ✅ Basic fog complete (Scene.tsx:171)
- [ ] Create `src/game/components/ForestAtmosphere.tsx` with volumetric fog shader
- [ ] Replace `fogExp2` with custom volumetric fog
- [ ] Add height-based fog falloff
- [ ] Add animated fog wisps
- [ ] Optional: Implement wind vertex shader
- [ ] Optional: Add spatial audio system

### Phase 6: Optimization ❌

- [ ] Create `src/game/systems/forest/ChunkManager.ts`
- [ ] Implement chunk loading/unloading
- [ ] Add occlusion culling system
- [ ] Implement quality presets (low/medium/high)
- [ ] Add performance monitoring with Leva
- [ ] Profile draw calls
- [ ] Test on minimum spec hardware

### Phase 7: Integration & Testing ⏳

- [x] ✅ Basic game loop exists (Scene.tsx)
- [x] ✅ Zustand store exists (gameStore.ts, playerStore.ts)
- [x] ✅ Player collision with trees (Scene.tsx:109-123)
- [x] ✅ Flashlight shadows (Lighting.tsx)
- [ ] Add multiplayer spawn synchronization (8 spawn points)
- [ ] Test with 8 concurrent players
- [ ] Create stress test scenarios
- [ ] Add error handling/fallbacks

---

## Testing Checklist

### Performance Testing

- [ ] Maintain 60fps with 5000 trees
- [ ] Test with 8 players simultaneously
- [ ] Verify LOD switching smoothness
- [ ] Check memory usage over time
- [ ] Profile GPU usage
- [ ] Test on minimum spec hardware

### Visual Testing

- [ ] Verify fog renders correctly
- [ ] Check tree variety distribution
- [ ] Test lighting at different times
- [ ] Verify path visibility
- [ ] Check spawn point accessibility
- [ ] Test cabin clearing size

### Gameplay Testing

- [ ] Players spawn at correct locations
- [ ] Paths lead to cabin
- [ ] No trees blocking critical paths
- [ ] Cabin area properly cleared
- [ ] Monster AI can navigate forest
- [ ] Players can't escape world bounds

---

## Known Constraints & Considerations

### Technical Constraints

- Must maintain 60fps on GTX 1060
- Maximum 50 draw calls
- 500k triangle budget in view
- 256MB texture memory limit
- No dynamic shadows on trees (performance)

### Design Considerations

- Trees must not block all sightlines
- Paths should be discoverable but not obvious
- Fog density affects gameplay (too thick = frustrating)
- Spawn points need equal difficulty
- Cabin must be findable from all spawns

### Future Enhancements (Post-MVP)

- Seasonal variations (fall colors, snow)
- Dynamic weather system
- Destructible trees
- Wildlife/ambient creatures
- More vegetation variety
- Cave systems
- Abandoned structures
- Dynamic day/night cycle

---

## Quick Start Commands

```bash
# Navigate to frontend package
cd packages/tdr-horror-frontend

# Dependencies already installed (pnpm workspace)
# three, @react-three/fiber, @react-three/drei, @types/three already in package.json

# Create forest system directories (if implementing new systems)
mkdir -p src/game/systems/forest
# Note: src/game/components/ already exists

# Start development server (port 8080)
pnpm run dev
```

---

## File Structure

### Current Structure (What Exists)

```
packages/tdr-horror-frontend/
├── src/
│   ├── App.tsx                    ✅ Main entry
│   ├── game/
│   │   ├── components/
│   │   │   ├── Scene.tsx          ✅ Canvas setup
│   │   │   ├── Terrain.tsx        🚧 Basic forest (2000 trees, simple paths)
│   │   │   ├── Lighting.tsx       ✅ Atmospheric lighting
│   │   │   ├── Environment.tsx    📝 Empty, ready for implementation
│   │   │   └── Player.tsx
│   │   ├── store/
│   │   │   ├── gameStore.ts       ✅ 8-player state management
│   │   │   └── playerStore.ts     ✅ Stamina system
│   │   ├── systems/
│   │   │   ├── AudioSystem.ts
│   │   │   ├── GameStateManager.ts
│   │   │   └── PhysicsSystem.ts
│   │   └── controllers/
│   │       ├── CameraController.ts
│   │       ├── FirstPersonController.ts
│   │       └── InputManager.ts
```

### Target Structure (To Be Created)

```
packages/tdr-horror-frontend/
├── src/
│   ├── game/
│   │   ├── systems/
│   │   │   └── forest/              ❌ Create this directory
│   │   │       ├── ForestGenerator.ts
│   │   │       ├── PoissonDiscSampler.ts
│   │   │       ├── LocationPlacement.ts
│   │   │       ├── FlowFieldPathfinder.ts
│   │   │       ├── ChunkManager.ts
│   │   │       └── QualityManager.ts
│   │   ├── components/
│   │   │   ├── TreeInstances.tsx    ❌ New instanced renderer
│   │   │   ├── ForestAtmosphere.tsx ❌ Volumetric fog
│   │   │   └── PathRenderer.tsx     ❌ Enhanced paths
```

---

## Success Criteria

✅ **Performance**: Consistent 60fps on target hardware
✅ **Atmosphere**: Achieves horror mood from reference image
✅ **Procedural**: Different every playthrough via seed
✅ **Multiplayer Ready**: 8 spawn points, synchronized
✅ **Navigable**: Clear paths between spawns and cabin
✅ **Optimized**: Efficient rendering with LOD and culling
✅ **Integrated**: Works with existing game systems
✅ **Documented**: Clear code and usage examples

---

_Last Updated: [Current Date]_
_Version: 1.0.0_
_Author: TDR Horror Game Development Team_
