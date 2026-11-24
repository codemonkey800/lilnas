import { z } from 'zod'

import { VALID_CHARACTER_ID_LIST } from './presence.constants'

// Wire contract — 5 discrete locomotion states. An earlier draft had only
// a 2-state idle/walking pair; this 5-state list is what's actually built
// here.
export const ANIM_STATES = [
  'idle',
  'walk_fwd',
  'walk_back',
  'strafe_left',
  'strafe_right',
] as const

export type AnimState = (typeof ANIM_STATES)[number]

// Handshake — client → server, in `socket.handshake.auth`. `characterId` is folded directly into a `z.enum`
// built from the exact same `VALID_CHARACTER_ID_LIST` that
// `presence.constants.ts` derives `VALID_CHARACTER_IDS` from, so
// "well-formed" and "on the allowlist" collapse into this one check — the
// two can never drift independently. This also covers "non-empty": every
// member of the list is a non-empty literal and nothing else parses.
export const HandshakeSchema = z.object({
  characterId: z.enum(VALID_CHARACTER_ID_LIST),
})

export type Handshake = z.infer<typeof HandshakeSchema>

// Presence packet — client → server, ~13 Hz, dead-banded. `p` is the feet position in world space; `y` is yaw in radians only
// (never pitch — yaw only). Zod v4's base
// `z.number()` already rejects `NaN`/`±Infinity` (confirmed against this
// repo's pinned zod@4.1.12 — `.finite()` is a documented no-op in v4), so
// plain `z.number()` alone already satisfies "finite number".
export const PresencePacketSchema = z.object({
  p: z.tuple([z.number(), z.number(), z.number()]),
  y: z.number(),
  a: z.enum(ANIM_STATES),
})

export type PresencePacket = z.infer<typeof PresencePacketSchema>
