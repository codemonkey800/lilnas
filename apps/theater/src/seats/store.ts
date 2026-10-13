'use client'

import { create } from 'zustand'

import { getSocket, useMultiplayerStore } from 'src/multiplayer/store'

// ---------------------------------------------------------------------------
// Seat client state (PLAN.md "F2 — src/seats/store.ts (local seat state)" /
// ORCHESTRATE.md §1's "src/seats/store.ts" contract). Mirrors
// `src/voice/store.ts`'s shape exactly: a small zustand store holding LOCAL
// state only, emitting through `getSocket()` (exported from
// `src/multiplayer/store.ts`) rather than owning any socket of its own.
//
// `mySeatId` has exactly one path to a non-null value: the `{ ok: true }`
// branch of `claim()`'s ack callback. There is no optimistic path —
// PLAN.md's "the claim race" risk is explicit about why: an optimistic sit
// that loses the race would put two avatars in one chair until the
// correction landed. The gateway (`presence.gateway.ts`'s
// `handleSeatClaim`) is the sole arbiter of occupancy; this store only ever
// reflects what it has already confirmed.
//
// `pending` guards the claim round-trip itself (this client waiting on its
// own ack) — it is unrelated to the seated/standing animation state machine
// F4 layers on top (sit_down/sitting/stand_up), which lives entirely outside
// this store.
// ---------------------------------------------------------------------------

// Keep in sync with src/presence/presence.gateway.ts's (unexported)
// `SeatClaimAck` / ORCHESTRATE.md §1's wire contract.
type SeatClaimAck = { ok: true } | { ok: false; reason: 'taken' | 'unknown' }

function isSeatClaimAck(value: unknown): value is SeatClaimAck {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  if (v.ok === true) {
    return true
  }
  return v.ok === false && (v.reason === 'taken' || v.reason === 'unknown')
}

export type SeatStore = {
  mySeatId: string | null
  pending: boolean
  claim: (seatId: string) => void
  release: () => void
}

export const useSeatStore = create<SeatStore>((set, get) => {
  // Resets local seat state on any transition away from 'connected' — both
  // a clean `disconnect()` teardown and an unexpected drop flip
  // `multiplayer/store.ts`'s `status` this way. By the time either happens,
  // the gateway's own `handleDisconnect` has already freed the seat
  // server-side, so a stale `mySeatId` would make a reconnect believe it's
  // still seated when the room has already forgotten it. This also unsticks
  // `pending` on the rare case a claim's ack never arrives because the
  // socket dropped mid-flight.
  //
  // Subscribing to the OTHER store's `status` — rather than registering a
  // 'disconnect' listener directly on whatever socket `getSocket()` happens
  // to return right now — is what keeps this correct across a reconnect
  // that replaces `sharedSocket` with a brand-new instance:
  // `multiplayer/store.ts` re-derives `status` from its own
  // `wireSocketHandlers` for every socket it ever creates, so this
  // subscription never has to know about that replacement, let alone rebind
  // itself to it. Diffing `prevState`/`state` (rather than reacting to every
  // update) mirrors `voice/peerConnections.ts`'s `syncPeerConnections`
  // subscription convention.
  useMultiplayerStore.subscribe((state, prevState) => {
    if (prevState.status !== 'connected' || state.status === 'connected') {
      return
    }
    set({ mySeatId: null, pending: false })
  })

  return {
    mySeatId: null,
    pending: false,

    claim: seatId => {
      if (get().pending) {
        // Blocks a second claim mid-flight (PLAN.md F2) — the in-flight
        // request's own ack callback is still the only thing that can
        // settle `pending`.
        return
      }
      const socket = getSocket()
      if (!socket) {
        // No connection to claim through — nothing to do, and nothing was
        // set, so there's no `pending` left dangling.
        return
      }
      set({ pending: true })
      socket.emit('seat:claim', { seatId }, (ack: unknown) => {
        if (isSeatClaimAck(ack) && ack.ok) {
          set({ mySeatId: seatId, pending: false })
        } else {
          // Never optimistic (PLAN.md F2): a `{ ok: false }` or malformed
          // ack leaves `mySeatId` exactly as it already was.
          set({ pending: false })
        }
      })
    },

    release: () => {
      // Fire-and-forget is fine here — `handleSeatRelease` always acks
      // `{ ok: true }` — but still go through the socket rather than
      // mutating local state unilaterally.
      getSocket()?.emit('seat:release')
      set({ mySeatId: null })
    },
  }
})
