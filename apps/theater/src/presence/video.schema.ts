import { z } from 'zod'

// Generous bounds on the id/free-text fields, matching `tablet.schema.ts`'s
// convention: Emby ids and image tags are GUID-length, so 128 is generous
// headroom; free-form title/subtitle text gets 200, mirroring that file's
// `SEARCH_MAX_LENGTH`.
const ID_MAX_LENGTH = 128
const TITLE_MAX_LENGTH = 200

// `entryId`/`beforeEntryId`/`afterEntryId` are all server-generated
// `randomUUID()`s (36 chars, ORCHESTRATE.md §1) — 64 is generous headroom,
// not a realistic real-world size, mirroring `rtc.schema.ts`'s
// `SOCKET_ID_MAX_LENGTH` reasoning for the same kind of opaque id.
const ENTRY_ID_MAX_LENGTH = 64

// The `enqueue` payload (ORCHESTRATE.md §1) — defined as its own explicit
// zod object rather than importing `QueueEntry` from `./queue.ts` (B2, a
// different unit running concurrently with this one). That's what lets B1
// and B2 build with no compile dependency on each other (ORCHESTRATE.md
// §4). It is structurally `Omit<QueueEntry, 'entryId' | 'addedBy'>` even
// though nothing here imports that type: `entryId` is server-generated and
// `addedBy` is filled in from the socket's session, so neither is ever
// client-supplied and neither appears below.
const EnqueueEntrySchema = z.object({
  itemId: z.string().max(ID_MAX_LENGTH),
  title: z.string().max(TITLE_MAX_LENGTH),
  subtitle: z.string().max(TITLE_MAX_LENGTH).nullable(),
  imageTag: z.string().max(ID_MAX_LENGTH).nullable(),
  runTimeTicks: z.number().nonnegative().nullable(),
})

// `video:command` (ORCHESTRATE.md §1) — the discriminated union of all
// eight kinds any room member may send (D2: no host, no per-user
// permissions, last-write-wins). `playhead` and `runTimeTicks` above are
// non-negative `z.number()`s — zod v4's base `z.number()` already rejects
// `NaN`/`±Infinity` (as `tablet.schema.ts` and `presence.schema.ts` already
// document), so no extra finite-guard is needed here either.
export const VideoCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('enqueue'), entry: EnqueueEntrySchema }),
  z.object({
    kind: z.literal('remove'),
    entryId: z.string().max(ENTRY_ID_MAX_LENGTH),
  }),
  z.object({
    kind: z.literal('move'),
    entryId: z.string().max(ENTRY_ID_MAX_LENGTH),
    beforeEntryId: z.string().max(ENTRY_ID_MAX_LENGTH).nullable(),
  }),
  z.object({
    kind: z.literal('jump'),
    entryId: z.string().max(ENTRY_ID_MAX_LENGTH),
  }),
  z.object({
    kind: z.literal('next'),
    afterEntryId: z.string().max(ENTRY_ID_MAX_LENGTH),
  }),
  z.object({ kind: z.literal('play') }),
  z.object({ kind: z.literal('pause') }),
  z.object({ kind: z.literal('seek'), playhead: z.number().nonnegative() }),
])

export type VideoCommand = z.infer<typeof VideoCommandSchema>
