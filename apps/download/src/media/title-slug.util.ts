/**
 * Generates a URL-safe title slug from a media title.
 * (Mirrors apps/tdr-bot/src/media/utils/media.utils.ts's generateTitleSlug.)
 */
export function generateTitleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
}
