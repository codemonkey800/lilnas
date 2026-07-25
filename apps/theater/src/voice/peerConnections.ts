import { getSocket, useMultiplayerStore } from 'src/multiplayer/store'

import { ensureLocalStream, inbound, pcs, STUN_URLS } from './store'

// ---------------------------------------------------------------------------
// Peer-connection lifecycle for voice chat (PLAN.md "Phase 4B", VF2 —
// ORCHESTRATE.md §1's "src/voice/peerConnections.ts" contract). No React
// here (matches viewControls.ts/avatarInterp.ts's convention of skipping
// 'use client' on a logic-only module that's always imported transitively
// from an already-'use client' file) — this module only ever mutates the
// module-level Maps in store.ts and talks to the signaling socket.
//
// Entry point: `ensureVoiceInitialized()`. There is no explicit call site in
// this unit's scope — a later unit (VF3) calls it once from `<PeerVoice>`'s
// mount effect. Everything else here is private machinery driven off that
// one call.
// ---------------------------------------------------------------------------

// Keep in sync with src/presence/rtc.schema.ts's `RtcSignal` /
// ORCHESTRATE.md §1's wire contract. Hand-mirrored rather than imported —
// this app's established convention for crossing the frontend/backend
// boundary (see multiplayer/store.ts's "hand-duplicated wire types"
// comment) — so a NestJS-decorator-laden module never has a path into the
// Next.js bundle graph.
type RtcSignal =
  | { kind: 'offer'; sdp: string }
  | { kind: 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }

type RtcSignalEnvelope = { from: string; data: RtcSignal }

type PeerMutePayload = { id: string; muted: boolean }

// ---------------------------------------------------------------------------
// Defensive validation for every inbound socket payload — this app's
// established convention (multiplayer/store.ts's isPeerSnapshot et al.):
// never let a malformed message reach `setRemoteDescription`/
// `addIceCandidate` or get JSON-shaped assumptions made about it.
// ---------------------------------------------------------------------------

function isIceCandidateInit(value: unknown): value is RTCIceCandidateInit {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  if (v.candidate !== undefined && typeof v.candidate !== 'string') {
    return false
  }
  if (
    v.sdpMid !== undefined &&
    v.sdpMid !== null &&
    typeof v.sdpMid !== 'string'
  ) {
    return false
  }
  if (
    v.sdpMLineIndex !== undefined &&
    v.sdpMLineIndex !== null &&
    typeof v.sdpMLineIndex !== 'number'
  ) {
    return false
  }
  if (
    v.usernameFragment !== undefined &&
    typeof v.usernameFragment !== 'string'
  ) {
    return false
  }
  return true
}

function isRtcSignal(value: unknown): value is RtcSignal {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  if (v.kind === 'offer' || v.kind === 'answer') {
    return typeof v.sdp === 'string'
  }
  if (v.kind === 'ice') {
    return isIceCandidateInit(v.candidate)
  }
  return false
}

function isRtcSignalEnvelope(value: unknown): value is RtcSignalEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return typeof v.from === 'string' && v.from.length > 0 && isRtcSignal(v.data)
}

function isPeerMutePayload(value: unknown): value is PeerMutePayload {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' && v.id.length > 0 && typeof v.muted === 'boolean'
  )
}

// ---------------------------------------------------------------------------
// Glare rule (decision #2, PLAN.md "Phase 4B"): a plain string comparison of
// socket ids, computed identically and independently by both sides of a
// pair, so they always agree on who offers without any handshake. Pulled out
// as a standalone pure function (rather than inlined at its one call site)
// purely so it's unit-testable with two literal strings, no socket/WebRTC
// runtime required.
// ---------------------------------------------------------------------------

/**
 * `true` when `selfId` should send the offer to `peerId` (and therefore must
 * NOT also answer one from them); `false` means the reverse — only ever
 * answer an incoming offer from `peerId`, never send one.
 */
export function isOfferer(selfId: string, peerId: string): boolean {
  return selfId < peerId
}

// ---------------------------------------------------------------------------
// Per-peer ICE-candidate buffer (decision #3, PLAN.md "Phase 4B"):
// `RTCPeerConnection.addIceCandidate()` throws/fails if called before the
// remote description is set, and a trickled candidate can legitimately race
// ahead of the offer/answer that pairs with it once handlers start awaiting
// (see handleOffer/handleIce below). Enqueue/drain are pulled out as
// standalone, Map-parametrized functions (rather than closing over the
// module-level `iceBuffers` Map directly) purely so they're unit-testable
// with a throwaway Map — no RTCPeerConnection/real WebRTC runtime required
// (jsdom implements neither).
// ---------------------------------------------------------------------------

const iceBuffers = new Map<string, RTCIceCandidateInit[]>()

/** Queues a candidate for `peerId`, preserving arrival order. */
export function enqueueIceCandidate(
  buffers: Map<string, RTCIceCandidateInit[]>,
  peerId: string,
  candidate: RTCIceCandidateInit,
): void {
  const buffer = buffers.get(peerId)
  if (buffer) {
    buffer.push(candidate)
  } else {
    buffers.set(peerId, [candidate])
  }
}

/**
 * Removes and returns every candidate queued for `peerId`, in the order they
 * were enqueued. An absent/empty entry returns `[]`, never throws.
 */
export function drainIceCandidates(
  buffers: Map<string, RTCIceCandidateInit[]>,
  peerId: string,
): RTCIceCandidateInit[] {
  const buffer = buffers.get(peerId)
  buffers.delete(peerId)
  return buffer ?? []
}

// ---------------------------------------------------------------------------
// Peer-connection lifecycle.
// ---------------------------------------------------------------------------

// Bare RTCPeerConnection creation + event wiring only — no local track, no
// offer/answer. Synchronous and idempotent-safe to call via
// `pcs.get(id) ?? createPeerConnection(id)` from either the local
// diff-triggered path (connectToPeer) or an incoming offer (handleOffer),
// which can legitimately race each other when both sides discover a new
// peer near-simultaneously (PLAN.md "Phase 4B" / decision #6's callout).
function createPeerConnection(peerId: string): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: [{ urls: STUN_URLS }] })
  pcs.set(peerId, pc)

  pc.ontrack = event => {
    const [stream] = event.streams
    if (stream) {
      inbound.set(peerId, stream)
    }
  }

  pc.onicecandidate = event => {
    if (event.candidate) {
      getSocket()?.emit('rtc:signal', {
        to: peerId,
        data: { kind: 'ice', candidate: event.candidate.toJSON() },
      })
    }
  }

  // Lifecycle-only logging — peer id + connection state, never SDP/ICE
  // contents (security checklist, ORCHESTRATE.md §1 / PLAN.md "Voice (4B)":
  // "never log SDP/candidates").
  pc.onconnectionstatechange = () => {
    console.log(
      `[voice] peer ${peerId} connection state -> ${pc.connectionState}`,
    )
  }

  return pc
}

// Adds the local mic track to `pc` if one is available, before any SDP is
// generated — both the offerer and the answerer need this (decision #4).
// Idempotent against `pc.getSenders()`: this can legitimately run twice
// concurrently for the SAME `pc` when connectToPeer (the local diff) and
// handleOffer (an incoming offer for the same peer) race each other and both
// await the same in-flight ensureLocalStream() call — both continuations
// resume in order with no further await between them, so the second one's
// getSenders() check always sees whatever the first one just added.
async function attachLocalTrack(pc: RTCPeerConnection): Promise<void> {
  const stream = await ensureLocalStream()
  if (!stream) {
    // Graceful degradation (PLAN.md "VF5"): no mic, permission denied, or
    // SSR — proceed without a local track. This peer can still be heard;
    // they just won't hear us.
    return
  }
  const existingTracks = new Set(pc.getSenders().map(sender => sender.track))
  for (const track of stream.getTracks()) {
    if (!existingTracks.has(track)) {
      pc.addTrack(track, stream)
    }
  }
}

async function flushIceBuffer(
  peerId: string,
  pc: RTCPeerConnection,
): Promise<void> {
  for (const candidate of drainIceCandidates(iceBuffers, peerId)) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (err) {
      console.warn(`[voice] failed to add buffered ICE for peer ${peerId}`, err)
    }
  }
}

// Drives the "peer appeared" half of the diff in ensureVoiceInitialized:
// creates (or reuses) the connection, attaches whatever local track is
// available, and — only if the glare rule says this side offers — creates
// and sends the offer. The non-offering side does nothing further here; it
// waits for the incoming offer, handled by handleOffer below.
async function connectToPeer(peerId: string): Promise<void> {
  const pc = pcs.get(peerId) ?? createPeerConnection(peerId)
  await attachLocalTrack(pc)

  const amOfferer = isOfferer(getSocket()?.id ?? '', peerId)
  if (!amOfferer) {
    return
  }

  try {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    getSocket()?.emit('rtc:signal', {
      to: peerId,
      data: { kind: 'offer', sdp: offer.sdp ?? '' },
    })
  } catch (err) {
    console.warn(`[voice] failed to create/send offer for peer ${peerId}`, err)
  }
}

function teardownPeerConnection(peerId: string): void {
  pcs.get(peerId)?.close()
  pcs.delete(peerId)
  inbound.delete(peerId)
  iceBuffers.delete(peerId)
}

async function handleOffer(fromId: string, sdp: string): Promise<void> {
  const pc = pcs.get(fromId) ?? createPeerConnection(fromId)
  await attachLocalTrack(pc)

  try {
    await pc.setRemoteDescription({ type: 'offer', sdp })
    await flushIceBuffer(fromId, pc)

    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    getSocket()?.emit('rtc:signal', {
      to: fromId,
      data: { kind: 'answer', sdp: answer.sdp ?? '' },
    })
  } catch (err) {
    console.warn(`[voice] failed to answer offer from peer ${fromId}`, err)
  }
}

async function handleAnswer(fromId: string, sdp: string): Promise<void> {
  const pc = pcs.get(fromId)
  if (!pc) {
    // No connection to answer into — we never offered (or already tore this
    // one down). Nothing to do.
    return
  }
  try {
    await pc.setRemoteDescription({ type: 'answer', sdp })
    await flushIceBuffer(fromId, pc)
  } catch (err) {
    console.warn(`[voice] failed to apply answer from peer ${fromId}`, err)
  }
}

async function handleIce(
  fromId: string,
  candidate: RTCIceCandidateInit,
): Promise<void> {
  const pc = pcs.get(fromId)
  if (pc?.remoteDescription) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate))
    } catch (err) {
      console.warn(
        `[voice] failed to add ICE candidate from peer ${fromId}`,
        err,
      )
    }
    return
  }
  // No connection yet, or one exists but hasn't got a remote description —
  // either way, buffer until flushIceBuffer picks it up (decision #3).
  enqueueIceCandidate(iceBuffers, fromId, candidate)
}

// Registered exactly once (guarded by the module-level `initialized` flag in
// ensureVoiceInitialized, below) against whatever socket is current at that
// moment. Known limitation, out of this unit's scope: this does not rebind
// if the underlying socket is ever replaced by a full disconnect+reconnect
// (multiplayer/store.ts's own StrictMode-guarded teardown creates a brand
// new socket instance on the next connect()) — nothing here observes that
// replacement. Outgoing emits are unaffected (every emit call re-reads
// `getSocket()` fresh), only this inbound registration is bound to a
// specific socket object.
function registerSignalHandlers(): void {
  const socket = getSocket()

  socket?.on('rtc:signal', (payload: unknown) => {
    if (!isRtcSignalEnvelope(payload)) {
      return
    }
    const { from, data } = payload
    if (data.kind === 'offer') {
      void handleOffer(from, data.sdp)
    } else if (data.kind === 'answer') {
      void handleAnswer(from, data.sdp)
    } else {
      void handleIce(from, data.candidate)
    }
  })

  // No per-peer mute storage exists yet: ORCHESTRATE.md §1's PeerSnapshot
  // carries `muted?`, but no unit has claimed a field for it in
  // multiplayer/store.ts, and that file isn't this unit's to extend (see
  // this unit's return summary for the explicit callout). This just
  // confirms the relay is received without crashing — a later unit can add
  // storage once something actually renders it (e.g. a muted-mic icon on a
  // nametag, per PLAN.md's "so peers can show a muted-mic icon").
  socket?.on('peer:mute', (payload: unknown) => {
    if (!isPeerMutePayload(payload)) {
      return
    }
    console.log(`[voice] peer ${payload.id} muted=${payload.muted}`)
  })
}

let initialized = false

/**
 * Idempotent entry point (decision #1, PLAN.md "Phase 4B"): sets up the
 * subscription that drives the whole peer-connection lifecycle from
 * multiplayer/store.ts's `peerIds`, diffing the previous array against the
 * new one on every change to detect peers that appeared vs. disappeared.
 * Works uniformly for the bulk `peers:init` case (peerIds jumps from `[]` to
 * N ids in one store update) and the incremental `peer:join`/`peer:leave`
 * case, because both just look like an array replacement to the diff.
 *
 * Guarded by a module-level flag, so calling this any number of times, from
 * any number of mounted `<PeerVoice>` instances (a later unit, VF3, is the
 * expected caller — from its own mount effect), only ever runs the real
 * setup once.
 */
export function ensureVoiceInitialized(): void {
  if (initialized) {
    return
  }
  initialized = true

  registerSignalHandlers()

  let previousPeerIds: string[] = []
  function syncPeerConnections(nextPeerIds: string[]): void {
    const next = new Set(nextPeerIds)
    const prev = new Set(previousPeerIds)

    for (const id of nextPeerIds) {
      if (!prev.has(id)) {
        void connectToPeer(id)
      }
    }
    for (const id of previousPeerIds) {
      if (!next.has(id)) {
        teardownPeerConnection(id)
      }
    }
    previousPeerIds = nextPeerIds
  }

  // Catches up on whatever's already in the store before reacting to future
  // changes below. `<PeerVoice id />` only ever mounts for a peer that's
  // already in `peerIds` (it's rendered inside that peer's own
  // `<RemoteAvatar>`), so the very call that first initializes voice is
  // commonly ALSO the call for a peer that's already present — a
  // forward-only subscribe would otherwise miss that peer forever, since it
  // only fires on subsequent changes. `previousPeerIds` starts at `[]`, so
  // this is just the diff's first "fire" with an empty baseline.
  syncPeerConnections(useMultiplayerStore.getState().peerIds)

  useMultiplayerStore.subscribe((state, prevState) => {
    if (state.peerIds !== prevState.peerIds) {
      syncPeerConnections(state.peerIds)
    }
  })
}
