import { useMemo } from 'react'
import { create } from 'zustand'

import type { TreePosition } from 'src/game/types/game.types'

// Store for tree positions (used for collision detection)
interface TerrainStore {
  treePositions: TreePosition[]
  setTreePositions: (positions: TreePosition[]) => void
}

export const useTerrainStore = create<TerrainStore>(set => ({
  treePositions: [],
  setTreePositions: positions => set({ treePositions: positions }),
}))

// Path generation types
interface PathSegment {
  x: number
  z: number
}

interface Path {
  points: PathSegment[]
  width: number
}

/**
 * Generate winding paths radiating from spawn point
 */
function generatePaths(): Path[] {
  const paths: Path[] = []
  const numPaths = 4 // Number of main paths from spawn
  const pathLength = 200 // Length of each path
  const pathWidth = 7 // Width of paths (clearance for walking)

  for (let i = 0; i < numPaths; i++) {
    const baseAngle = (i / numPaths) * Math.PI * 2 // Evenly distribute paths
    const points: PathSegment[] = []

    // Generate path points using parametric curve
    for (let t = 0; t <= 1; t += 0.05) {
      const distance = t * pathLength

      // Add sinusoidal curve for natural winding
      const curve = Math.sin(t * Math.PI * 3) * 15 // Curve amplitude
      const angle = baseAngle + curve * 0.01

      points.push({
        x: Math.cos(angle) * distance,
        z: Math.sin(angle) * distance,
      })
    }

    paths.push({ points, width: pathWidth })
  }

  return paths
}

/**
 * Check if a point is within any path
 */
function isPointOnPath(x: number, z: number, paths: Path[]): boolean {
  for (const path of paths) {
    // Check distance to each path segment
    for (let i = 0; i < path.points.length - 1; i++) {
      const p1 = path.points[i]
      const p2 = path.points[i + 1]

      // Calculate distance from point to line segment
      const distance = distanceToSegment(x, z, p1.x, p1.z, p2.x, p2.z)

      if (distance < path.width) {
        return true
      }
    }
  }

  return false
}

/**
 * Calculate distance from point to line segment
 */
function distanceToSegment(
  px: number,
  pz: number,
  x1: number,
  z1: number,
  x2: number,
  z2: number,
): number {
  const dx = x2 - x1
  const dz = z2 - z1
  const lengthSquared = dx * dx + dz * dz

  if (lengthSquared === 0) {
    // Segment is a point
    const distX = px - x1
    const distZ = pz - z1
    return Math.sqrt(distX * distX + distZ * distZ)
  }

  // Calculate projection of point onto line segment
  let t = ((px - x1) * dx + (pz - z1) * dz) / lengthSquared
  t = Math.max(0, Math.min(1, t)) // Clamp to segment

  const projX = x1 + t * dx
  const projZ = z1 + t * dz
  const distX = px - projX
  const distZ = pz - projZ

  return Math.sqrt(distX * distX + distZ * distZ)
}

interface TreeProps {
  position: [number, number, number]
  scaleHeight: number
  scaleWidth: number
  showCollisionBox?: boolean
}

function Tree({
  position,
  scaleHeight,
  scaleWidth,
  showCollisionBox = false,
}: TreeProps) {
  // Collision radius matches the calculation in Scene.tsx
  const TREE_COLLISION_RADIUS = 2.5
  const collisionRadius = TREE_COLLISION_RADIUS * scaleWidth

  return (
    <group position={position} scale={[scaleWidth, scaleHeight, scaleWidth]}>
      {/* Trunk */}
      <mesh position={[0, 3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.4, 0.4, 6, 8]} />
        <meshStandardMaterial color="#3d2817" />
      </mesh>

      {/* Canopy */}
      <mesh position={[0, 7, 0]} castShadow receiveShadow>
        <coneGeometry args={[2.5, 4, 8]} />
        <meshStandardMaterial color="#1a3a1a" />
      </mesh>

      {/* Collision visualization (debug) */}
      {showCollisionBox && (
        <mesh position={[0, 1.7, 0]}>
          <sphereGeometry args={[collisionRadius / scaleWidth, 16, 16]} />
          {/* eslint-disable-next-line react/no-unknown-property */}
          <meshBasicMaterial color="#00ffff" wireframe={true} />
        </mesh>
      )}
    </group>
  )
}

interface TerrainProps {
  showCollisionBoxes?: boolean
}

export function Terrain({ showCollisionBoxes = false }: TerrainProps) {
  const setTreePositions = useTerrainStore(state => state.setTreePositions)

  // Generate paths once
  const paths = useMemo(() => generatePaths(), [])

  // Generate random tree positions with collision avoidance and path exclusion
  const treePositions = useMemo<TreePosition[]>(() => {
    const positions: TreePosition[] = []
    const TERRAIN_SIZE = 250
    const SAFE_ZONE = 10
    const MIN_DISTANCE = 2 // Reduced for much denser forest
    const NUM_TREES = 2000 // Significantly increased for dense forest
    const MAX_ATTEMPTS = 8000 // Increased for more tree placement attempts

    let attempts = 0
    while (positions.length < NUM_TREES && attempts < MAX_ATTEMPTS) {
      attempts++

      // Generate random position
      const x = Math.random() * TERRAIN_SIZE * 2 - TERRAIN_SIZE
      const z = Math.random() * TERRAIN_SIZE * 2 - TERRAIN_SIZE

      // Skip if in safe zone (player spawn area)
      if (Math.abs(x) < SAFE_ZONE && Math.abs(z) < SAFE_ZONE) {
        continue
      }

      // Skip if on a path
      if (isPointOnPath(x, z, paths)) {
        continue
      }

      // Check minimum distance to existing trees
      const tooClose = positions.some(pos => {
        const dx = pos.x - x
        const dz = pos.z - z
        const distance = Math.sqrt(dx * dx + dz * dz)
        return distance < MIN_DISTANCE
      })

      if (!tooClose) {
        positions.push({
          x,
          z,
          scaleHeight: 0.6 + Math.random() * 0.8, // Height variation: 0.6 to 1.4
          scaleWidth: 0.7 + Math.random() * 0.6, // Width variation: 0.7 to 1.3
        })
      }
    }

    return positions
  }, [paths])

  // Store tree positions for collision detection
  useMemo(() => {
    setTreePositions(treePositions)
  }, [treePositions, setTreePositions])

  return (
    <group>
      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial color="#3a4a2a" />
      </mesh>

      {/* Path rendering - dirt/worn ground */}
      {paths.map((path, pathIndex) =>
        path.points.map((point, i) => {
          if (i === path.points.length - 1) return null

          const nextPoint = path.points[i + 1]
          const dx = nextPoint.x - point.x
          const dz = nextPoint.z - point.z
          const distance = Math.sqrt(dx * dx + dz * dz)
          const angle = Math.atan2(dz, dx)

          // Center position between two points
          const centerX = (point.x + nextPoint.x) / 2
          const centerZ = (point.z + nextPoint.z) / 2

          return (
            <mesh
              key={`${pathIndex}-${i}`}
              position={[centerX, 0.02, centerZ]}
              rotation={[-Math.PI / 2, 0, angle]}
              receiveShadow
            >
              <planeGeometry args={[distance, path.width]} />
              <meshStandardMaterial color="#4a3a2a" />
            </mesh>
          )
        }),
      )}

      {/* Trees */}
      {treePositions.map((pos, i) => (
        <Tree
          key={i}
          position={[pos.x, 0, pos.z]}
          scaleHeight={pos.scaleHeight}
          scaleWidth={pos.scaleWidth}
          showCollisionBox={showCollisionBoxes}
        />
      ))}
    </group>
  )
}
