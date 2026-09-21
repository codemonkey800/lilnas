import { z } from 'zod'

// ──────────────────────────────────────────────────────────────────────────────
// Request-body validation for the one WRITE route on the internal surface
// (POST /internal/discord-identity). Mirrors src/admin/admin.dto.ts's file
// convention — a schema plus its inferred type, parsed at the call site with
// safeParse() and turned into a BadRequestException — because this app has no
// global ValidationPipe and no class-validator: a @Body() annotation is erased
// at runtime and checks nothing on its own.
//
// This schema matters more than admin.dto.ts's do. Those routes sit behind
// AdminGuard; this one is reachable, ungated, by any container on the Docker
// network (see discord-internal.controller.ts's class comments), so this
// schema IS the only thing standing between an arbitrary JSON body and a row
// in discord_identity.
// ──────────────────────────────────────────────────────────────────────────────

// A Discord snowflake: 17–20 digits, matching
// packages/utils/src/auth/types.ts's documented contract for
// DiscordIdentity.discordUserId. Validated as a STRING of digits and never
// coerced to a number — snowflakes exceed Number.MAX_SAFE_INTEGER, so a
// numeric round-trip silently corrupts the low digits of a real ID. The
// bounds are deliberately loose at both ends (Discord's epoch-based IDs are
// 17–19 digits today, with room reserved as the timestamp component grows)
// rather than pinned to a single length that a future account would fail.
const DISCORD_SNOWFLAKE = /^\d{17,20}$/

export const RegisterDiscordIdentityBodySchema = z.object({
  discordUserId: z
    .string()
    .regex(DISCORD_SNOWFLAKE, 'discordUserId must be a Discord snowflake'),
  // Discord's own constraint on a username: 2–32 characters. Bounded on both
  // ends rather than just `.min(1)` so that neither an empty label nor an
  // unbounded blob reaches the roster the admin link UI renders.
  username: z.string().min(2, 'username must be at least 2 characters').max(32),
  // Discord's globalName, which is genuinely null for accounts that never set
  // one. `.nullish()` (not `.optional()`) accepts both an omitted key and an
  // explicit null, which is exactly upsertIdentity()'s
  // `displayName?: string | null` input — callers decoding an upstream Discord
  // payload shouldn't have to spell `?? null` before posting.
  displayName: z.string().max(32).nullish(),
})

export type RegisterDiscordIdentityBodyDto = z.infer<
  typeof RegisterDiscordIdentityBodySchema
>
