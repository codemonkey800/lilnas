import { z } from 'zod'

// ──────────────────────────────────────────────────────────────────────────────
// S3: request-body validation for admin.controller.ts's mutating routes.
// Mirrors apps/tdr-code/src/console/auth-admin.dto.ts's file convention
// (a schema + its inferred type, per route body shape) and that app's
// lifecycle.controller.ts call-site pattern — safeParse(), then
// `BadRequestException(parsed.error.issues[0]?.message ?? '…')` on failure.
//
// Nest's @Body() decorator hands back whatever JSON.parse() produced, typed
// only by a TypeScript annotation that is erased at runtime — nothing
// upstream of these routes actually checks the shape matches. Before this,
// `setUserService`'s `grant: boolean` annotation was a lie a caller could
// violate for free: the JSON string "false" deserializes to the STRING
// "false", and `if (body.grant)` treats any non-empty string as truthy,
// silently granting when the caller meant to revoke. z.boolean() rejects
// that string outright instead of coercing or truthily testing it.
// ──────────────────────────────────────────────────────────────────────────────

export const BulkRejectBodySchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
})
export type BulkRejectBodyDto = z.infer<typeof BulkRejectBodySchema>

// M3: both bodies below take an ARRAY (serviceHosts / changes) rather than
// a single host — the admin dashboard's Add-person and Edit-access modals
// used to call their single-host counterparts once per checkbox, each a
// separate HTTP round trip and a separate backend transaction. See
// UsersService.preAuthorizeMany()/setUserServices()'s own comments for the
// "one transaction for the whole batch" half of this fix.
export const PreAuthorizeBodySchema = z.object({
  email: z.string().email(),
  serviceHosts: z.array(z.string().min(1)).min(1),
})
export type PreAuthorizeBodyDto = z.infer<typeof PreAuthorizeBodySchema>

export const SetUserServicesBodySchema = z.object({
  changes: z
    .array(z.object({ serviceHost: z.string().min(1), grant: z.boolean() }))
    .min(1),
})
export type SetUserServicesBodyDto = z.infer<typeof SetUserServicesBodySchema>

// ──────────────────────────────────────────────────────────────────────────────
// Discord link/unlink bodies.
//
// NOTE WHAT IS ABSENT: there is no `username` (or `displayName`) field on
// either schema, and there deliberately never will be. A Discord handle is
// NEVER admin-entered — db/schema.ts's own discord_identity header comment
// is explicit that the roster fills itself in by OBSERVATION (tdr-bot
// reporting an account that actually ran /download), and that the admin UI
// is two pick-from-a-list columns rather than a text box. Accepting a handle
// here would re-open exactly the mistake the two-table schema exists to make
// impossible: a mistyped handle persisted as though it were an identity.
// The handle the admin sees is joined out of discord_identity at read time.
// ──────────────────────────────────────────────────────────────────────────────

// The snowflake is validated as a 17–20-digit decimal string and kept a
// STRING end to end — a Discord snowflake is a 64-bit integer and exceeds
// Number.MAX_SAFE_INTEGER, so z.number() (or any coercion through one) would
// silently round it into a different account's id. 17–20 digits covers every
// snowflake Discord has issued and every one it can issue before ~2090; the
// upper bound is what rejects an obviously-pasted-wrong value rather than
// letting it reach the foreign key.
//
// An explicit message is supplied because AdminController.parseBody()
// surfaces `issues[0].message` verbatim to the admin — zod's default for a
// failed regex ("Invalid string: must match pattern /^\d{17,20}$/") is not
// something to show a human.
export const LinkDiscordBodySchema = z.object({
  userId: z.string().min(1),
  discordUserId: z
    .string()
    .regex(
      /^\d{17,20}$/,
      'discordUserId must be a Discord snowflake (17-20 digits)',
    ),
})
export type LinkDiscordBodyDto = z.infer<typeof LinkDiscordBodySchema>

// Unlink is keyed by the PERSON alone, never by the snowflake: the link is
// one-to-one both ways (schema.ts's two unique indexes), so the user id
// already identifies exactly one row, and asking for both halves would only
// create a way for the two to disagree.
export const UnlinkDiscordBodySchema = z.object({
  userId: z.string().min(1),
})
export type UnlinkDiscordBodyDto = z.infer<typeof UnlinkDiscordBodySchema>
