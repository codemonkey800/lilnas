import { createHash } from 'crypto'

/**
 * Opaque cursor for descending `(sortKey, id)` pagination over `jobs` (see
 * `jobs.repo.ts`). Opaque rather than a plain integer - unlike tdr-code's
 * `sessions.repo.ts`, which pages over an autoincrement integer PK that's
 * already a total order, neither of this file's two sort keys is: `jobs.id`
 * is a nanoid with no order, and the gallery's `media_id` is a derived
 * string. That's exactly why a composite `(sortKeyMs, id)` key is needed.
 *
 * Deliberately generic over *which* millisecond timestamp and *which* id -
 * the per-job list endpoints page on `(jobs.created_at, jobs.id)` while the
 * gallery pages on `(MAX(jobs.created_at), jobs.media_id)`. One codec for
 * both, rather than a third near-identical one alongside discovery's.
 */
export interface ListCursor {
  sortKeyMs: number
  id: string
  filterKey: string
}

export function encodeListCursor(cursor: ListCursor): string {
  const raw = `${cursor.sortKeyMs}:${cursor.id}:${cursor.filterKey}`
  return Buffer.from(raw, 'utf8').toString('base64url')
}

/**
 * Decodes and validates an opaque cursor string. Returns `undefined` on any
 * malformed input (bad base64, missing field, non-numeric timestamp) - the
 * caller is expected to turn that into a 400, never a silent fall-back to
 * page 1.
 *
 * `expectedFilterKey` guards against a cursor being replayed under a
 * different filter than the one it was minted for - without this, a
 * changed filter would silently skip or duplicate rows rather than
 * failing loudly. See `computeFilterKey()` below.
 *
 * The raw payload is split on the *first* and *last* `:` rather than a
 * plain `split(':')` - nanoid ids can contain `-`/`_` but never `:`, and
 * `computeFilterKey()`'s hex output never contains `:` either, so the
 * outer two colons unambiguously delimit exactly three fields even though
 * neither `id` nor `filterKey` is escaped.
 */
export function decodeListCursor(
  encoded: string,
  expectedFilterKey: string,
): ListCursor | undefined {
  const raw = Buffer.from(encoded, 'base64url').toString('utf8')

  const firstColon = raw.indexOf(':')
  const lastColon = raw.lastIndexOf(':')
  if (firstColon === -1 || firstColon === lastColon) {
    return undefined
  }

  const sortKeyMsRaw = raw.slice(0, firstColon)
  const id = raw.slice(firstColon + 1, lastColon)
  const filterKey = raw.slice(lastColon + 1)

  if (!id || !filterKey || filterKey !== expectedFilterKey) {
    return undefined
  }

  // A plain `Number(sortKeyMsRaw)` isn't enough on its own - `Number('')`
  // and `Number('  ')` both coerce to `0` rather than `NaN`, which would
  // otherwise let an empty timestamp field silently validate as midnight
  // 1970. Requiring the raw field to already look like an integer closes
  // that gap before the numeric conversion ever runs.
  if (!/^-?\d+$/.test(sortKeyMsRaw)) {
    return undefined
  }

  const sortKeyMs = Number(sortKeyMsRaw)
  if (!Number.isInteger(sortKeyMs)) {
    return undefined
  }

  return { sortKeyMs, filterKey, id }
}

/**
 * A short, deterministic hash of a normalized filter object, embedded in
 * every cursor minted for that filter. Object keys are sorted recursively
 * (not just via `JSON.stringify`'s own key order) so two filter objects
 * built with the same values in a different property order still hash
 * identically - callers should not have to normalize key order themselves.
 * Array element order is preserved, since it's meaningful (e.g. a
 * `statuses` filter list).
 */
export function computeFilterKey(filter: unknown): string {
  return createHash('sha256')
    .update(stableStringify(filter))
    .digest('hex')
    .slice(0, 16)
}

function stableStringify(value: unknown): string {
  // Must come before the generic object branch below - a `Date` has no own
  // enumerable properties, so `Object.entries()` would otherwise serialize
  // every distinct date to the same `{}`, colliding filter keys for two
  // gallery requests that differ only in `createdFrom`/`createdTo`.
  if (value instanceof Date) {
    return JSON.stringify(value.getTime())
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }

  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

    return `{${entries
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}
