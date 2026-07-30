'use client'

import { io, type Socket } from 'socket.io-client'
import { Vector3 } from 'three'
import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Multiplayer presence client: a singleton Socket.IO connection to
// `src/presence/presence.gateway.ts`, exposed through a zustand store, per
// ORCHESTRATE.md §1's "src/multiplayer/store.ts" contract. Mirrors
// `src/playback/store.ts`'s architecture — a lazy module-level singleton
// (never touched at module-eval time, since this module is imported by
// 'use client' components that Next.js still module-evaluates during
// SSR/RSC, where a socket handshake makes no sense yet) plus a zustand
// `create<Store>((set, get) => {...})` factory.
//
// Split between what re-renders and what doesn't (ORCHESTRATE.md §1/§3):
// `status`/`peerIds`/`peerMeta`/`peerTablets`/`peerSeats` are zustand state —
// they only change on join/leave/nav, so a React re-render on them is fine,
// and it's how `<RemoteAvatars>` mounts/unmounts one `<RemoteAvatar>` per peer.
// `peerBuffers`, below, is a plain module-level `Map`, mutated *directly* by
// the `peer:presence` handler — never through `set()`. Presence arrives at
// ~13 Hz; routing that through React state would re-render every peer's
// avatar (and everything above it) 13 times a second. Each `<RemoteAvatar>`
// (a later unit) reads its own buffer entry by id inside its own `useFrame`.
//
// StrictMode-safe deferred teardown (PLAN.md "Risks & gotchas: StrictMode
// double-connect"; same class of race as the tdr-code logs-viewer bug):
// React 19 + `next dev` double-invoke effects mean a mount sequence is
// mount -> effect runs connect() -> cleanup runs disconnect() -> mount again
// -> effect runs connect() again. If disconnect() tore the socket down
// synchronously, the real second connect() would pay a full new handshake,
// and a naive implementation could race the first socket's in-flight
// `connect`/`peers:init` events against the teardown. Instead, disconnect()
// only *schedules* the real teardown (`setTimeout(fn, 0)`), stashing the
// timer handle at module scope; connect() cancels that pending timer first
// if one exists. If the second mount's connect() runs before the timer
// fires (the StrictMode case), the teardown is cancelled and the existing
// socket is kept exactly as-is — no reconnect at all. A genuine unmount
// (nothing calls connect() again) lets the timer fire a tick later and
// tears down for real.
//
// Hand-duplicated wire types (NOT imported from src/presence/*): this app's
// established convention across the Next.js/NestJS boundary — see
// `IpadBrowser.tsx`'s `TheaterItem` comment — is to mirror shapes by hand
// with a "keep in sync" comment rather than `import type` across the seam,
// so a NestJS-decorator-laden module never has a path into the Next.js
// bundle graph. Each type below carries a comment naming its backend source
// of truth.
// ---------------------------------------------------------------------------

// Keep in sync with src/presence/presence.schema.ts's `ANIM_STATES`.
const ANIM_STATES = [
  'idle',
  'walk_fwd',
  'walk_back',
  'strafe_left',
  'strafe_right',
] as const

export type AnimState = (typeof ANIM_STATES)[number]

// Keep in sync with src/presence/tablet.schema.ts's `TabletState`. `'queue'`
// (Phase 5) and `'player'` are each one of four independent mirrors of this
// exact union — `tablet.schema.ts`'s zod enum, this type + `isTabletState`
// below, `IpadBrowser.tsx`'s `BrowseState` + `buildTabletState`, and
// `RemoteIpad.tsx`'s `TabletState -> BrowseState` reconstruction
// (ORCHESTRATE.md §2/§3). A partial edit fails silently — a peer's tablet
// state just stops validating — so this copy is kept in sync by grepping the
// union, not by the type checker.
export type TabletState = {
  open: boolean
  view: 'grid' | 'seasons' | 'episodes' | 'queue' | 'player'
  seriesId: string | null
  seasonId: string | null
  search: string
  typeFilter: 'all' | 'movie' | 'series'
  scrollTop: number
}

// Keep in sync with src/presence/presence.gateway.ts's `PeerSnapshot`
// interface. `muted` rides along so a real snapshot still validates, but
// nothing in this store surfaces it yet — mute state is voice's own
// `src/voice/store.ts` (a later, separate unit) to own. `seatId` (Phase 5) is
// seeded into `peerSeats` below — absent/`null` means standing.
export type PeerSnapshot = {
  id: string
  username: string
  characterId: string
  p: [number, number, number]
  y: number
  a: AnimState
  muted?: boolean
  tablet?: TabletState
  seatId?: string | null
}

// ---------------------------------------------------------------------------
// React-visible store shape (ORCHESTRATE.md §1) — changes only on
// join/leave/nav.
// ---------------------------------------------------------------------------

export type MultiplayerStatus = 'idle' | 'connecting' | 'connected' | 'error'

export type PeerMeta = {
  characterId: string
  username: string
}

export type MultiplayerStore = {
  status: MultiplayerStatus
  peerIds: string[]
  peerMeta: Record<string, PeerMeta>
  peerTablets: Record<string, TabletState>
  // peerId -> seatId (Phase 5); absent = standing. Seat changes are rare, so
  // — like `peerTablets` — a plain `set()` per change is correct; this is
  // explicitly not a hot path (contrast `peerBuffers` below).
  peerSeats: Record<string, string>
  connect: (characterId: string) => void
  disconnect: () => void
}

// ---------------------------------------------------------------------------
// Module-level, non-React hot path (ORCHESTRATE.md §1) — mutated directly,
// never through `set()`.
//
// `PeerBuffer.samples` is a small ring buffer of recent network snapshots
// (oldest first), not a single damped "target" — see
// `Scene/snapshotInterp.ts`'s header comment for why: exponentially damping
// straight toward only the latest ~13 Hz packet (the original F4 design,
// PLAN.md's "pos.lerp(target, 1 - exp(-k*dt))") pulses the rendered speed at
// the packet rate, since a low-pass filter of a piecewise-constant signal is
// itself never smooth. `Scene/RemoteAvatars.tsx` instead samples this buffer
// at a slightly-delayed render time and blends between the two bracketing
// snapshots, which — for constant real-world velocity — reproduces a
// genuinely constant rendered velocity.
// ---------------------------------------------------------------------------

export type PeerSnapshotSample = {
  t: number // performance.now() at local arrival — NOT a server/wire timestamp.
  pos: Vector3
  yaw: number
  animState: AnimState
}

// At the nominal ~13 Hz presence rate (~77ms/packet, ORCHESTRATE.md §1) this
// retains ~1.5s of history — several multiples of `Scene/RemoteAvatars.tsx`'s
// ~150ms render delay, so an ordinary packet burst after a brief network
// hiccup never evicts a snapshot the render pointer still needs. Purely a
// hard memory ceiling, not a tuned value — trivial cost either way at the
// ≤8-peer scale ORCHESTRATE.md §3 frames this cost against.
const MAX_SNAPSHOT_SAMPLES = 20

export type PeerBuffer = {
  samples: PeerSnapshotSample[]
  headHeight?: number // written once by a later unit (F3b's <Avatar>)
}

export const peerBuffers = new Map<string, PeerBuffer>()

// Appends one snapshot to a peer's ring buffer, evicting the oldest entry
// past the cap. Shared by both `seedPeerBuffer` (join/init) and the
// `peer:presence` hot-path handler below — a join/init snapshot is
// semantically identical to a presence update (the peer's state "as of
// now"), just arriving through a different wire event.
function pushSample(
  buffer: PeerBuffer,
  pos: [number, number, number],
  yaw: number,
  animState: AnimState,
): void {
  buffer.samples.push({
    t: performance.now(),
    pos: new Vector3(pos[0], pos[1], pos[2]),
    yaw,
    animState,
  })
  if (buffer.samples.length > MAX_SNAPSHOT_SAMPLES) {
    buffer.samples.shift()
  }
}

// Module-level singletons. Never touched at module-eval time — only from
// inside connect()/disconnect(), which are only ever invoked from client-side
// effects/handlers, never during SSR.
let sharedSocket: Socket | null = null
let pendingTeardown: ReturnType<typeof setTimeout> | null = null

// ---------------------------------------------------------------------------
// Defensive validation. Every one of these packets crosses the network
// boundary — never let malformed data write NaN/Infinity/a garbage string
// into a buffer a `useFrame` loop reads every frame, or into React state.
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

export function isPositionTuple(
  value: unknown,
): value is [number, number, number] {
  return (
    Array.isArray(value) && value.length === 3 && value.every(isFiniteNumber)
  )
}

export function isAnimState(value: unknown): value is AnimState {
  return (
    typeof value === 'string' &&
    (ANIM_STATES as readonly string[]).includes(value)
  )
}

export function isTabletState(value: unknown): value is TabletState {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>

  if (typeof v.open !== 'boolean') {
    return false
  }
  if (
    v.view !== 'grid' &&
    v.view !== 'seasons' &&
    v.view !== 'episodes' &&
    v.view !== 'queue' &&
    v.view !== 'player'
  ) {
    return false
  }
  if (v.seriesId !== null && typeof v.seriesId !== 'string') {
    return false
  }
  if (v.seasonId !== null && typeof v.seasonId !== 'string') {
    return false
  }
  if (typeof v.search !== 'string') {
    return false
  }
  if (
    v.typeFilter !== 'all' &&
    v.typeFilter !== 'movie' &&
    v.typeFilter !== 'series'
  ) {
    return false
  }
  if (!isFiniteNumber(v.scrollTop) || v.scrollTop < 0) {
    return false
  }
  return true
}

export function isPeerSnapshot(value: unknown): value is PeerSnapshot {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>

  if (
    !isNonEmptyString(v.id) ||
    typeof v.username !== 'string' ||
    typeof v.characterId !== 'string' ||
    !isPositionTuple(v.p) ||
    !isFiniteNumber(v.y) ||
    !isAnimState(v.a)
  ) {
    return false
  }
  if (v.muted !== undefined && typeof v.muted !== 'boolean') {
    return false
  }
  if (v.tablet !== undefined && !isTabletState(v.tablet)) {
    return false
  }
  if (
    v.seatId !== undefined &&
    v.seatId !== null &&
    typeof v.seatId !== 'string'
  ) {
    return false
  }
  return true
}

export type PeerLeavePayload = { id: string }

export function isPeerLeavePayload(value: unknown): value is PeerLeavePayload {
  return (
    typeof value === 'object' &&
    value !== null &&
    isNonEmptyString((value as Record<string, unknown>).id)
  )
}

export type PeerPresencePayload = {
  id: string
  p: [number, number, number]
  y: number
  a: AnimState
}

export function isPeerPresencePayload(
  value: unknown,
): value is PeerPresencePayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return (
    isNonEmptyString(v.id) &&
    isPositionTuple(v.p) &&
    isFiniteNumber(v.y) &&
    isAnimState(v.a)
  )
}

export type PeerTabletPayload = { id: string } & TabletState

export function isPeerTabletPayload(
  value: unknown,
): value is PeerTabletPayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return isNonEmptyString(v.id) && isTabletState(v)
}

// `peer:seat` payload (ORCHESTRATE.md §1). `seatId: null` is a distinct,
// meaningful case ("stood up") rather than a missing field — it's what tells
// the `peer:seat` handler below to delete the `peerSeats` entry instead of
// storing it, keeping "absent" the one representation of "standing".
export type PeerSeatPayload = { id: string; seatId: string | null }

export function isPeerSeatPayload(value: unknown): value is PeerSeatPayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return (
    isNonEmptyString(v.id) &&
    (v.seatId === null || typeof v.seatId === 'string')
  )
}

// Seeds/refreshes a peer's `peerBuffers` entry from a validated snapshot.
// Direct `Map` mutation — never `set()` — per the hot-path split above. A
// duplicate `peers:init`/`peer:join` for a peer already buffered just
// appends another sample like any other update (harmless — at worst a
// same-position sample lands in the ring buffer).
function seedPeerBuffer(peer: PeerSnapshot): void {
  const existing = peerBuffers.get(peer.id)
  const buffer = existing ?? { samples: [] }
  pushSample(buffer, peer.p, peer.y, peer.a)
  if (!existing) {
    peerBuffers.set(peer.id, buffer)
  }
}

// Later units (voice's WebRTC signaling, the tablet broadcaster's
// `tablet:state` emits) attach their own listeners/emits to the same
// connection through this, rather than this module pre-wiring support for
// events it doesn't otherwise care about.
export function getSocket(): Socket | null {
  return sharedSocket
}

export const useMultiplayerStore = create<MultiplayerStore>(set => {
  // Registered once per socket, right after it's created in connect().
  function wireSocketHandlers(socket: Socket): void {
    socket.on('connect', () => {
      set({ status: 'connected' })
    })

    // A server-initiated drop or network blip lands here too (socket.io's
    // built-in reconnection then retries on this same socket instance,
    // firing `connect` again on success or `connect_error` on a failed
    // attempt — that's what flips `status` to `'error'`, below). Our own
    // clean teardown (disconnect()'s deferred callback) sets `status` back
    // to `'idle'` itself once it actually runs; plain `'idle'` here just
    // means "not connected right now" without pre-judging whether a
    // reconnect is already on the way.
    socket.on('disconnect', () => {
      set({ status: 'idle' })
    })

    socket.on('connect_error', () => {
      set({ status: 'error' })
    })

    socket.on('peers:init', (payload: unknown) => {
      if (!Array.isArray(payload)) {
        return
      }
      const peers = payload.filter(isPeerSnapshot)
      if (peers.length === 0) {
        return
      }

      set(state => {
        const peerIds = [...state.peerIds]
        const peerMeta = { ...state.peerMeta }
        const peerTablets = { ...state.peerTablets }
        const peerSeats = { ...state.peerSeats }

        for (const peer of peers) {
          // Direct peerBuffers mutation, not part of the returned partial
          // state below — kept inline with the loop that builds it purely
          // for locality; it never touches `state`.
          seedPeerBuffer(peer)

          if (!peerIds.includes(peer.id)) {
            peerIds.push(peer.id)
          }
          peerMeta[peer.id] = {
            characterId: peer.characterId,
            username: peer.username,
          }
          if (peer.tablet) {
            peerTablets[peer.id] = peer.tablet
          }
          // Absent/`null` = standing — only a truthy seatId gets an entry
          // (mirrors `peer:seat`'s delete-on-null handling below).
          if (peer.seatId) {
            peerSeats[peer.id] = peer.seatId
          }
        }

        return { peerIds, peerMeta, peerTablets, peerSeats }
      })
    })

    socket.on('peer:join', (payload: unknown) => {
      if (!isPeerSnapshot(payload)) {
        return
      }
      seedPeerBuffer(payload)

      set(state => ({
        peerIds: state.peerIds.includes(payload.id)
          ? state.peerIds
          : [...state.peerIds, payload.id],
        peerMeta: {
          ...state.peerMeta,
          [payload.id]: {
            characterId: payload.characterId,
            username: payload.username,
          },
        },
        peerTablets: payload.tablet
          ? { ...state.peerTablets, [payload.id]: payload.tablet }
          : state.peerTablets,
        // Absent/`null` = standing — only a truthy seatId gets an entry.
        peerSeats: payload.seatId
          ? { ...state.peerSeats, [payload.id]: payload.seatId }
          : state.peerSeats,
      }))
    })

    socket.on('peer:leave', (payload: unknown) => {
      if (!isPeerLeavePayload(payload)) {
        return
      }
      const { id } = payload
      peerBuffers.delete(id)

      set(state => {
        if (!state.peerIds.includes(id)) {
          // Returning the same reference is zustand's own no-op signal
          // (vanilla.ts: `Object.is(nextState, state)` skips the notify) —
          // a stray/duplicate leave for an id we don't have shouldn't
          // trigger a re-render.
          return state
        }
        const peerMeta = { ...state.peerMeta }
        delete peerMeta[id]
        const peerTablets = { ...state.peerTablets }
        delete peerTablets[id]
        const peerSeats = { ...state.peerSeats }
        delete peerSeats[id]
        return {
          peerIds: state.peerIds.filter(peerId => peerId !== id),
          peerMeta,
          peerTablets,
          peerSeats,
        }
      })
    })

    // Hot path — ~13 Hz. Direct `peerBuffers` mutation only; NEVER `set()`
    // (movement must not trigger a React re-render).
    socket.on('peer:presence', (payload: unknown) => {
      if (!isPeerPresencePayload(payload)) {
        return
      }
      const buffer = peerBuffers.get(payload.id)
      if (!buffer) {
        // Stray/late packet for a peer we haven't seeded yet (or already
        // dropped) — nothing to update.
        return
      }
      pushSample(buffer, payload.p, payload.y, payload.a)
    })

    // Nav state, not a hot path (~10 Hz only while a tablet is open) — goes
    // through `set()`, since `peerTablets` is explicitly React-visible.
    socket.on('peer:tablet', (payload: unknown) => {
      if (!isPeerTabletPayload(payload)) {
        return
      }
      const { id, ...tablet } = payload
      set(state => ({
        peerTablets: { ...state.peerTablets, [id]: tablet },
      }))
    })

    // Seat changes are rare (a keypress, not a stream) — goes through
    // `set()`, since `peerSeats` is explicitly React-visible. `seatId: null`
    // deletes the entry rather than storing it, so "absent" stays the one
    // representation of "standing" (mirrors the seeding above).
    socket.on('peer:seat', (payload: unknown) => {
      if (!isPeerSeatPayload(payload)) {
        return
      }
      const { id, seatId } = payload
      set(state => {
        const peerSeats = { ...state.peerSeats }
        if (seatId === null) {
          delete peerSeats[id]
        } else {
          peerSeats[id] = seatId
        }
        return { peerSeats }
      })
    })
  }

  return {
    status: 'idle',
    peerIds: [],
    peerMeta: {},
    peerTablets: {},
    peerSeats: {},

    connect: characterId => {
      if (pendingTeardown !== null) {
        clearTimeout(pendingTeardown)
        pendingTeardown = null
      }
      if (sharedSocket !== null) {
        // Already connected, or still connecting — no-op. This is also
        // what makes the StrictMode double-invoke case a no-reconnect: the
        // pending-teardown cancellation above (if any) already restored
        // the prior socket, so there's nothing left to do here.
        return
      }

      const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL ?? '', {
        withCredentials: true,
        auth: { characterId },
      })
      sharedSocket = socket
      set({ status: 'connecting' })
      wireSocketHandlers(socket)
    },

    disconnect: () => {
      if (sharedSocket === null || pendingTeardown !== null) {
        // Nothing connected, or a teardown is already scheduled — no-op.
        return
      }

      pendingTeardown = setTimeout(() => {
        sharedSocket?.disconnect()
        sharedSocket = null
        pendingTeardown = null
        // A real teardown — clear the roster too, so a later connect()
        // starts from a blank slate instead of briefly rendering ghosts of
        // the previous session while fresh peers:init/peer:join land.
        peerBuffers.clear()
        set({
          status: 'idle',
          peerIds: [],
          peerMeta: {},
          peerTablets: {},
          peerSeats: {},
        })
      }, 0)
    },
  }
})
