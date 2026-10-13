import { BufferAttribute, BufferGeometry, Mesh, Object3D, Vector3 } from 'three'

/**
 * Collect every Mesh whose own name — or any ancestor's name — matches
 * `namePattern`. Walking ancestors is required because the GLB nests the
 * visible meshes (`オブジェクト_*`) under named group nodes (e.g. `floor`,
 * `floor_metal`, `wall`, `wall_metal`).
 */
export function collectMeshesByName(
  root: Object3D,
  namePattern: RegExp,
): Mesh[] {
  const meshes: Mesh[] = []
  root.traverse(node => {
    if (!(node instanceof Mesh)) {
      return
    }
    for (let p: Object3D | null = node; p; p = p.parent) {
      if (namePattern.test(p.name)) {
        meshes.push(node)
        break
      }
    }
  })
  return meshes
}

/**
 * Merge every mesh under a `namePattern`-matching ancestor into a single
 * world-space BufferGeometry (positions + indices only — all that a Rapier
 * `trimesh` collider needs). Vertices are baked through each mesh's world
 * matrix, so the caller must have called `updateMatrixWorld` on the model
 * (after any recentering) first.
 */
export function buildColliderGeometry(
  root: Object3D,
  namePattern: RegExp,
): BufferGeometry {
  const meshes = collectMeshesByName(root, namePattern)
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
