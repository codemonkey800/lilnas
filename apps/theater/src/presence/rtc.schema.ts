import { z } from 'zod'

// socket.io's own ids are short (default is a 20-char nanoid-ish string) —
// 64 is generous headroom, not a realistic real-world size.
const SOCKET_ID_MAX_LENGTH = 64

// The backend has no DOM lib types (no built-in `RTCIceCandidateInit`), and
// deliberately doesn't need one: per ORCHESTRATE.md §1 and the security
// checklist, this server never inspects SDP/ICE semantically and never logs
// it — it only confirms the payload is plausibly shaped before relaying it
// untouched. Every field is optional/nullable because a real
// `RTCIceCandidateInit` has every field optional too (e.g. the
// end-of-candidates signal is `{ candidate: '' }` with everything else
// omitted).
const IceCandidateInitSchema = z.object({
  candidate: z.string().optional(),
  sdpMid: z.string().nullable().optional(),
  sdpMLineIndex: z.number().nullable().optional(),
  usernameFragment: z.string().optional(),
})

// Discriminated on `kind`. ORCHESTRATE.md §1's `RtcSignal` type collapses
// offer/answer into one arm (`{ kind: 'offer' | 'answer'; sdp: string }`);
// modeling them as two zod branches instead of one is only an internal
// validation-technique difference — the inferred wire shape is identical
// either way (a value satisfying one modeling always satisfies the other),
// so this isn't a contract deviation.
export const RtcSignalSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('offer'), sdp: z.string() }),
  z.object({ kind: z.literal('answer'), sdp: z.string() }),
  z.object({ kind: z.literal('ice'), candidate: IceCandidateInitSchema }),
])

export type RtcSignal = z.infer<typeof RtcSignalSchema>

// `rtc:signal` (client → server) — ORCHESTRATE.md §1.
export const RtcSignalMessageSchema = z.object({
  to: z.string().min(1).max(SOCKET_ID_MAX_LENGTH),
  data: RtcSignalSchema,
})

export type RtcSignalMessage = z.infer<typeof RtcSignalMessageSchema>

// Optional `peer:mute` (client → server) — ORCHESTRATE.md §1.
export const PeerMuteSchema = z.object({
  muted: z.boolean(),
})

export type PeerMute = z.infer<typeof PeerMuteSchema>
