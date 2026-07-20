import { BufferAttribute, BufferGeometry, Mesh, Object3D, Vector3 } from 'three'

// The cinema GLB's `floor` and `floor_metal` nodes together cover essentially
// the entire walkable interior — measured ~2,118 triangles, with floor meshes
// under >98% of the interior footprint (the only gaps are a thin strip at the
// very back edge, against the wall). Trimeshing just those two nodes gives an
// accurate, cheap collider that follows the real raked/tiered floor.
//
// This replaces an earlier synthetic flat 2-triangle ramp. That ramp spanned
// wall-to-wall at a single shallow slope, so it floated up to ~2 m ABOVE the
// true floor in the lower/side parts of the room. Because ecctrl holds the
// camera a fixed height above whatever collider is beneath it, that made the
// player's eye-height swing by ~2 m across the room — feeling correct on the
// back tiers (where ramp ≈ floor) but wildly too tall lower down (where the
// ramp floated above the real floor). See PLAN.md §3, which prescribed a
// trimesh floor collider from the start.
const FLOOR_NAME_RE = /floor/i

/**
 * Collect every Mesh whose own name — or any ancestor's name — matches the
 * floor naming pattern. Walking ancestors is required because the GLB nests
 * the visible meshes (`オブジェクト_*`) under named group nodes (`floor`,
 * `floor_metal`).
 */
export function collectFloorMeshes(root: Object3D): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse(node => {
    if (!(node instanceof Mesh)) {
      return
    }
    for (let p: Object3D | null = node; p; p = p.parent) {
      if (FLOOR_NAME_RE.test(p.name)) {
        meshes.push(node)
        break
      }
    }
  })
  return meshes
}

/**
 * Merge the floor meshes into a single world-space BufferGeometry (positions +
 * indices only — all that a Rapier `trimesh` collider needs). Vertices are
 * baked through each mesh's world matrix, so the caller must have called
 * `updateMatrixWorld` on the model (after any recentering) first.
 */
export function buildFloorColliderGeometry(root: Object3D): BufferGeometry {
  const meshes = collectFloorMeshes(root)
  const positions: number[] = []
  const indices: number[] = []
  const v = new Vector3()
  let offset = 0

  for (const mesh of meshes) {
    mesh.updateWorldMatrix(true, false)
    const geom = mesh.geometry
    const position = geom.getAttribute('position')
    const index = geom.getIndex()

    for (let i = 0; i < position.count; i++) {
      v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld)
      positions.push(v.x, v.y, v.z)
    }

    if (index) {
      for (let i = 0; i < index.count; i++) {
        indices.push(index.getX(i) + offset)
      }
    } else {
      for (let i = 0; i < position.count; i++) {
        indices.push(i + offset)
      }
    }

    offset += position.count
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(new Float32Array(positions), 3),
  )
  geometry.setIndex(new BufferAttribute(new Uint32Array(indices), 1))
  return geometry
}
