import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Raycaster,
  Vector3,
} from 'three'

import {
  buildFloorColliderGeometry,
  collectFloorMeshes,
} from 'src/components/Scene/floorCollider'

// A flat horizontal quad (2 triangles) at height `y`, spanning x∈[-1,1] and
// z∈[z0,z1], with an upward-facing surface.
function makeStep(y: number, z0: number, z1: number): Mesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([-1, y, z0, 1, y, z0, -1, y, z1, 1, y, z1]),
      3,
    ),
  )
  geometry.setIndex(new BufferAttribute(new Uint32Array([0, 2, 1, 1, 2, 3]), 1))
  return new Mesh(geometry, new MeshBasicMaterial({ side: DoubleSide }))
}

function named(name: string, ...children: Object3D[]): Group {
  const group = new Group()
  group.name = name
  children.forEach(c => group.add(c))
  return group
}

// A stepped stand-in for the cinema floor: a high back step and a low front
// step under `floor`, a third level under `floor_metal`, plus a `seats` node
// that must be ignored.
function makeStubModel(): Object3D {
  const root = new Group()
  root.add(
    named('floor', makeStep(1, -2, 0), makeStep(0, 0, 2)),
    named('floor_metal', makeStep(0.5, 2, 3)),
    named('seats', makeStep(5, -2, 3)),
  )
  root.updateMatrixWorld(true)
  return root
}

function surfaceYAt(mesh: Mesh, x: number, z: number): number | null {
  const ray = new Raycaster(new Vector3(x, 100, z), new Vector3(0, -1, 0))
  const hit = ray.intersectObject(mesh, false)[0]
  return hit ? hit.point.y : null
}

describe('collectFloorMeshes', () => {
  it('collects only meshes under floor / floor_metal nodes', () => {
    const meshes = collectFloorMeshes(makeStubModel())
    expect(meshes).toHaveLength(3)
  })
})

describe('buildFloorColliderGeometry', () => {
  it('merges every floor triangle into one geometry', () => {
    const geometry = buildFloorColliderGeometry(makeStubModel())
    // 3 quads × 4 verts / 6 indices.
    expect(geometry.getAttribute('position').count).toBe(12)
    expect(geometry.getIndex()?.count).toBe(18)
  })

  // The core regression guard: the collider must FOLLOW the discrete steps.
  // The previous flat 2-triangle ramp cut a diagonal between the room's
  // extremes, so at the middle of each tread it read a sloped height instead
  // of the true tread height — which is what floated the camera too high.
  it('reproduces each step height instead of a diagonal ramp', () => {
    const geometry = buildFloorColliderGeometry(makeStubModel())
    const collider = new Mesh(
      geometry,
      new MeshBasicMaterial({ side: DoubleSide }),
    )

    // Center of the high back step, low front step, and floor_metal step.
    expect(surfaceYAt(collider, 0, -1)).toBeCloseTo(1, 5)
    expect(surfaceYAt(collider, 0, 1)).toBeCloseTo(0, 5)
    expect(surfaceYAt(collider, 0, 2.5)).toBeCloseTo(0.5, 5)

    // A flat ramp between the extremes (y=1 at z=-2 → y=0 at z=3) would read
    // ~0.6 at z=-1 and ~0.4 at z=1; assert we are nowhere near that.
    expect(surfaceYAt(collider, 0, -1)).toBeGreaterThan(0.9)
    expect(surfaceYAt(collider, 0, 1)).toBeLessThan(0.1)
  })

  it('bakes world transforms so offset floors land at the right height', () => {
    const step = makeStep(0, -1, 1)
    step.position.set(0, 2, 0)
    const root = named('floor', step)
    root.updateMatrixWorld(true)

    const geometry = buildFloorColliderGeometry(root)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.min.y).toBeCloseTo(2, 5)
    expect(geometry.boundingBox?.max.y).toBeCloseTo(2, 5)
  })
})
