import type { Release } from '@lilnas/utils/download/types'

/**
 * Milliseconds since epoch for a release's publish date, or `0` when it has
 * none (or an unparseable one). `0` sorts a dateless release last under the
 * newest-first comparison, which is the right default: an entry the indexer
 * couldn't date is the one we know least about.
 */
function publishedAtMs(release: Release): number {
  const parsed = release.publishDate ? Date.parse(release.publishDate) : NaN
  return Number.isNaN(parsed) ? 0 : parsed
}

/**
 * Deliberately simple and fully deterministic: custom-format score, then
 * seeders, then publish date - all descending. This is *not* trying to
 * out-think Radarr/Sonarr's own scoring, which is what the untouched
 * command path still uses for every title with no flags. It only has to
 * answer "which of these remaining releases should we take" well enough to
 * beat the alternative, which is failing the request outright.
 */
function compareReleases(a: Release, b: Release): number {
  const byScore = (b.customFormatScore ?? 0) - (a.customFormatScore ?? 0)
  if (byScore !== 0) {
    return byScore
  }

  const bySeeders = (b.seeders ?? 0) - (a.seeders ?? 0)
  if (bySeeders !== 0) {
    return bySeeders
  }

  return publishedAtMs(b) - publishedAtMs(a)
}

/**
 * The app's own release pick, used only when a title has flagged releases and
 * the generic `MoviesSearch`/`SeriesSearch` command therefore can't be
 * trusted to avoid them.
 *
 * Drops two kinds of release: ones a user flagged as bad, and ones the
 * upstream service already rejected (quality profile mismatch, unmet cutoff,
 * and so on - Radarr/Sonarr would refuse the grab anyway). Returns
 * `undefined` when nothing survives, which the caller turns into a failed
 * job with a descriptive error rather than a silent no-op.
 */
export function pickBestRelease(
  releases: readonly Release[],
  flaggedGuids: ReadonlySet<string>,
): Release | undefined {
  const candidates = releases.filter(
    release => !release.rejected && !flaggedGuids.has(release.guid),
  )

  if (candidates.length === 0) {
    return undefined
  }

  // Copied before sorting - `releases` is the caller's array, and an
  // in-place sort of a list it may still be logging or returning is a
  // surprise nobody asked for.
  return [...candidates].sort(compareReleases)[0]
}
