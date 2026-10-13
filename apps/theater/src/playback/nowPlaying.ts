// Emby image kinds this app's proxy route accepts. Mirrors
// `src/emby/emby.schema.ts`'s `ItemImageQuerySchema.type` enum — hand-mirrored
// across the frontend/backend boundary like every other wire shape in this app
// (see `nowPlayingStore.ts`'s "Keep in sync" note).
export type ArtworkType = 'Primary' | 'Backdrop' | 'Thumb' | 'Logo'

export type ArtworkOptions = {
  type?: ArtworkType
  maxWidth?: number
}

/**
 * URL for an item's artwork through the backend's Emby image proxy.
 *
 * Omitting both options reproduces the poster grid's existing request exactly
 * (`Primary` at the backend's default width), so the tablet and the player
 * share one cache entry for the same poster.
 */
export function buildArtworkUrl(
  itemId: string,
  options: ArtworkOptions = {},
): string {
  const search = new URLSearchParams()
  if (options.type !== undefined) {
    search.set('type', options.type)
  }
  if (options.maxWidth !== undefined) {
    search.set('maxWidth', String(options.maxWidth))
  }
  const query = search.toString()
  const base = `/api/theater/items/${encodeURIComponent(itemId)}/image`
  return query.length > 0 ? `${base}?${query}` : base
}
