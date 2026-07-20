'use client'

import { useGLTF } from '@react-three/drei'
import { CuboidCollider, RigidBody } from '@react-three/rapier'
import { useMemo } from 'react'
import { Box3, Mesh, Vector3 } from 'three'

import { buildFloorColliderGeometry } from './floorCollider'

const MODEL_URL = '/models/cinema.glb'
const WALL_THICKNESS = 0.2

// A flat safety net just below the lowest floor point. The trimesh floor
// covers >98% of the interior; this catches the player in the thin uncovered
// strip at the very back edge so they can never fall out of the world. It sits
// below every real floor surface, so ecctrl always floats on the real floor
// where one exists and only ever rests on the net inside a genuine gap.
const SAFETY_NET_HALF = 0.1

export function Theater() {
  const { scene } = useGLTF(MODEL_URL)

  const { model, bounds, floorGeometry } = useMemo(() => {
    // Clone so we never mutate (and never risk double-recentering) the
    // shared cache useGLTF returns for this URL.
    const model = scene.clone()
    model.traverse(child => {
      if (child instanceof Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    const box = new Box3().setFromObject(model)
    const center = box.getCenter(new Vector3())
    model.position.set(-center.x, -box.min.y, -center.z)
    model.updateMatrixWorld(true)

    const bounds = new Box3().setFromObject(model)
    // Trimesh the real `floor`/`floor_metal` meshes so the walkable collider
    // follows the actual raked/tiered floor (see floorCollider.ts for why the
    // previous synthetic flat ramp made the player feel too tall lower down).
    const floorGeometry = buildFloorColliderGeometry(model)

    return { model, bounds, floorGeometry }
  }, [scene])

  const width = bounds.max.x - bounds.min.x
  const depth = bounds.max.z - bounds.min.z
  const height = bounds.max.y - bounds.min.y
  const centerX = (bounds.min.x + bounds.max.x) / 2
  const centerY = (bounds.min.y + bounds.max.y) / 2
  const centerZ = (bounds.min.z + bounds.max.z) / 2

  return (
    <>
      <primitive object={model} dispose={null} />

      {/* Accurate walkable floor: a trimesh of the real floor meshes only
          (~2k tris) — never the full 392k-tri model. includeInvisible is
          required: react-three-rapier's auto-collider scan uses
          traverseVisible by default, which silently skips (and generates NO
          collider for) any mesh with visible={false}. */}
      <RigidBody type="fixed" colliders="trimesh" includeInvisible>
        <mesh geometry={floorGeometry} visible={false} dispose={null} />
      </RigidBody>

      {/* Perimeter walls + a flat safety net, as plain cuboids not tied to
          specific meshes. */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider
          args={[WALL_THICKNESS / 2, height / 2, depth / 2]}
          position={[bounds.min.x, centerY, centerZ]}
        />
        <CuboidCollider
          args={[WALL_THICKNESS / 2, height / 2, depth / 2]}
          position={[bounds.max.x, centerY, centerZ]}
        />
        <CuboidCollider
          args={[width / 2, height / 2, WALL_THICKNESS / 2]}
          position={[centerX, centerY, bounds.min.z]}
        />
        <CuboidCollider
          args={[width / 2, height / 2, WALL_THICKNESS / 2]}
          position={[centerX, centerY, bounds.max.z]}
        />
        <CuboidCollider
          args={[width / 2, SAFETY_NET_HALF, depth / 2]}
          position={[centerX, bounds.min.y - SAFETY_NET_HALF, centerZ]}
        />
      </RigidBody>
    </>
  )
}
