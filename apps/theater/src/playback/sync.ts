'use client'

import { useEffect } from 'react'

import { getSocket, useMultiplayerStore } from 'src/multiplayer/store'

import { type QueueEntry, useQueueStore } from './queue'
import { usePlaybackStore } from './store'

// ---------------------------------------------------------------------------
// Video sync client (PLAN.md "F6" / ORCHESTRATE.md §1's "src/playback/sync.ts"
// contract). Mirrors `voice/peerConnections.ts`'s attach-listeners-to-
// `getSocket()` shape, but FIXES that file's documented limitation: rather
// than registering once against whatever socket happens to exist at setup
// time (and going silently stale across a disconnect+reconnect that swaps in
// a brand-new Socket.IO instance), `useVideoSync()` re-registers fresh
// listeners every time `multiplayer/store.ts`'s connection `status`
// transitions to `'connected'`. That degrades to "no audio" for voice, which
// is tolerable; for video it would silently desync the room, which isn't —
// so this unit re-binds instead of copying the limitation.
//
// No loops (ORCHESTRATE.md §1): the store's local play()/pause()/seek() never
// emit — the `command*` wrappers below are the only emitters, and
// `handleVideoState`'s `applyAnchor()` call is the only anchor mutator. UI
// (a later unit, F7a) calls the `command*` wrappers; the server's echoed
// `video:state` is what actually moves the local anchor, including for the
// client that issued the command.
// ---------------------------------------------------------------------------

type VideoStatePayload = {
  currentEntryId: string | null
  currentItemId: string | null
  playing: boolean
  playhead: number
}

type QueueStatePayload = {
  queue: QueueEntry[]
}

// The `enqueue` payload (ORCHESTRATE.md §1) is structurally
// `Omit<QueueEntry, 'entryId' | 'addedBy'>` — the server fills in both of
// those (a fresh `randomUUID()` and the socket's session username), so
// neither is ever client-supplied.
export type EnqueueEntry = Omit<QueueEntry, 'entryId' | 'addedBy'>

// Keep in sync with src/presence/video.schema.ts's `VideoCommandSchema` /
// ORCHESTRATE.md §1's `video:command` wire contract. Hand-mirrored rather
// than imported, per this app's established frontend/backend boundary
// convention (see multiplayer/store.ts's "hand-duplicated wire types"
// comment).
type VideoCommand =
  | { kind: 'enqueue'; entry: EnqueueEntry }
  | { kind: 'remove'; entryId: string }
  | { kind: 'move'; entryId: string; beforeEntryId: string | null }
  | { kind: 'jump'; entryId: string }
  | { kind: 'next'; afterEntryId: string }
  | { kind: 'play' }
  | { kind: 'pause' }
  | { kind: 'seek'; playhead: number }

// ---------------------------------------------------------------------------
// Defensive validation for every inbound socket payload — this app's
// established convention (multiplayer/store.ts's `isPeerSnapshot` et al.,
// voice/peerConnections.ts's `isRtcSignal` et al.): never let a malformed
// message drive `applyAnchor()`/`load()` unchecked or land in a store as-is.
// ---------------------------------------------------------------------------

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string'
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isQueueEntry(value: unknown): value is QueueEntry {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return (
    isNonEmptyString(v.entryId) &&
    isNonEmptyString(v.itemId) &&
    typeof v.title === 'string' &&
    isNullableString(v.subtitle) &&
    isNullableString(v.imageTag) &&
    (v.runTimeTicks === null || isFiniteNumber(v.runTimeTicks)) &&
    typeof v.addedBy === 'string'
  )
}

function isVideoStatePayload(value: unknown): value is VideoStatePayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return (
    isNullableString(v.currentEntryId) &&
    isNullableString(v.currentItemId) &&
    typeof v.playing === 'boolean' &&
    isFiniteNumber(v.playhead)
  )
}

function isQueueStatePayload(value: unknown): value is QueueStatePayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return Array.isArray(v.queue) && v.queue.every(isQueueEntry)
}

// ---------------------------------------------------------------------------
// Inbound handlers — module-level (not recreated per render/effect run) so
// `.off()` always removes exactly the listener `.on()` added.
// ---------------------------------------------------------------------------

// `video:state` carries `currentItemId` on every transport change too
// (play/pause/seek), not just when the queue's cursor actually moves. If
// this handler always reloaded on it, every pause would tear down and
// re-resolve the stream — and on HLS, leak a transcode session per pause
// (PLAN.md "Risks & gotchas: Re-load() on every pause"). Guard explicitly
// against that by comparing against what's already loaded in
// `playback/store.ts` before ever calling `load()`.
function handleVideoState(payload: unknown): void {
  if (!isVideoStatePayload(payload)) {
    return
  }
  const { currentEntryId, currentItemId, playing, playhead } = payload

  // `queue:state` only ever carries `{ queue }` on the wire — this handler
  // (not the queue:state one) is what keeps currentEntryId/currentItemId
  // current, independent of whether the queue array itself changed.
  useQueueStore.setState({ currentEntryId, currentItemId })

  function applyIncomingAnchor(): void {
    // The ONLY place `performance.now()` is read for this purpose
    // (ORCHESTRATE.md §1 invariant 1 — no timestamp on the wire: the server
    // advances `playhead` to broadcast time, and each client re-anchors
    // against its own clock on receipt).
    usePlaybackStore.getState().applyAnchor({
      playing,
      playhead,
      atClockMs: performance.now(),
    })
  }

  if (currentItemId === null) {
    // Nothing queued/playing. There's no valid `load(null)` call — the
    // store's `load` signature takes a non-nullable `id: string` — so just
    // let applyAnchor reflect `playing: false`.
    applyIncomingAnchor()
    return
  }

  if (usePlaybackStore.getState().itemId === currentItemId) {
    // Already loaded — this is a transport-only change. Re-anchor without
    // touching the source.
    applyIncomingAnchor()
    return
  }

  // A genuinely new item. Each client resolves its own quality/subtitles/
  // session — per-client transcode sessions are correct and already how
  // load() works.
  void usePlaybackStore.getState().load(currentItemId).then(applyIncomingAnchor)
}

// Independent of handleVideoState above by design — never waits on it, and
// never touches currentEntryId/currentItemId, matching why the backend
// split queue-array changes (rare) from transport changes (frequent) into
// two separate events (ORCHESTRATE.md §1).
function handleQueueState(payload: unknown): void {
  if (!isQueueStatePayload(payload)) {
    return
  }
  useQueueStore.setState({ queue: payload.queue })
}

// Auto-advance. Every client's <video> fires `ended` at roughly the same
// moment and each emits `next`; the server's `afterEntryId` staleness check
// (ORCHESTRATE.md §1 invariant 4) collapses the resulting N commands into a
// single advance. Reads `currentEntryId` FRESH via `.getState()` rather than
// closing over a value captured when the listener was attached — this
// listener lives for the whole time `useVideoSync()` is attached, while the
// current entry can change many times underneath it.
function handleVideoEnded(): void {
  const { currentEntryId } = useQueueStore.getState()
  if (currentEntryId === null) {
    return
  }
  commandNext(currentEntryId)
}

// ---------------------------------------------------------------------------
// Outbound command emitters — thin `emit` wrappers, exported for the UI (F7a,
// a later unit which owns no file here). None of these touch
// `playback/store.ts` directly: `handleVideoState` above, driven by the
// server's echoed `video:state`, is the only thing that moves the local
// anchor — including for the client that issued the command.
// ---------------------------------------------------------------------------

function emitVideoCommand(command: VideoCommand): void {
  getSocket()?.emit('video:command', command)
}

export function commandEnqueue(entry: EnqueueEntry): void {
  emitVideoCommand({ kind: 'enqueue', entry })
}

export function commandRemove(entryId: string): void {
  emitVideoCommand({ kind: 'remove', entryId })
}

export function commandMove(
  entryId: string,
  beforeEntryId: string | null,
): void {
  emitVideoCommand({ kind: 'move', entryId, beforeEntryId })
}

export function commandJump(entryId: string): void {
  emitVideoCommand({ kind: 'jump', entryId })
}

export function commandNext(afterEntryId: string): void {
  emitVideoCommand({ kind: 'next', afterEntryId })
}

export function commandPlay(): void {
  emitVideoCommand({ kind: 'play' })
}

export function commandPause(): void {
  emitVideoCommand({ kind: 'pause' })
}

export function commandSeek(playhead: number): void {
  emitVideoCommand({ kind: 'seek', playhead })
}

// ---------------------------------------------------------------------------
// The hook — mounted once inside <Canvas> by a later unit (F8).
// ---------------------------------------------------------------------------

/**
 * Attaches this client's room video-sync socket listeners
 * (`video:state`/`queue:state`) and the shared `<video>`'s `ended`
 * auto-advance listener. Re-registers fresh listeners every time
 * `multiplayer/store.ts`'s connection `status` becomes `'connected'` —
 * fixing `voice/peerConnections.ts`'s documented once-only-registration
 * limitation (tolerable there as "no audio"; not tolerable here, where a
 * stale registration would silently desync the room after a reconnect that
 * swaps in a new socket instance).
 */
export function useVideoSync(): void {
  const status = useMultiplayerStore(state => state.status)

  useEffect(() => {
    if (status !== 'connected') {
      return
    }
    const socket = getSocket()
    if (!socket) {
      return
    }

    socket.on('video:state', handleVideoState)
    socket.on('queue:state', handleQueueState)
    // Bugfix: pull the room's current video/queue state now that this
    // socket's listeners for both are actually attached (see
    // presence.gateway.ts's `handleConnection`/`handleVideoRequest` comments
    // for why the server can no longer just push this on connect — it did,
    // and it was silently dropped 100% of the time). Registering the
    // listeners above BEFORE this emit, in the same synchronous tick,
    // guarantees they're in place before the server's reply can arrive —
    // Socket.IO preserves per-socket message ordering, so there's no race
    // to lose here, unlike the old connect-time push. This also covers a
    // reconnect that swaps in a new socket instance: this whole effect
    // re-runs every time `status` transitions back to `'connected'`.
    socket.emit('video:request')

    const video = usePlaybackStore.getState().getVideoElement()
    video.addEventListener('ended', handleVideoEnded)

    return () => {
      socket.off('video:state', handleVideoState)
      socket.off('queue:state', handleQueueState)
      video.removeEventListener('ended', handleVideoEnded)
    }
  }, [status])
}
