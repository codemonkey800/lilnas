import { z } from 'zod'

// Generous bounds on the id/free-text fields, matching `tablet.schema.ts`'s
// convention: Emby ids and image tags are GUID-length, so 128 is generous
// headroom; free-form title/subtitle text gets 200, mirroring that file's
// `SEARCH_MAX_LENGTH`.
const ID_MAX_LENGTH = 128
const TITLE_MAX_LENGTH = 200

// `entryId` is a server-generated `randomUUID()` (36 chars) — 64 is generous
// headroom, not a realistic real-world size, mirroring `rtc.schema.ts`'s
// `SOCKET_ID_MAX_LENGTH` reasoning for the same kind of opaque id.
const ENTRY_ID_MAX_LENGTH = 64

// The `load` payload — the title a client wants the room to switch to. It is
// structurally `Omit<NowPlayingEntry, 'entryId' | 'addedBy'>`: `entryId` is
// server-generated and `addedBy` is filled in from the socket's session, so
// neither is ever client-supplied and neither appears below.
const LoadEntrySchema = z.object({
  itemId: z.string().max(ID_MAX_LENGTH),
  title: z.string().max(TITLE_MAX_LENGTH),
  subtitle: z.string().max(TITLE_MAX_LENGTH).nullable(),
  imageTag: z.string().max(ID_MAX_LENGTH).nullable(),
  runTimeTicks: z.number().nonnegative().nullable(),
})

// What the room is playing: a `load` payload plus the two fields the server
// owns. `entryId` identifies one load, not the title — the same title loaded
// twice gets two ids, which is what lets `ended` ignore a stale report from
// the load it replaced.
export type NowPlayingEntry = z.infer<typeof LoadEntrySchema> & {
  entryId: string
  addedBy: string // username — the server fills this in from the session
}

// `video:command` — the discriminated union of all five kinds any room member
// may send (D2: no host, no per-user permissions, last-write-wins). `playhead`
// and `runTimeTicks` above are non-negative `z.number()`s — zod v4's base
// `z.number()` already rejects `NaN`/`±Infinity` (as `tablet.schema.ts` and
// `presence.schema.ts` already document), so no extra finite-guard is needed
// here either.
export const VideoCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('load'), entry: LoadEntrySchema }),
  z.object({
    kind: z.literal('ended'),
    entryId: z.string().max(ENTRY_ID_MAX_LENGTH),
  }),
  z.object({ kind: z.literal('play') }),
  z.object({ kind: z.literal('pause') }),
  z.object({ kind: z.literal('seek'), playhead: z.number().nonnegative() }),
])

export type VideoCommand = z.infer<typeof VideoCommandSchema>
