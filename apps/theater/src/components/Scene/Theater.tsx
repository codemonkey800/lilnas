'use client'

import { useGLTF } from '@react-three/drei'
import { RigidBody } from '@react-three/rapier'
import { useMemo } from 'react'
import { Box3, Mesh, Vector3 } from 'three'

import { buildColliderGeometry } from './meshCollider'

const MODEL_URL = '/models/cinema.glb'

// The cinema GLB's `floor` and `floor_metal` nodes together cover essentially
// the entire walkable interior — measured ~2,118 triangles, with floor meshes
// under >98% of the interior footprint. Trimeshing just those two nodes gives
// an accurate, cheap collider that follows the real raked/tiered floor.
//
// This replaces an earlier synthetic flat 2-triangle ramp. That ramp spanned
// wall-to-wall at a single shallow slope, so it floated up to ~2 m ABOVE the
// true floor in the lower/side parts of the room. Because ecctrl holds the
// camera a fixed height above whatever collider is beneath it, that made the
// player's eye-height swing by ~2 m across the room.
const FLOOR_NAME_RE = /floor/i

// The real wall/frame geometry — `wall`, `wall_2`, `wall_metal`, `wall_screen`
// (the screen-end wall panel), and `frame` (the exit door frame) — matches
// `/wall|frame/i` on every named group in the GLB with no accidental hits.
//
// This replaces four AABB cuboids placed at the model's bounding-box extremes
// (X = ±2.83, Z = ±5.60). Those cuboids sat past the real walls: the floor
// mesh only spans Z∈[-4.10, 4.05] (screen end at +Z, exit end at -Z), so the
// ~1.5 m gap between the floor's edge and each cuboid was walkable and
// floorless — falling straight through it and out of the world. The interior
// `wall`/`wall_metal` panels also had no collider at all, so a player could
// walk straight through them. Trimeshing the real geometry fixes both: walls
// are solid exactly where the model shows them, and the cuboids' only actual
// job (blocking the true room perimeter) is now done more accurately by
// `wall_2`, which already spans the full recentered footprint.
const WALL_NAME_RE = /wall|frame/i

export function Theater() {
  const { scene } = useGLTF(MODEL_URL)

  const { model, floorGeometry, wallGeometry } = useMemo(() => {
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

    // Trimesh the real `floor`/`floor_metal` and `wall`/`wall_2`/`wall_metal`/
    // `wall_screen`/`frame` meshes so both the walkable floor and the room's
    // walls follow the actual geometry (see the name-pattern comments above).
    const floorGeometry = buildColliderGeometry(model, FLOOR_NAME_RE)
    const wallGeometry = buildColliderGeometry(model, WALL_NAME_RE)

    return { model, floorGeometry, wallGeometry }
  }, [scene])

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

      {/* Accurate walls: a trimesh of the real wall/frame meshes only
          (~30k tris) — replaces the previous bounding-box cuboids, which
          floated past the floor's real edge and left the interior walls
          uncollided (see the WALL_NAME_RE comment above). */}
      <RigidBody type="fixed" colliders="trimesh" includeInvisible>
        <mesh geometry={wallGeometry} visible={false} dispose={null} />
      </RigidBody>
    </>
  )
}
