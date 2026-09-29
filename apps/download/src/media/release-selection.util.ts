import type { Release } from '@lilnas/utils/download/types'

/**
 * A release that may carry Sonarr's episode mapping. Structural rather than
 * `SonarrRelease` so this util doesn't import the service module - any
 * `Release` (a Radarr one included) satisfies it with the fields absent.
 */
export type EpisodeMappedRelease = Release & {
  mappedEpisodeNumbers?: number[]
}

/**
 * Whether the app may grab a release at all: not rejected upstream (quality
 * profile mismatch, unmet cutoff and so on - Radarr/Sonarr would refuse the
 * grab anyway), allowed to download, and not flagged as bad by a user.
 *
 * `downloadAllowed` is required to be `true`, not merely "not `false`":
 * `toCommonRelease` always defaults a missing upstream value to `false`, so
 * the field is never `undefined` here and an absent value already reads as
 * "not allowed".
 */
function isEligible(
  release: Release,
  flaggedGuids: ReadonlySet<string>,
): boolean {
  return (
    !release.rejected &&
    release.downloadAllowed &&
    !flaggedGuids.has(release.guid)
  )
}

/**
 * The app's own release pick for a movie or one episode, used only when a
 * title has flagged releases and a search command (`MoviesSearch`,
 * `EpisodeSearch`, ...) therefore can't be trusted to avoid them - see
 * `startSearch` (start-search.ts).
 *
 * Takes the **first** eligible release in the order Radarr/Sonarr returned
 * them. That order is already their own preference (quality, custom-format
 * score, protocol, indexer priority, ...), so re-ranking here - by seeders,
 * say - would only override the user's profile and sink usenet releases,
 * which report no seeders at all. Returns `undefined` when nothing is
 * eligible, which the caller turns into a `not_found` job noted "No usable
 * release — every result is flagged or rejected", rather than a silent
 * no-op.
 */
export function pickBestRelease<R extends Release>(
  releases: readonly R[],
  flaggedGuids: ReadonlySet<string>,
): R | undefined {
  return releases.find(release => isEligible(release, flaggedGuids))
}

/**
 * The season-scope pick: every release needed to cover a season's missing
 * episodes, in the order Radarr/Sonarr returned them.
 *
 * - The first eligible full-season pack wins outright - one grab covers the
 *   whole season, which is what Sonarr's own season search prefers too.
 * - Otherwise, greedily, the first eligible release that covers at least one
 *   still-missing episode and overlaps none already covered. A multi-episode
 *   release (E01E02) counts for every episode it maps to, so it can't be
 *   grabbed alongside a single-episode release for either of them.
 * - Nothing eligible gives `[]`.
 *
 * Episode numbers come from `mappedEpisodeNumbers` (Sonarr's resolution after
 * scene/absolute numbering) when present, else the parsed `episodeNumbers`.
 * A release with neither can't be placed, so it's skipped.
 */
export function pickSeasonReleases<R extends EpisodeMappedRelease>(
  releases: readonly R[],
  flaggedGuids: ReadonlySet<string>,
  missingEpisodeNumbers: readonly number[],
): R[] {
  const eligible = releases.filter(release => isEligible(release, flaggedGuids))

  const pack = eligible.find(release => release.fullSeason === true)
  if (pack) {
    return [pack]
  }

  // `covered` holds every episode a picked release brings, missing or not -
  // grabbing a second copy of an episode that already has a file is just as
  // wasteful as a second copy of a missing one. `remaining` is only the
  // missing ones still unclaimed, and ends the walk once it's empty.
  const remaining = new Set(missingEpisodeNumbers)
  const covered = new Set<number>()
  const picked: R[] = []

  for (const release of eligible) {
    if (remaining.size === 0) {
      break
    }

    const episodes =
      release.mappedEpisodeNumbers ?? release.episodeNumbers ?? []
    const overlaps = episodes.some(episode => covered.has(episode))
    const coversMissing = episodes.some(episode => remaining.has(episode))

    if (overlaps || !coversMissing) {
      continue
    }

    picked.push(release)
    for (const episode of episodes) {
      covered.add(episode)
      remaining.delete(episode)
    }
  }

  return picked
}
