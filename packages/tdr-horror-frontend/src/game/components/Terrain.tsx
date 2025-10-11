import { useMemo } from 'react'

interface TreePosition {
  x: number
  z: number
  scale: number
}

interface TreeProps {
  position: [number, number, number]
  scale: number
}

function Tree({ position, scale }: TreeProps) {
  return (
    <group position={position} scale={scale}>
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
    </group>
  )
}

export function Terrain() {
  // Generate random tree positions with collision avoidance
  const treePositions = useMemo<TreePosition[]>(() => {
    const positions: TreePosition[] = []
    const TERRAIN_SIZE = 250
    const SAFE_ZONE = 10
    const MIN_DISTANCE = 8
    const NUM_TREES = 40
    const MAX_ATTEMPTS = 500

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
          scale: 0.8 + Math.random() * 0.4, // Scale variation: 0.8 to 1.2
        })
      }
    }

    return positions
  }, [])

  return (
    <group>
      {/* Ground plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[500, 500]} />
        <meshStandardMaterial color="#3a4a2a" />
      </mesh>

      {/* Trees */}
      {treePositions.map((pos, i) => (
        <Tree key={i} position={[pos.x, 0, pos.z]} scale={pos.scale} />
      ))}
    </group>
  )
}
