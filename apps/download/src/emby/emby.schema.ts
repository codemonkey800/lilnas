import { z } from 'zod'

/**
 * Minimal zod schemas for the Emby response bodies this app consumes.
 *
 * Emby returns PascalCase keys and a LOT of fields per item; these schemas
 * are deliberately strict only on what we actually read and silent about
 * everything else (`z.object()` strips unknown keys rather than rejecting
 * them), so an Emby upgrade that adds fields is a non-event while one that
 * renames or drops `Id`/`Items` fails loudly at the parse site instead of
 * surfacing as `undefined` three layers away.
 */

/** An entry from `GET /emby/Users`. */
export const EmbyUserSchema = z.object({
  Id: z.string(),
  Name: z.string(),
})
export type EmbyUser = z.infer<typeof EmbyUserSchema>

/** `GET /emby/Users` returns a bare array, not an envelope. */
export const EmbyUsersResponseSchema = z.array(EmbyUserSchema)

/**
 * A library entry from `GET /emby/Users/{userId}/Items`. Only `Id` is
 * guaranteed: `Path` in particular is absent unless `Fields=Path` was
 * requested AND the requesting user has permission to see it.
 */
export const EmbyItemSchema = z.object({
  Id: z.string(),
  Name: z.string().optional(),
  Path: z.string().optional(),
  Type: z.string().optional(),
})
export type EmbyItem = z.infer<typeof EmbyItemSchema>

/**
 * The `/Items` envelope. `TotalRecordCount` is optional because Emby omits
 * it on some endpoints/versions; when it IS present and exceeds
 * `Items.length`, the response was paged (see EmbyService.getLibraryItems).
 */
export const EmbyItemsResponseSchema = z.object({
  Items: z.array(EmbyItemSchema),
  TotalRecordCount: z.number().optional(),
})
export type EmbyItemsResponse = z.infer<typeof EmbyItemsResponseSchema>

/** `GET /emby/System/Info` — used as a reachability/auth probe. */
export const EmbySystemInfoSchema = z.object({
  Id: z.string(),
})
export type EmbySystemInfo = z.infer<typeof EmbySystemInfoSchema>
