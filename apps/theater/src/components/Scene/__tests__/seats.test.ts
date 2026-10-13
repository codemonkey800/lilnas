import { Vector3 } from 'three'

import { gazeAlignment } from 'src/components/Scene/gaze'
import {
  findGazedFreeSeat,
  getSeat,
  type Seat,
  SEAT_TARGET_MAX_DISTANCE_M,
  SEAT_TARGET_MIN_ALIGNMENT_COS,
  SEATS,
} from 'src/components/Scene/seats'

function cushionVector(seat: Seat): Vector3 {
  return new Vector3(...seat.cushion)
}

function seatOrThrow(id: string): Seat {
  const seat = getSeat(id)
  if (!seat) throw new Error(`fixture seat "${id}" not found in SEATS`)
  return seat
}

describe('SEATS', () => {
  it('has exactly 42 seats (6 rows x 7 columns)', () => {
    expect(SEATS).toHaveLength(42)
  })

  it('has a unique r{row}s{col} id for every row 0-5 x col 0-6 combination', () => {
    const ids = new Set(SEATS.map(seat => seat.id))
    expect(ids.size).toBe(42)

    for (let row = 0; row < 6; row++) {
      for (let col = 0; col < 7; col++) {
        const id = `r${row}s${col}`
        expect(ids.has(id)).toBe(true)

        const seat = seatOrThrow(id)
        expect(seat.row).toBe(row)
        expect(seat.col).toBe(col)
      }
    }
  })

  // Every seat faces the screen (+Z) -- PLAN.md's "Seat data" section: the
  // backrests all sit at more-negative Z than their own cushion.
  it('faces every seat toward the screen (yaw 0)', () => {
    expect(SEATS.every(seat => seat.yaw === 0)).toBe(true)
  })
})

describe('getSeat', () => {
  it('returns the matching seat for a known id', () => {
    expect(getSeat('r0s0')?.id).toBe('r0s0')
    expect(getSeat('r5s6')?.id).toBe('r5s6')
  })

  it('returns undefined for an id outside the 6x7 grid', () => {
    expect(getSeat('r6s0')).toBeUndefined()
    expect(getSeat('r0s7')).toBeUndefined()
    expect(getSeat('not-a-seat')).toBeUndefined()
  })
})

describe('findGazedFreeSeat', () => {
  // Two real, adjacent seats (one seat-pitch apart, ~0.44m -- PLAN.md's
  // "Seat data" section) double as this suite's fixtures, rather than
  // synthetic coordinates, since the function under test reads the real
  // module-level SEATS table directly (it takes no seat-list parameter).
  const seatA = seatOrThrow('r2s3')
  const seatB = seatOrThrow('r2s2')
  const cushionA = cushionVector(seatA)
  const cushionB = cushionVector(seatB)

  // Positioned (and verified below) so the ranking across the FULL 42-seat
  // table is unambiguous: seatA is dead-centre (alignment 1, the maximum
  // possible), seatB is the clear runner-up, and every other seat -- including
  // the row behind seatA, which a straight-on approach would put nearly back
  // on-axis thanks to the theater's rake -- trails both by a comfortable
  // margin. A camPos placed directly in front of seatA along a grid axis
  // (pure +Z or +X) instead produces ties or lets a different row's seat
  // outrank seatB, which is why this offset is deliberately oblique rather
  // than axis-aligned.
  const camPos = cushionA.clone().add(new Vector3(0.9, 0, 0.5))
  const camForward = cushionA.clone().sub(camPos).normalize()

  it('is set up so seatA is dead-centre and seatB is the clear runner-up', () => {
    expect(cushionA.distanceTo(camPos)).toBeLessThan(SEAT_TARGET_MAX_DISTANCE_M)
    expect(cushionB.distanceTo(camPos)).toBeLessThan(SEAT_TARGET_MAX_DISTANCE_M)

    const alignmentA = gazeAlignment(camPos, camForward, cushionA)
    const alignmentB = gazeAlignment(camPos, camForward, cushionB)
    expect(alignmentA).toBeCloseTo(1, 5)
    expect(alignmentB).toBeGreaterThan(SEAT_TARGET_MIN_ALIGNMENT_COS)
    expect(alignmentB).toBeLessThan(alignmentA)
  })

  it('picks the best-aligned free seat among several in-range candidates', () => {
    const result = findGazedFreeSeat(camPos, camForward, new Set())
    expect(result?.id).toBe(seatA.id)
  })

  it('excludes occupied seats even when they are better-aligned', () => {
    const result = findGazedFreeSeat(camPos, camForward, new Set([seatA.id]))
    expect(result?.id).toBe(seatB.id)
  })

  it('returns null when no seat is within SEAT_TARGET_MAX_DISTANCE_M', () => {
    const farCamPos = new Vector3(1000, 1000, 1000)
    const farCamForward = new Vector3(0, 0, -1)

    expect(findGazedFreeSeat(farCamPos, farCamForward, new Set())).toBeNull()
  })

  // Standing right at a seat but looking straight up: several seats are
  // well within range, but the rake's y-offset per row (PLAN.md: "+0.300
  // m/row") never produces more than ~0.33 alignment against a purely
  // vertical forward -- comfortably below the 35-degree floor -- so nothing
  // qualifies as "looking at the seat block at all" (D9).
  it('returns null when in range but not looking closely enough at anything', () => {
    const result = findGazedFreeSeat(
      cushionA.clone(),
      new Vector3(0, 1, 0),
      new Set(),
    )
    expect(result).toBeNull()
  })
})
