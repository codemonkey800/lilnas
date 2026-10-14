/**
 * A title reduced to what a person means by it: lowercase letters and digits
 * only, so "Vision Quest", "VisionQuest" and "vision-quest" compare equal.
 */
export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

/** Whether any result's title is the query, give or take spacing/punctuation. */
export function hasTitleMatch(
  query: string,
  results: readonly { title: string }[],
): boolean {
  const wanted = normalizeTitle(query)
  return wanted !== '' && results.some(r => normalizeTitle(r.title) === wanted)
}

/**
 * Searches `query`, and when no result's title matches it, searches again
 * with the spaces taken out. Sonarr/Radarr lookups are word-based, so a title
 * styled as one word ("VisionQuest") never comes back for the spaced-out
 * query ("Vision Quest") - the user gets a list of near misses instead.
 *
 * The second search's exact title matches lead the merged list, then the
 * first search's results, then the rest; `key` dedupes across the two.
 * A failure of the second search falls back to the first's results.
 */
export async function searchWithCompactFallback<T extends { title: string }>(
  query: string,
  search: (term: string) => Promise<T[]>,
  key: (result: T) => number,
): Promise<T[]> {
  const results = await search(query)

  const compact = query.replace(/\s+/g, '')
  if (compact === query.trim() || hasTitleMatch(query, results)) {
    return results
  }

  let compactResults: T[]
  try {
    compactResults = await search(compact)
  } catch {
    return results
  }

  const wanted = normalizeTitle(query)
  const exact = compactResults.filter(r => normalizeTitle(r.title) === wanted)
  if (exact.length === 0) return results

  const seen = new Set<number>()
  return [...exact, ...results, ...compactResults].filter(result => {
    const id = key(result)
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}
