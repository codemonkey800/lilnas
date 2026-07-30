/**
 * Seat table generator for the theater app (PLAN.md's "F1 -- the seat
 * table").
 *
 * Parses `public/models/cinema.glb` directly -- a binary glTF using
 * `EXT_meshopt_compression` + `KHR_mesh_quantization` (PLAN.md's "Seat data
 * -- measured, not assumed" section) -- finds the 42 cushion (`垫`) mesh
 * nodes, one per seat, and writes their world-space positions to
 * `src/components/Scene/seats.ts`.
 *
 * Local-only asset tooling, same convention as `convert.ts`: read once,
 * commit the output, never re-derive at runtime.
 *
 * Usage:
 *   pnpm --filter @lilnas/theater seats
 *
 * Re-run only if cinema.glb's seat geometry changes.
 *
 * Two things this script deliberately does NOT do, and why:
 *
 *   - It never replays the meshopt decompression algorithm over the
 *     compressed vertex buffers. `EXT_meshopt_compression` repoints every
 *     bufferView at a "fallback" buffer with no real bytes behind it (this
 *     file's second `buffers[]` entry is ~7 MB and simply isn't present --
 *     that's what `extensionsRequired` enforces, so a non-supporting reader
 *     is expected to refuse the file rather than read garbage), so getting
 *     real per-vertex data would mean reimplementing the meshopt codec. But
 *     every POSITION accessor already carries spec-required, exact `min`/
 *     `max` bounds -- glTF mandates these regardless of any bufferView-level
 *     compression -- and a seat's cushion is exactly what a bounding box
 *     needs: its world-space extremes. De-quantizing those two corners (the
 *     same `max(v / 32767, -1)` SHORT formula PLAN.md calls out) and
 *     composing them through the owning node's world matrix reproduces
 *     PLAN.md's independently-measured reference numbers to three decimal
 *     places (verified while writing this script).
 *   - It never calls into three.js's `GLTFLoader`. That loader wants a DOM
 *     (`document`/`Image`) to resolve materials/textures, which don't exist
 *     under plain Node, and this script never touches a texture. Parsing
 *     the ~500 KB JSON chunk directly and composing node TRS matrices with
 *     three's own math classes (`Matrix4`/`Vector3`/`Quaternion` -- no
 *     renderer, no DOM) is simpler and has no such dependency.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Matrix4, Quaternion, Vector3 } from 'three'

const MODEL_PATH = join(__dirname, '../public/models/cinema.glb')
const OUTPUT_PATH = join(__dirname, '../src/components/Scene/seats.ts')

const ROWS = 6
const COLS = 7

// The cushion family is the seat anchor (PLAN.md's "Seat data" section) --
// exactly one node per seat, 42 total. The substring is unambiguous: no
// other furniture family (base `底`, backrest `靠背`/`靠背_木头`, or the
// four armrest/divider families) contains it.
const CUSHION_NAME_RE = /垫/

function fail(message: string): never {
  console.error(`✗ ${message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Minimal glTF JSON types -- only the fields this script reads.
// ---------------------------------------------------------------------------

interface GltfNode {
  name?: string
  children?: number[]
  mesh?: number
  translation?: [number, number, number]
  rotation?: [number, number, number, number]
  scale?: [number, number, number]
  matrix?: number[]
}

interface GltfAccessor {
  componentType: number
  type: string
  normalized?: boolean
  min?: number[]
  max?: number[]
}

interface GltfPrimitive {
  attributes: Record<string, number>
}

interface GltfMesh {
  name?: string
  primitives: GltfPrimitive[]
}

interface Gltf {
  scene?: number
  scenes: { nodes: number[] }[]
  nodes: GltfNode[]
  meshes: GltfMesh[]
  accessors: GltfAccessor[]
}

// ---------------------------------------------------------------------------
// GLB container parsing -- a 12-byte header followed by length-prefixed
// chunks (https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#glb-file-format).
// Only the JSON chunk is read: every position this script needs comes from
// accessor min/max, never the (meshopt-compressed) BIN chunk.
// ---------------------------------------------------------------------------

const GLB_MAGIC = 0x46546c67 // 'glTF'
const CHUNK_TYPE_JSON = 0x4e4f534a // 'JSON'

function readGltfJson(path: string): Gltf {
  const buf = readFileSync(path)
  if (buf.readUInt32LE(0) !== GLB_MAGIC) {
    fail(`${path}: not a binary glTF (bad magic)`)
  }

  let offset = 12
  while (offset < buf.length) {
    const chunkLength = buf.readUInt32LE(offset)
    const chunkType = buf.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    if (chunkType === CHUNK_TYPE_JSON) {
      return JSON.parse(
        buf.toString('utf8', chunkStart, chunkStart + chunkLength),
      ) as Gltf
    }
    offset = chunkStart + chunkLength
  }
  fail(`${path}: no JSON chunk found`)
}

// ---------------------------------------------------------------------------
// KHR_mesh_quantization de-quantization -- mirrors three.js's own
// `MathUtils.denormalize` (its SHORT case is exactly PLAN.md's
// `max(v / 32767, -1)`), reimplemented here since this script never
// constructs a three.js `BufferAttribute` to call it on.
// ---------------------------------------------------------------------------

function denormalizeComponent(value: number, componentType: number): number {
  switch (componentType) {
    case 5126: // FLOAT
      return value
    case 5125: // UNSIGNED_INT
      return value / 4294967295
    case 5123: // UNSIGNED_SHORT
      return value / 65535
    case 5122: // SHORT
      return Math.max(value / 32767, -1)
    case 5121: // UNSIGNED_BYTE
      return value / 255
    case 5120: // BYTE
      return Math.max(value / 127, -1)
    default:
      fail(`unsupported accessor componentType ${componentType}`)
  }
}

function denormalizeVec3(
  [x, y, z]: number[],
  componentType: number,
  normalized: boolean | undefined,
): Vector3 {
  if (x === undefined || y === undefined || z === undefined) {
    fail('expected a 3-component min/max')
  }
  if (!normalized) return new Vector3(x, y, z)
  return new Vector3(
    denormalizeComponent(x, componentType),
    denormalizeComponent(y, componentType),
    denormalizeComponent(z, componentType),
  )
}

// ---------------------------------------------------------------------------
// Node world matrices -- composed from the scene root(s) down, so a mesh's
// world matrix already includes the scale/translation gltfpack bakes onto
// each mesh-owning node to compensate for quantization (PLAN.md: "positions
// are normalized SHORTs that must be de-quantized before the node scale is
// applied -- a naive read gives coordinates ~32767x too large").
// ---------------------------------------------------------------------------

function localMatrix(node: GltfNode): Matrix4 {
  const matrix = new Matrix4()
  if (node.matrix) {
    return matrix.fromArray(node.matrix)
  }
  const [tx, ty, tz] = node.translation ?? [0, 0, 0]
  const [rx, ry, rz, rw] = node.rotation ?? [0, 0, 0, 1]
  const [sx, sy, sz] = node.scale ?? [1, 1, 1]
  return matrix.compose(
    new Vector3(tx, ty, tz),
    new Quaternion(rx, ry, rz, rw),
    new Vector3(sx, sy, sz),
  )
}

function computeWorldMatrices(gltf: Gltf): Map<number, Matrix4> {
  const worldByNode = new Map<number, Matrix4>()

  function visit(nodeIndex: number, parentWorld: Matrix4): void {
    const node = gltf.nodes[nodeIndex]
    if (!node) fail(`missing node ${nodeIndex}`)
    const world = parentWorld.clone().multiply(localMatrix(node))
    worldByNode.set(nodeIndex, world)
    for (const child of node.children ?? []) visit(child, world)
  }

  const sceneIndex = gltf.scene ?? 0
  const scene = gltf.scenes[sceneIndex]
  if (!scene) fail(`missing scene ${sceneIndex}`)
  for (const rootIndex of scene.nodes) visit(rootIndex, new Matrix4())

  return worldByNode
}

// ---------------------------------------------------------------------------
// World-space bounding boxes.
// ---------------------------------------------------------------------------

interface Bounds {
  min: Vector3
  max: Vector3
}

function newEmptyBounds(): Bounds {
  return {
    min: new Vector3(Infinity, Infinity, Infinity),
    max: new Vector3(-Infinity, -Infinity, -Infinity),
  }
}

function accessorLocalBounds(gltf: Gltf, accessorIndex: number): Bounds {
  const accessor = gltf.accessors[accessorIndex]
  if (!accessor) fail(`missing accessor ${accessorIndex}`)
  if (accessor.type !== 'VEC3') {
    fail(`accessor ${accessorIndex} is not a VEC3 (got ${accessor.type})`)
  }
  if (!accessor.min || !accessor.max) {
    fail(`accessor ${accessorIndex} is missing min/max bounds`)
  }
  return {
    min: denormalizeVec3(
      accessor.min,
      accessor.componentType,
      accessor.normalized,
    ),
    max: denormalizeVec3(
      accessor.max,
      accessor.componentType,
      accessor.normalized,
    ),
  }
}

// Reused across calls instead of allocating a fresh Vector3 per corner --
// this app's established convention for a hot-ish loop (gaze.ts's
// module-level scratch vectors are the precedent).
const corner = new Vector3()

/**
 * Expands `bounds` by every corner of `mesh`'s primitives' local AABBs,
 * transformed into world space by `world` -- mirrors three.js's own default
 * (non-precise) `Box3.expandByObject`, which is what `Theater.tsx`'s
 * recentering (`new Box3().setFromObject(model)`) relies on. Transforming
 * all 8 corners (rather than just a local center point) stays correct even
 * if a future model revision adds rotation somewhere in the chain; today
 * every node in cinema.glb is translate/scale-only (verified while writing
 * this script).
 */
function expandByMeshWorldBounds(
  gltf: Gltf,
  mesh: GltfMesh,
  world: Matrix4,
  bounds: Bounds,
): void {
  for (const primitive of mesh.primitives) {
    const accessorIndex = primitive.attributes.POSITION
    if (accessorIndex === undefined) continue
    const local = accessorLocalBounds(gltf, accessorIndex)

    for (const x of [local.min.x, local.max.x]) {
      for (const y of [local.min.y, local.max.y]) {
        for (const z of [local.min.z, local.max.z]) {
          corner.set(x, y, z).applyMatrix4(world)
          bounds.min.min(corner)
          bounds.max.max(corner)
        }
      }
    }
  }
}

function computeModelBounds(
  gltf: Gltf,
  worldByNode: Map<number, Matrix4>,
): Bounds {
  const bounds = newEmptyBounds()
  gltf.nodes.forEach((node, index) => {
    if (node.mesh === undefined) return
    const mesh = gltf.meshes[node.mesh]
    if (!mesh) fail(`node ${index} references missing mesh ${node.mesh}`)
    const world = worldByNode.get(index)
    if (!world) fail(`node ${index} has no computed world matrix`)
    expandByMeshWorldBounds(gltf, mesh, world, bounds)
  })
  return bounds
}

/**
 * Mirrors `Theater.tsx`'s `model.position.set(-center.x, -box.min.y,
 * -center.z)` exactly -- the offset every world-space coordinate in this
 * script must add to match what players see at runtime.
 */
function recenterOffset(bounds: Bounds): Vector3 {
  const center = bounds.min.clone().add(bounds.max).multiplyScalar(0.5)
  return new Vector3(-center.x, -bounds.min.y, -center.z)
}

// ---------------------------------------------------------------------------
// Cushion nodes -> seat samples -> rows/columns.
// ---------------------------------------------------------------------------

interface CushionSample {
  x: number
  y: number // cushion TOP -- the bbox's max Y, not its vertical centre.
  z: number
}

function findCushionSamples(
  gltf: Gltf,
  worldByNode: Map<number, Matrix4>,
  offset: Vector3,
): CushionSample[] {
  const samples: CushionSample[] = []

  gltf.nodes.forEach((node, index) => {
    if (!node.name || !CUSHION_NAME_RE.test(node.name)) return
    if (node.mesh === undefined) {
      fail(`cushion node "${node.name}" (${index}) has no mesh`)
    }
    const mesh = gltf.meshes[node.mesh]
    if (!mesh) fail(`node ${index} references missing mesh ${node.mesh}`)
    const world = worldByNode.get(index)
    if (!world) fail(`node ${index} has no computed world matrix`)

    const bounds = newEmptyBounds()
    expandByMeshWorldBounds(gltf, mesh, world, bounds)

    samples.push({
      x: (bounds.min.x + bounds.max.x) / 2 + offset.x,
      y: bounds.max.y + offset.y,
      z: (bounds.min.z + bounds.max.z) / 2 + offset.z,
    })
  })

  return samples
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000
}

interface SeatCell {
  col: number
  x: number
  y: number
  z: number
}

interface SeatRow {
  row: number
  cols: SeatCell[]
}

/** Row 0 = front, nearest the screen = largest z (PLAN.md's "Seat data" section). */
function buildRows(samples: CushionSample[]): SeatRow[] {
  const expected = ROWS * COLS
  if (samples.length !== expected) {
    fail(
      `expected ${expected} cushion nodes (${ROWS} rows x ${COLS} cols), found ${samples.length}`,
    )
  }

  const byZDescending = [...samples].sort((a, b) => b.z - a.z)

  const rows: SeatRow[] = []
  for (let row = 0; row < ROWS; row++) {
    const rowSamples = byZDescending.slice(row * COLS, (row + 1) * COLS)
    if (rowSamples.length !== COLS) {
      fail(`row ${row}: expected ${COLS} seats, found ${rowSamples.length}`)
    }
    const byXAscending = [...rowSamples].sort((a, b) => a.x - b.x)
    rows.push({
      row,
      cols: byXAscending.map((sample, col) => ({
        col,
        x: round(sample.x),
        y: round(sample.y),
        z: round(sample.z),
      })),
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// Output file rendering.
// ---------------------------------------------------------------------------

function renderSeatsFile(rows: SeatRow[]): string {
  const seatEntries = rows
    .flatMap(row =>
      row.cols.map(
        seat =>
          `  { id: 'r${row.row}s${seat.col}', row: ${row.row}, col: ${seat.col}, cushion: [${seat.x}, ${seat.y}, ${seat.z}], yaw: 0 },`,
      ),
    )
    .join('\n')

  return `// AUTO-GENERATED by \`scripts/seats.ts\` from \`public/models/cinema.glb\` --
// do not hand-edit the SEATS array below. The three constants and the two
// helper functions after it are normal hand-maintained code that this
// generator also owns writing out (PLAN.md's F1 section: "generated, but
// written as a normal committed source file"); re-run after cinema.glb's
// seat geometry changes:
//
//   pnpm --filter @lilnas/theater seats
//
// See PLAN.md's "Seat data -- measured, not assumed" section and
// ORCHESTRATE.md §1's seats.ts contract block.

import { MathUtils, Vector3 } from 'three'

import { gazeAlignment } from './gaze'

export type Seat = {
  id: string // \`r{row}s{col}\`, row 0..5, col 0..6
  row: number
  col: number
  cushion: [number, number, number] // world-space cushion-top centre
  yaw: number // 0 for every seat (all face +Z / the screen)
}

export const SEATS: Seat[] = [
${seatEntries}
]

// Local camera height above the cushion when seated. Eyeballed starting
// value, documented as needing one visual pass -- this app's established
// convention for "no live browser to measure against" (cf. Avatar.tsx's
// NATURAL_SPEED_MPS).
export const SEATED_EYE_ABOVE_CUSHION = 0.65

// How close to a seat's cushion (from the camera) you must be to claim it
// (D9). Eyeballed, tune later.
export const SEAT_TARGET_MAX_DISTANCE_M = 2.2

// The floor for "looking roughly at the seat block at all" (D9) -- the
// *choice* of which free seat wins is best-alignment-wins (see
// findGazedFreeSeat below), so this only needs to exclude "looking at the
// ceiling while standing near a seat," hence a much looser cone than
// gaze.ts's tighter 12-degree nametag cone.
export const SEAT_TARGET_MIN_ALIGNMENT_COS = Math.cos(MathUtils.degToRad(35))

const seatsById = new Map(SEATS.map(seat => [seat.id, seat]))

export function getSeat(id: string): Seat | undefined {
  return seatsById.get(id)
}

// Reused across calls instead of allocating a fresh Vector3 per candidate
// seat -- mirrors gaze.ts's own module-level scratch vector convention.
const cushionScratch = new Vector3()

/**
 * D9's sit target: among free seats within \`SEAT_TARGET_MAX_DISTANCE_M\` of
 * \`camPos\` (distance to \`cushion\`), returns whichever has the best
 * \`gazeAlignment\` against its cushion, or \`null\` if even the best doesn't
 * clear \`SEAT_TARGET_MIN_ALIGNMENT_COS\`. No occlusion raycast, unlike
 * NameTag.tsx's gaze test -- the seating block is one open room well inside
 * the max distance, so "in range" already implies "not behind a wall"
 * (PLAN.md's F1 section).
 */
export function findGazedFreeSeat(
  camPos: Vector3,
  camForward: Vector3,
  occupied: ReadonlySet<string>,
): Seat | null {
  let best: Seat | null = null
  let bestAlignment = -Infinity

  for (const seat of SEATS) {
    if (occupied.has(seat.id)) continue

    cushionScratch.set(seat.cushion[0], seat.cushion[1], seat.cushion[2])
    if (cushionScratch.distanceTo(camPos) > SEAT_TARGET_MAX_DISTANCE_M) {
      continue
    }

    const alignment = gazeAlignment(camPos, camForward, cushionScratch)
    if (alignment > bestAlignment) {
      bestAlignment = alignment
      best = seat
    }
  }

  if (best === null || bestAlignment < SEAT_TARGET_MIN_ALIGNMENT_COS) {
    return null
  }
  return best
}
`
}

function main(): void {
  const gltf = readGltfJson(MODEL_PATH)
  const worldByNode = computeWorldMatrices(gltf)
  const modelBounds = computeModelBounds(gltf, worldByNode)
  const offset = recenterOffset(modelBounds)
  const samples = findCushionSamples(gltf, worldByNode, offset)
  const rows = buildRows(samples)

  writeFileSync(OUTPUT_PATH, renderSeatsFile(rows), 'utf8')

  console.log(`✓ wrote ${ROWS * COLS} seats to ${OUTPUT_PATH}`)
  for (const row of rows) {
    const xs = row.cols.map(cell => cell.x).join(', ')
    console.log(
      `  row ${row.row}: z=${row.cols[0]?.z} y=${row.cols[0]?.y} x=[${xs}]`,
    )
  }
}

main()
