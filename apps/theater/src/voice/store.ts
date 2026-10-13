'use client'

import { create } from 'zustand'

// ---------------------------------------------------------------------------
// Voice-chat client state (PLAN.md "Phase 4B — Spatial voice chat" / VF1 —
// ORCHESTRATE.md §1's "src/voice/store.ts" contract). Mirrors
// multiplayer/store.ts's split between what re-renders and what doesn't:
//
//   - `muted` and `permissionState` are the two bits of voice state a
//     component ever needs to react to (a mute-icon toggle — VF4's `M`
//     binding in viewControls.ts — and a mic-availability indicator — VF5's
//     `Scene/MicIndicator.tsx`), so they're the only things that live in
//     zustand.
//   - `pcs`/`inbound` are plain module-level Maps, mutated directly by
//     peerConnections.ts (VF2, this unit's other half) — WebRTC connection
//     setup must never trigger a React re-render, the same "hot path never
//     goes through set()" discipline multiplayer/store.ts's peerBuffers
//     already established. A later unit's `<PeerVoice id />` (VF3) reads
//     `inbound.get(id)` directly inside its own useFrame/effect, never via a
//     store hook.
//   - The local mic MediaStream is deliberately NOT exported as a plain
//     binding either (see `ensureLocalStream`/`getLocalStream` below) —
//     mirrors `sharedSocket`/`getSocket()` in multiplayer/store.ts, not
//     `peerBuffers`, since acquiring it is an async, fallible operation with
//     its own singleton-request bookkeeping, not a value that's simply
//     "there" once connected.
// ---------------------------------------------------------------------------

// Tri-state outcome of the one `getUserMedia()` prompt `ensureLocalStream()`
// below ever fires (PLAN.md "VF5 — permission UX"): `'unknown'` until a peer
// connection first asks for the local track (no prompt has happened yet),
// then `'granted'`/`'denied'` once that settles — permanently, since
// `ensureLocalStream()` itself never re-prompts (see its cached-outcome
// doc comment). `Scene/MicIndicator.tsx` (VF5) is the reader.
export type VoicePermissionState = 'unknown' | 'granted' | 'denied'

export type VoiceStore = {
  muted: boolean
  setMuted: (muted: boolean) => void
  permissionState: VoicePermissionState
  setPermissionState: (permissionState: VoicePermissionState) => void
}

export const useVoiceStore = create<VoiceStore>(set => ({
  muted: false,
  setMuted: muted => set({ muted }),
  permissionState: 'unknown',
  setPermissionState: permissionState => set({ permissionState }),
}))

// Module-level, non-React (ORCHESTRATE.md §1) — one RTCPeerConnection, and
// (once its `ontrack` fires) one inbound MediaStream, per connected peer,
// keyed by the same peer id as multiplayer/store.ts's `peerBuffers`.
// peerConnections.ts owns the lifecycle (create/close); nothing else writes
// to these two Maps.
export const pcs = new Map<string, RTCPeerConnection>()
export const inbound = new Map<string, MediaStream>()

// ---------------------------------------------------------------------------
// STUN configuration — peerConnections.ts builds every RTCPeerConnection's
// RTCConfiguration from this. PLAN.md "Security / infra": "TURN is not
// included" — a full mesh at friends-scale needs no SFU/TURN of its own;
// public STUN is enough for NAT traversal on ordinary home networks.
// ---------------------------------------------------------------------------

const DEFAULT_STUN_URL = 'stun:stun.l.google.com:19302'

function parseStunUrls(raw: string | undefined): string[] {
  const urls = (raw ?? '')
    .split(',')
    .map(url => url.trim())
    .filter(url => url.length > 0)
  return urls.length > 0 ? urls : [DEFAULT_STUN_URL]
}

// NEXT_PUBLIC_STUN_URLS (comma-separated, optional — see .env.example)
// falling back to a single public default when unset/empty.
export const STUN_URLS: string[] = parseStunUrls(
  process.env.NEXT_PUBLIC_STUN_URLS,
)

// ---------------------------------------------------------------------------
// Local mic acquisition — lazy, at-most-once, never throws.
// ---------------------------------------------------------------------------

// All three are the browser's own built-in audio processing, not anything
// this app implements (PLAN.md "VF1").
const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
}

// Module-level singleton. Never touched at module-eval time — only from
// inside ensureLocalStream(), itself only ever invoked on demand (by
// whichever side of a peer connection first needs to add a local track — see
// peerConnections.ts). Mirrors playback/store.ts's `sharedVideoElement`
// pattern: this module is imported by 'use client' components that Next.js
// still module-evaluates during SSR/RSC, where `navigator`/a mic prompt make
// no sense yet.
let sharedLocalStream: MediaStream | null = null
// True once ensureLocalStream() has settled, on EITHER outcome — this is
// what makes the "at most once" guarantee hold even on the failure path: a
// denied permission or an unsupported browser is cached as "no stream" and
// never retried (never re-prompts the user, never re-probes
// `mediaDevices`), rather than firing a fresh getUserMedia() every time a
// new peer connection asks for the local track.
let localStreamSettled = false
// De-dupes concurrent callers (e.g. several peers appearing in the same
// peerIds diff, each independently asking for the local track) so at most
// one real getUserMedia() request is ever in flight at a time.
let pendingLocalStream: Promise<MediaStream | null> | null = null

/**
 * Returns the cached local mic stream without ever triggering acquisition —
 * for a caller that only wants to check what's already there (e.g. the mute
 * toggle a later unit, VF4, builds). Returns `null` before the first
 * successful `ensureLocalStream()` resolution, including while one is still
 * pending or after it settled with no stream.
 */
export function getLocalStream(): MediaStream | null {
  return sharedLocalStream
}

/**
 * Lazily acquires the one local mic MediaStream this client ever needs.
 * Calls `getUserMedia` at most once for the lifetime of the module
 * (module-level singleton, mirroring playback/store.ts's `sharedVideoElement`
 * pattern) and caches the outcome — success or failure — so every subsequent
 * caller gets the same cached answer instantly instead of re-prompting.
 *
 * Never throws: on SSR, a browser without `mediaDevices.getUserMedia`, a
 * denied permission, or no mic device, this resolves to `null`. Callers are
 * expected to proceed WITHOUT adding a local track in that case — you can
 * still receive/hear other peers even if your own mic is unavailable
 * (graceful degradation).
 *
 * Side effect (VF5): every path below that settles this promise also writes
 * `useVoiceStore`'s `permissionState` — `'granted'` right after a successful
 * `getUserMedia`, `'denied'` on any failure or unsupported-browser/SSR path
 * — so `Scene/MicIndicator.tsx` can render the outcome reactively instead of
 * polling this function. Purely additive: the signature, return value, and
 * caching behavior above are unchanged; this just piggybacks a `set()` onto
 * the same branches that already cache the outcome.
 */
export function ensureLocalStream(): Promise<MediaStream | null> {
  if (sharedLocalStream) {
    return Promise.resolve(sharedLocalStream)
  }
  if (pendingLocalStream) {
    return pendingLocalStream
  }
  if (localStreamSettled) {
    return Promise.resolve(null)
  }
  if (
    typeof navigator === 'undefined' ||
    typeof navigator.mediaDevices?.getUserMedia !== 'function'
  ) {
    localStreamSettled = true
    useVoiceStore.getState().setPermissionState('denied')
    return Promise.resolve(null)
  }

  pendingLocalStream = navigator.mediaDevices
    .getUserMedia({ audio: AUDIO_CONSTRAINTS })
    .then(stream => {
      sharedLocalStream = stream
      useVoiceStore.getState().setPermissionState('granted')
      return stream
    })
    .catch(() => {
      useVoiceStore.getState().setPermissionState('denied')
      return null
    })
    .finally(() => {
      localStreamSettled = true
      pendingLocalStream = null
    })

  return pendingLocalStream
}
