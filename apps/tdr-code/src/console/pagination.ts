// Keyset cursor codec: cursor = raw integer id of last returned row.
// Callers fetch limit+1 rows; paginate() slices them and computes nextCursor.

export type Paginated<T> = {
  items: T[]
  nextCursor: number | null
}

export function paginate<T extends { id: number }>(
  rows: T[],
  limit: number,
): Paginated<T> {
  if (rows.length > limit) {
    return {
      items: rows.slice(0, limit),
      nextCursor: rows[limit - 1].id,
    }
  }
  return { items: rows, nextCursor: null }
}
