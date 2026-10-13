'use client'

import { useEffect } from 'react'

import { getSocket, useMultiplayerStore } from 'src/multiplayer/store'

import { serverMsToClientClockMs, startServerClockSync } from './clock'
import { type NowPlayingEntry, useNowPlayingStore } from './nowPlayingStore'
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
  entry: NowPlayingEntry | null
  playing: boolean
  playhead: number
  // Server-clock instant `playhead` was computed at (presence.gateway.ts's
  // `videoStatePayload`) — what the anchor is pinned to, via clock.ts.
  atServerMs: number
}

// The `load` payload (ORCHESTRATE.md §1) is structurally
// `Omit<NowPlayingEntry, 'entryId' | 'addedBy'>` — the server fills in both of
// those (a fresh `randomUUID()` and the socket's session username), so
// neither is ever client-supplied.
export type LoadEntry = Omit<NowPlayingEntry, 'entryId' | 'addedBy'>

// Keep in sync with src/presence/video.schema.ts's `VideoCommandSchema` /
// ORCHESTRATE.md §1's `video:command` wire contract. Hand-mirrored rather
// than imported, per this app's established frontend/backend boundary
// convention (see multiplayer/store.ts's "hand-duplicated wire types"
// comment).
type VideoCommand =
  | { kind: 'load'; entry: LoadEntry }
  | { kind: 'ended'; entryId: string }
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

function isNowPlayingEntry(value: unknown): value is NowPlayingEntry {
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
    (v.entry === null || isNowPlayingEntry(v.entry)) &&
    typeof v.playing === 'boolean' &&
    isFiniteNumber(v.playhead) &&
    isFiniteNumber(v.atServerMs)
  )
}

// ---------------------------------------------------------------------------
// Inbound handlers — module-level (not recreated per render/effect run) so
// `.off()` always removes exactly the listener `.on()` added.
// ---------------------------------------------------------------------------

// `video:state` carries `entry` on every transport change too
// (play/pause/seek), not just when the room switches titles. If
// this handler always reloaded on it, every pause would tear down and
// re-resolve the stream — and on HLS, leak a transcode session per pause
// (PLAN.md "Risks & gotchas: Re-load() on every pause"). Guard explicitly
// against that by comparing against what's already loaded in
// `playback/store.ts` before ever calling `load()`.
function handleVideoState(payload: unknown): void {
  if (!isVideoStatePayload(payload)) {
    return
  }
  const { entry, playing, playhead, atServerMs } = payload

  useNowPlayingStore.setState({ entry })

  function applyIncomingAnchor(): void {
    // Anchor to WHEN the state was true on the server, translated onto this
    // client's clock (clock.ts), not to when this handler happened to run.
    // The original "no timestamp on the wire, re-anchor at receipt" design
    // (ORCHESTRATE.md §1 invariant 1) turned every ms of delivery delay —
    // network latency, main-thread jank, and for a new item the entire
    // `load()` below before this runs — into a permanent per-client offset
    // that `tick()`'s drift correction could never see, because each client
    // was exactly on its own anchor. Falls back to receipt time only while
    // there's no clock estimate yet (first ~250ms after connect).
    usePlaybackStore.getState().applyAnchor({
      playing,
      playhead,
      atClockMs: serverMsToClientClockMs(atServerMs) ?? performance.now(),
    })
  }

  if (entry === null) {
    // Nothing playing. There's no valid `load(null)` call — the
    // store's `load` signature takes a non-nullable `id: string` — so just
    // let applyAnchor reflect `playing: false`.
    applyIncomingAnchor()
    return
  }

  if (usePlaybackStore.getState().itemId === entry.itemId) {
    // Already loaded — a transport-only change, or the same title picked
    // again (the server restarts it from 0). Re-anchor without touching the
    // source.
    applyIncomingAnchor()
    return
  }

  // A genuinely new item. Each client resolves its own quality/subtitles/
  // session — per-client transcode sessions are correct and already how
  // load() works.
  void usePlaybackStore.getState().load(entry.itemId).then(applyIncomingAnchor)
}

// End of playback. Every client's <video> fires `ended` at roughly the same
// moment and each emits `ended`; the server's `entryId` staleness check
// (ORCHESTRATE.md §1 invariant 4) collapses the resulting N commands into a
// single stop. Reads the entry FRESH via `.getState()` rather than closing
// over a value captured when the listener was attached — this listener lives
// for the whole time `useVideoSync()` is attached, while the entry can change
// many times underneath it.
function handleVideoEnded(): void {
  const { entry } = useNowPlayingStore.getState()
  if (entry === null) {
    return
  }
  commandEnded(entry.entryId)
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

export function commandLoad(entry: LoadEntry): void {
  emitVideoCommand({ kind: 'load', entry })
}

export function commandEnded(entryId: string): void {
  emitVideoCommand({ kind: 'ended', entryId })
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
 * (`video:state`) and the shared `<video>`'s `ended`
 * end-of-playback listener. Re-registers fresh listeners every time
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
    // Start estimating the server clock before pulling state, so the burst's
    // first probe is already in flight ahead of the `video:state` reply
    // below (Socket.IO's per-socket ordering means the ack lands first).
    const stopClockSync = startServerClockSync(socket)
    // Bugfix: pull the room's current video state now that this
    // socket's listener is actually attached (see
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
      stopClockSync()
      socket.off('video:state', handleVideoState)
      video.removeEventListener('ended', handleVideoEnded)
    }
  }, [status])
}
