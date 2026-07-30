// Pure queue-mutation logic for the room-wide video queue (PLAN.md "B2" /
// ORCHESTRATE.md §1, §4). No socket, no NestJS, no I/O — every function here
// takes a plain `QueueState` and returns a new one, so the gateway (B3, a
// later unit) can hold this as its own `roomVideo` state and layer
// broadcasting/anchoring on top without this file ever knowing a socket
// exists. That split is also what makes the queue's edge cases testable
// without standing up a gateway (ORCHESTRATE.md §4).
//
// `entryId` is the ONLY thing entries are ever addressed by — never an
// array index (ORCHESTRATE.md §1 invariant 3). `currentEntryId` is the
// cursor, not `currentIndex`, so reordering the queue can never change
// what's playing (PLAN.md's "Index-addressed queue mutations" risk).

// `QueueEntry` (ORCHESTRATE.md §1) — declared here, not in a schema file, so
// B1's `video.schema.ts` can define the `enqueue` wire payload as an
// independent zod object rather than importing this type. That's what lets
// B1 and B2 run concurrently in Batch 1 (ORCHESTRATE.md §4).
export type QueueEntry = {
  entryId: string // caller-supplied — the gateway uses randomUUID(); NOT the itemId
  itemId: string // Emby item id (a movie, or an episode)
  title: string
  subtitle: string | null // "2019" for a film, "The Bear · S2E4" for an episode
  imageTag: string | null
  runTimeTicks: number | null
  addedBy: string // username — the server fills this in from the session, never client-supplied
}

// The slice of room video state these functions operate on. Deliberately
// narrower than the gateway's full `roomVideo` (PLAN.md "B3b"): `playing` /
// `playhead` / `atServerMs` are playback-anchor concerns the gateway owns
// directly, so this file only ever touches the queue array and its cursor.
export type QueueState = {
  queue: QueueEntry[]
  currentEntryId: string | null
}

/**
 * Appends `entry` to the queue. If nothing is currently playing
 * (`currentEntryId === null`), the newly-enqueued entry also becomes
 * current — otherwise adding the very first title to a room does nothing
 * visible, which reads as broken (PLAN.md "B3b"). If the room already has a
 * current entry, this only appends.
 *
 * Deliberately keyed on `currentEntryId === null`, not `queue.length === 0`:
 * a queue can be non-empty with nothing current — e.g. after `applyRemove`
 * drops the last, current entry (see its own comment) — and enqueuing into
 * *that* state must still resume playback. The caller (the gateway) is
 * responsible for actually starting playback (`playing`/`playhead`/
 * `atServerMs`) whenever it observes the cursor transition from `null` to
 * non-null; that's outside this file's `QueueState`.
 */
export function applyEnqueue(state: QueueState, entry: QueueEntry): QueueState {
  return {
    queue: [...state.queue, entry],
    currentEntryId:
      state.currentEntryId === null ? entry.entryId : state.currentEntryId,
  }
}

/**
 * Removes the entry addressed by `entryId`. If it was the current entry,
 * the cursor advances to whichever entry followed it in the *pre-removal*
 * order (captured before splicing), or clears to `null` ("nothing playing")
 * if it was the last entry — regardless of whether earlier entries remain
 * in the queue. Removing a non-current entry never touches the cursor.
 *
 * An `entryId` that isn't in the queue is a no-op: the identical `state`
 * reference is returned, unchanged.
 */
export function applyRemove(state: QueueState, entryId: string): QueueState {
  const index = state.queue.findIndex(entry => entry.entryId === entryId)
  if (index === -1) {
    return state
  }

  const queue = [
    ...state.queue.slice(0, index),
    ...state.queue.slice(index + 1),
  ]

  if (state.currentEntryId !== entryId) {
    return { queue, currentEntryId: state.currentEntryId }
  }

  // Pre-removal order: whichever entry immediately followed the removed
  // one, captured from `state.queue` (not the already-spliced `queue`)
  // before the removal shifted every later index down by one.
  const follower = state.queue[index + 1]
  return { queue, currentEntryId: follower ? follower.entryId : null }
}

/**
 * Moves the entry addressed by `entryId` so it sits immediately before
 * `beforeEntryId` — or to the end of the queue if `beforeEntryId` is
 * `null`. Never changes `currentEntryId`, even when the moved entry IS the
 * current one (ORCHESTRATE.md §1 invariant 3 / D6): reordering must never
 * change what's playing.
 *
 * An unknown `entryId`, an unknown `beforeEntryId`, or `beforeEntryId`
 * equal to `entryId` ("move it before itself") are all no-ops — the
 * identical `state` reference is returned, never a throw.
 */
export function applyMove(
  state: QueueState,
  entryId: string,
  beforeEntryId: string | null,
): QueueState {
  if (entryId === beforeEntryId) {
    return state
  }

  const entry = state.queue.find(candidate => candidate.entryId === entryId)
  if (!entry) {
    return state
  }

  if (
    beforeEntryId !== null &&
    !state.queue.some(candidate => candidate.entryId === beforeEntryId)
  ) {
    return state
  }

  const withoutEntry = state.queue.filter(
    candidate => candidate.entryId !== entryId,
  )

  if (beforeEntryId === null) {
    return {
      queue: [...withoutEntry, entry],
      currentEntryId: state.currentEntryId,
    }
  }

  // Guaranteed to be found: beforeEntryId's presence in the original queue
  // was already confirmed above, and it can't be entryId itself (handled by
  // the early return), so it survives the filter into withoutEntry.
  const insertIndex = withoutEntry.findIndex(
    candidate => candidate.entryId === beforeEntryId,
  )
  const queue = [
    ...withoutEntry.slice(0, insertIndex),
    entry,
    ...withoutEntry.slice(insertIndex),
  ]
  return { queue, currentEntryId: state.currentEntryId }
}

/**
 * Advances the cursor to the entry following the current one, or clears it
 * to `null` ("nothing playing") at the end of the queue — no wraparound.
 * A no-op if nothing is currently playing.
 *
 * Deliberately takes no `afterEntryId`. The auto-advance de-dup — "only
 * apply if `afterEntryId` still matches the current cursor"
 * (ORCHESTRATE.md §1 invariant 4) — is the GATEWAY's job, checked against
 * its own state immediately before calling this function; every client's
 * `<video>` fires `ended` at roughly the same moment and emits `next`, and
 * that check is what collapses the resulting N commands into a single
 * advance. By the time this function runs, the check has already passed, so
 * all that's left is the advance itself.
 */
export function applyNext(state: QueueState): QueueState {
  if (state.currentEntryId === null) {
    return state
  }

  const currentIndex = state.queue.findIndex(
    entry => entry.entryId === state.currentEntryId,
  )
  if (currentIndex === -1) {
    // The current entry isn't in the queue at all (shouldn't happen in
    // practice) — there's nothing sane to advance from, so stop rather than
    // guess.
    return { queue: state.queue, currentEntryId: null }
  }

  const next = state.queue[currentIndex + 1]
  return { queue: state.queue, currentEntryId: next ? next.entryId : null }
}
