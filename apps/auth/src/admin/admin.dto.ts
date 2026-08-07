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

export const PreAuthorizeBodySchema = z.object({
  email: z.string().email(),
  serviceHost: z.string().min(1),
})
export type PreAuthorizeBodyDto = z.infer<typeof PreAuthorizeBodySchema>

export const SetUserServiceBodySchema = z.object({
  serviceHost: z.string().min(1),
  grant: z.boolean(),
})
export type SetUserServiceBodyDto = z.infer<typeof SetUserServiceBodySchema>
