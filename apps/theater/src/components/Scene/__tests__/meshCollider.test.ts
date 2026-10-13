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
  buildColliderGeometry,
  collectMeshesByName,
} from 'src/components/Scene/meshCollider'

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

// A flat vertical quad (2 triangles) at fixed x, spanning y∈[y0,y1] and
// z∈[z0,z1] — a stand-in for a wall panel.
function makeWall(
  x: number,
  y0: number,
  y1: number,
  z0: number,
  z1: number,
): Mesh {
  const geometry = new BufferGeometry()
  geometry.setAttribute(
    'position',
    new BufferAttribute(
      new Float32Array([x, y0, z0, x, y0, z1, x, y1, z0, x, y1, z1]),
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
// step under `floor`, a third level under `floor_metal`, a wall panel under
// `wall`, a door frame panel under `frame`, plus a `seats` node that must be
// ignored by both patterns.
function makeStubModel(): Object3D {
  const root = new Group()
  root.add(
    named('floor', makeStep(1, -2, 0), makeStep(0, 0, 2)),
    named('floor_metal', makeStep(0.5, 2, 3)),
    named('wall', makeWall(2, 0, 3, -1, 1)),
    named('frame', makeWall(-2, 0, 3, -1, 1)),
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

// Casts horizontally from `fromX` toward +X (or -X) and returns the hit x, if
// any — the wall-collision analogue of surfaceYAt.
function surfaceXAt(
  mesh: Mesh,
  y: number,
  z: number,
  fromX: number,
  dir: 1 | -1,
): number | null {
  const ray = new Raycaster(new Vector3(fromX, y, z), new Vector3(dir, 0, 0))
  const hit = ray.intersectObject(mesh, false)[0]
  return hit ? hit.point.x : null
}

describe('collectMeshesByName', () => {
  it('collects only meshes under floor / floor_metal nodes', () => {
    const meshes = collectMeshesByName(makeStubModel(), /floor/i)
    expect(meshes).toHaveLength(3)
  })

  it('collects only meshes under wall / frame nodes', () => {
    const meshes = collectMeshesByName(makeStubModel(), /wall|frame/i)
    expect(meshes).toHaveLength(2)
  })
})

describe('buildColliderGeometry (floor pattern)', () => {
  it('merges every floor triangle into one geometry', () => {
    const geometry = buildColliderGeometry(makeStubModel(), /floor/i)
    // 3 quads × 4 verts / 6 indices.
    expect(geometry.getAttribute('position').count).toBe(12)
    expect(geometry.getIndex()?.count).toBe(18)
  })

  // The core regression guard: the collider must FOLLOW the discrete steps.
  // The previous flat 2-triangle ramp cut a diagonal between the room's
  // extremes, so at the middle of each tread it read a sloped height instead
  // of the true tread height — which is what floated the camera too high.
  it('reproduces each step height instead of a diagonal ramp', () => {
    const geometry = buildColliderGeometry(makeStubModel(), /floor/i)
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

    const geometry = buildColliderGeometry(root, /floor/i)
    geometry.computeBoundingBox()
    expect(geometry.boundingBox?.min.y).toBeCloseTo(2, 5)
    expect(geometry.boundingBox?.max.y).toBeCloseTo(2, 5)
  })
})

describe('buildColliderGeometry (wall pattern)', () => {
  // The regression this guards against: walls previously had no collider at
  // all (only far-out bounding-box cuboids), so a player could walk straight
  // through an interior wall panel. The merged wall geometry must actually
  // block a horizontal ray at the panel's real position.
  it('blocks a horizontal ray at each wall panel and nowhere else', () => {
    const geometry = buildColliderGeometry(makeStubModel(), /wall|frame/i)
    const collider = new Mesh(
      geometry,
      new MeshBasicMaterial({ side: DoubleSide }),
    )

    expect(surfaceXAt(collider, 1, 0, 0, 1)).toBeCloseTo(2, 5)
    expect(surfaceXAt(collider, 1, 0, 0, -1)).toBeCloseTo(-2, 5)
    // Outside the panels' z-range, there is no wall to hit.
    expect(surfaceXAt(collider, 1, 5, 0, 1)).toBeNull()
    // Above the panels' y-range, there is no wall to hit.
    expect(surfaceXAt(collider, 10, 0, 0, 1)).toBeNull()
  })

  it('excludes floor and seats geometry', () => {
    const geometry = buildColliderGeometry(makeStubModel(), /wall|frame/i)
    // 2 wall quads × 4 verts / 6 indices — floor's 3 quads must not be merged in.
    expect(geometry.getAttribute('position').count).toBe(8)
    expect(geometry.getIndex()?.count).toBe(12)
  })
})
