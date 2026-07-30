import { z } from 'zod'

// Bound the length per PLAN.md's security checklist — every valid `seatId`
// is `r{row}s{col}` (row 0-5, col 0-6, ORCHESTRATE.md §1), so a real id is
// at most 4 characters; 16 is generous headroom, not a realistic
// real-world size.
const SEAT_ID_MAX_LENGTH = 16

// `seat:claim` (ORCHESTRATE.md §1) — the server is the sole arbiter of
// occupancy; the client never assumes success and only commits `mySeatId`
// on the `{ ok: true }` ack (`src/seats/store.ts`, F2).
export const SeatClaimSchema = z.object({
  seatId: z.string().max(SEAT_ID_MAX_LENGTH),
})

export type SeatClaim = z.infer<typeof SeatClaimSchema>

// The 42 valid seat ids (6 rows × 7 columns, ORCHESTRATE.md §1), built by
// the same `r{row}s{col}` loop rather than imported from
// `src/components/Scene/seats.ts`'s generated `SEATS` table (F1, a
// different unit running concurrently with this one). There's no shared
// module bridging frontend and backend here, so this list is
// hand-mirrored — same convention as `VALID_CHARACTER_ID_LIST` in
// `presence.constants.ts`. The id format is deterministic, so the two agree
// without a cross-boundary import; if F1's generator ever produces a
// different seat count, that's a real mismatch to catch at the Batch 1
// gate, not a rounding error (ORCHESTRATE.md §7).
//
// An unknown `seatId` (not a member of this set) is rejected by the gateway
// (B3) as `{ ok: false, reason: 'unknown' }` and never stored.
const SEAT_ROWS = 6
const SEAT_COLS = 7

export const SEAT_IDS: Set<string> = new Set()

for (let row = 0; row < SEAT_ROWS; row++) {
  for (let col = 0; col < SEAT_COLS; col++) {
    SEAT_IDS.add(`r${row}s${col}`)
  }
}
