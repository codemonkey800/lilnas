/**
 * Shared utilities for media services
 */

/**
 * Recursively maps `null` to `undefined` in a type, bridging SDK types that
 * use `T | null` to Zod schemas that expect `T | undefined`.
 */
export type StripNulls<T> = T extends null
  ? undefined
  : T extends Array<infer U>
    ? Array<StripNulls<U>>
    : T extends object
      ? { [K in keyof T]: StripNulls<T[K]> }
      : T

/**
 * Recursively converts null values to undefined at runtime, paired with the
 * `StripNulls<T>` type so callers get an honest return type.
 */
export function stripNulls<T>(obj: T): StripNulls<T> {
  if (obj === null) return undefined as StripNulls<T>
  if (Array.isArray(obj)) return obj.map(stripNulls) as StripNulls<T>
  if (
    typeof obj === 'object' &&
    Object.getPrototypeOf(obj) === Object.prototype
  ) {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        stripNulls(v),
      ]),
    ) as StripNulls<T>
  }
  return obj as StripNulls<T>
}

/**
 * Extracts a human-readable message from an unknown error value.
 */
export function errorMessage(
  error: unknown,
  fallback = 'Unknown error',
): string {
  return error instanceof Error ? error.message : fallback
}

/**
 * Generates a URL-safe title slug from a media title.
 */
export function generateTitleSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
}

/**
 * Converts a numeric ID to the string form required by SDK endpoints whose
 * OpenAPI spec types the PUT path `id` as `string` while GET/DELETE use
 * `number`. Centralised here so the inconsistency is easy to find and remove
 * when the SDK types are corrected.
 */
export const numericIdAsString = (id: number): string => String(id)

/**
 * Formats a byte count into a human-readable string (e.g. "1.23 GB").
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * Parses a resolution string such as "1920x1080" into a width/height object.
 * Returns null if the string is absent or cannot be parsed.
 */
export function parseResolution(
  res?: string | null,
): { width: number; height: number } | null {
  if (!res) return null
  const [w, h] = res.split('x').map(Number)
  return w && h ? { width: w, height: h } : null
}
