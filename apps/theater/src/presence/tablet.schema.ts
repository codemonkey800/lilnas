import { z } from 'zod'

// Generous bounds on the free-form/id-ish string fields — PLAN.md's security
// checklist calls for "bounded id/search strings" specifically so a hostile
// client can't bloat the roster or the room broadcast with huge strings.
// Emby ids are GUID-length; 128 is generous headroom without being
// unbounded.
const ID_MAX_LENGTH = 128
const SEARCH_MAX_LENGTH = 200

// `TabletState` (ORCHESTRATE.md §1), shared verbatim by `tablet:state`
// (client → server) and folded into `PeerSnapshot`/`peer:tablet`. Zod v4's
// base `z.number()` already rejects `NaN`/`±Infinity` (confirmed against
// this repo's pinned zod@4.1.12), so `scrollTop`'s "finite, >= 0" is fully
// covered by `z.number().nonnegative()` alone.
export const TabletStateSchema = z.object({
  open: z.boolean(),
  view: z.enum(['grid', 'seasons', 'episodes']),
  seriesId: z.string().max(ID_MAX_LENGTH).nullable(),
  seasonId: z.string().max(ID_MAX_LENGTH).nullable(),
  search: z.string().max(SEARCH_MAX_LENGTH),
  typeFilter: z.enum(['all', 'movie', 'series']),
  scrollTop: z.number().nonnegative(),
})

export type TabletState = z.infer<typeof TabletStateSchema>
