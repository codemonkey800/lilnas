import type {
  DownloadJob,
  Episode,
  Media,
  Season,
  Show,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus } from '@lilnas/utils/download/types'

import { jobStatusLabel, latestJob } from 'src/components/detail/job-state'
import type { StatusTone } from 'src/lib/format'
import { formatRuntime, isInProgress, statusTone } from 'src/lib/format'

/**
 * Everything the show detail screen *decides*, in a module with no directive
 * and no JSX.
 *
 * Same split `job-state.ts` makes, for the same two reasons. The season panel
 * is `'use client'` (a tab strip owns which season is open), and every export
 * of a `'use client'` module reaches a server component as an opaque client
 * reference - so the page itself could not call any of this if it lived beside
 * the component. And this is where the load-bearing rules are: which job
 * belongs to which scope, what a season's progress actually adds up to, and
 * the fact that **scope is never expressed by mutating the media id**. Those
 * are worth unit tests that do not need a DOM.
 */

/** Sonarr numbers specials as season 0. They are listed, never filtered out. */
export const SPECIALS_SEASON_NUMBER = 0

/** What the tab, the heading and the delete dialog call a season. */
export function seasonLabel(seasonNumber: number): string {
  return seasonNumber === SPECIALS_SEASON_NUMBER
    ? 'Specials'
    : `Season ${seasonNumber}`
}

/**
 * The `Tabs` value for a season.
 *
 * A string because `Tabs` is keyed on one, and `String(0)` is `'0'` - which is
 * a perfectly good tab value and exactly the reason nothing in this file ever
 * tests a season number for truthiness.
 */
export function seasonTabValue(seasonNumber: number): string {
  return String(seasonNumber)
}

/** `S02E05`. The display code, never an id - see {@link episodeKey}. */
export function episodeCode(
  seasonNumber: number,
  episodeNumber: number,
): string {
  return `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`
}

/**
 * ⚠️ `Episode.id` is **Sonarr's primary key** and the key every scoped
 * operation (search, grab, delete, save) is expressed in;
 * `Episode.episodeNumber` is a display value that repeats across seasons.
 *
 * This exists so the difference is stated once, in a function whose name says
 * which one it returns, rather than being a `.id` somebody has to notice at
 * eight call sites.
 */
export function episodeKey(episode: Episode): number {
  return episode.id
}

/** How much of a scope is on disk. `pct` is 0-100. */
export type ShowProgress = {
  /** Episodes with a file. */
  files: number
  /** `files / total`, 0-100. `0` when `total` is 0 - there is nothing to be part-way through. */
  pct: number
  /** Episodes in the scope. See {@link seasonEpisodeTotal}. */
  total: number
}

/**
 * How many episodes a season has.
 *
 * ⚠️ `Season.episodeCount` and `Season.episodes.length` genuinely disagree,
 * in both directions, and this is the reconciliation:
 *
 * - Sonarr's statistic counts episodes it knows about but has not listed, so
 *   it is the larger and honest number for a season still airing.
 * - It also **excludes specials entirely**. Silicon Valley's season 0 comes
 *   back `episodeCount: 0` with five episodes in `episodes` - and a heading
 *   reading "Specials · 0 episodes" over five rows is simply wrong.
 *
 * So: whichever is larger. The heading then never undercounts the rows
 * underneath it, and never loses an unaired episode Sonarr is already
 * tracking.
 */
export function seasonEpisodeTotal(season: Season): number {
  return Math.max(season.episodeCount, season.episodes.length)
}

function progress(files: number, total: number): ShowProgress {
  // Clamped rather than trusted: `episodeFileCount` is Sonarr's own statistic
  // and `total` may be the listed-episode count, so the two can cross.
  const capped = Math.min(Math.max(files, 0), total)

  return {
    files: capped,
    pct: total === 0 ? 0 : (capped / total) * 100,
    total,
  }
}

/** One season's share of the library, aggregated across its episodes. */
export function seasonProgress(season: Season): ShowProgress {
  return progress(season.episodeFileCount, seasonEpisodeTotal(season))
}

/**
 * The whole series' share, summed across seasons.
 *
 * ⚠️ **Specials are excluded**, which is what Sonarr's own series statistics
 * do. They are opt-in extras almost nobody grabs, and counting them would
 * leave a fully-downloaded series reading `53 of 58 episodes` forever. They
 * are still listed and still individually downloadable - see
 * {@link SPECIALS_SEASON_NUMBER}.
 */
export function seriesProgress(seasons: readonly Season[]): ShowProgress {
  let files = 0
  let total = 0

  for (const season of seasons) {
    if (season.seasonNumber === SPECIALS_SEASON_NUMBER) {
      continue
    }

    files += season.episodeFileCount
    total += seasonEpisodeTotal(season)
  }

  return progress(files, total)
}

/** `8 of 10 episodes` - the mono line under a progress bar. */
export function episodeProgressLabel({ files, total }: ShowProgress): string {
  return `${files} of ${total} ${total === 1 ? 'episode' : 'episodes'}`
}

/** `Season 2 · 10 episodes` - `show-detail.pug:136`. */
export function seasonHeading(season: Season): string {
  const total = seasonEpisodeTotal(season)

  return `${seasonLabel(season.seasonNumber)} · ${total} ${total === 1 ? 'episode' : 'episodes'}`
}

/**
 * ⚠️ The scope rule, in one place.
 *
 * `DownloadJob.scope` is where a show job records *which part* of the series
 * it was for. The media key stays `tvdb:121361` for every scope - that is why
 * the gallery groups a show into one card instead of fragmenting it into one
 * per episode - so **nothing here ever looks at, or produces, a modified media
 * id**. An absent (or empty) scope means the whole series.
 */
function scopeOf(job: DownloadJob): {
  episodeId?: number
  seasonNumber?: number
} {
  return job.scope ?? {}
}

/**
 * Jobs for the whole series - the ones whose scope names no season and no
 * episode.
 *
 * Deliberately not "every job", even though `JobLifecycle` would happily take
 * the lot and pick the newest: the newest job for a series is very often an
 * episode grab, and a panel headed with the series' name reporting one
 * episode's status would be a quiet lie. Every job lands in exactly one panel
 * - this one, or its season's.
 */
export function seriesScopedJobs(
  jobs: readonly DownloadJob[],
): readonly DownloadJob[] {
  return jobs.filter(job => {
    const scope = scopeOf(job)

    return scope.episodeId === undefined && scope.seasonNumber === undefined
  })
}

/**
 * Jobs whose scope *names* this season - either directly, or by naming one of
 * its episodes.
 *
 * The episode branch matters: `POST /download/shows` accepts `{ episodeId }`
 * alone, and while the backend resolves `seasonNumber` onto the persisted
 * scope, a job created before that resolution (or by another client) may carry
 * only the id. Matching the id against the season's own episodes catches both.
 *
 * A whole-series job is **not** included. It covers this season in the sense
 * that it will eventually fetch it, but reporting it on all seven tabs at once
 * turns one download into seven blinking dots; the series panel reports it
 * once, which is where it belongs.
 */
export function seasonScopedJobs(
  jobs: readonly DownloadJob[],
  season: Season,
): readonly DownloadJob[] {
  const episodeIds = new Set(season.episodes.map(episodeKey))

  return jobs.filter(job => {
    const scope = scopeOf(job)

    if (scope.episodeId !== undefined) {
      return episodeIds.has(scope.episodeId)
    }

    return scope.seasonNumber === season.seasonNumber
  })
}

/**
 * Jobs for exactly this episode.
 *
 * ⚠️ Matched on `scope.episodeId` against `Episode.id` - Sonarr's primary key
 * on both sides. `episodeNumber` is carried on the scope too, purely so an
 * activity row can say `S03E05` without fetching the seasons endpoint, and
 * matching on it would collide across seasons.
 */
export function episodeScopedJobs(
  jobs: readonly DownloadJob[],
  episode: Episode,
): readonly DownloadJob[] {
  return jobs.filter(job => scopeOf(job).episodeId === episode.id)
}

/** Whether the newest job in a list is still open work. */
export function isScopeDownloading(jobs: readonly DownloadJob[]): boolean {
  const job = latestJob(jobs)

  return job !== null && isInProgress(job.status)
}

/** How an episode row's chip reads. */
export type EpisodeState = {
  /** Draw the breathing `Dot` - true exactly when the machine is working. */
  live: boolean
  /** Chip text. */
  label: string
  tone: StatusTone
}

/**
 * The three states an episode can be in that no job describes.
 * `show-detail.mjs`'s own words for the first two; the third is this app's,
 * because the mockup has no unmonitored row and "not downloaded" would be
 * misleading for an episode nothing is looking for.
 */
const EPISODE_DOWNLOADED_LABEL = 'downloaded'
const EPISODE_MISSING_LABEL = 'not downloaded'
const EPISODE_UNMONITORED_LABEL = 'not monitored'

/**
 * What one episode row says about itself.
 *
 * The order is the point:
 *
 * 1. **A job in flight wins.** It is the only thing on the row that is
 *    changing, and it is the thing the user just asked for.
 * 2. **Then the file.** `hasFile` is a fact about the disk; a job that
 *    finished three weeks ago is not.
 * 3. **Then a failed attempt**, because "this was tried and did not work" is
 *    strictly more useful than "there is no file here".
 * 4. **Then monitoring.** An unmonitored episode with no file is not missing -
 *    nobody asked for it, and Sonarr will not go looking.
 *
 * `jobs` is the episode's own scoped list (see {@link episodeScopedJobs}),
 * newest first. A season- or series-scoped download is deliberately *not*
 * smeared across every row it will eventually touch: it says nothing about
 * which episode is transferring right now, and the season header aggregates it
 * honestly instead.
 */
export function episodeState(
  episode: Episode,
  jobs: readonly DownloadJob[],
): EpisodeState {
  const job = latestJob(jobs)

  if (job && isInProgress(job.status)) {
    const tone = statusTone(job.status)

    return { live: tone === 'uv', label: jobStatusLabel(job.status), tone }
  }

  if (episode.hasFile) {
    return { live: false, label: EPISODE_DOWNLOADED_LABEL, tone: 'ok' }
  }

  if (job && job.status !== DownloadJobStatus.Completed) {
    return {
      live: false,
      label: jobStatusLabel(job.status),
      tone: statusTone(job.status),
    }
  }

  return {
    live: false,
    label: episode.monitored
      ? EPISODE_MISSING_LABEL
      : EPISODE_UNMONITORED_LABEL,
    tone: 'mute',
  }
}

/**
 * The season a page opens on.
 *
 * The first season with a file, because that is the one somebody navigating to
 * a show in their library is most likely looking for; failing that the first
 * non-specials season, because specials are the least interesting thing on the
 * page; failing that whatever there is. `null` for a show with no seasons at
 * all - see `listSeasons`, which 404s for a series that is not in Sonarr yet.
 */
export function defaultSeasonNumber(seasons: readonly Season[]): number | null {
  const withFiles = seasons.find(season => season.episodeFileCount > 0)
  if (withFiles) {
    return withFiles.seasonNumber
  }

  const regular = seasons.find(
    season => season.seasonNumber !== SPECIALS_SEASON_NUMBER,
  )

  return regular?.seasonNumber ?? seasons[0]?.seasonNumber ?? null
}

/** The season a tab value names, or `null` when the list no longer has it. */
export function seasonByTabValue(
  seasons: readonly Season[],
  value: string,
): Season | null {
  return (
    seasons.find(season => seasonTabValue(season.seasonNumber) === value) ??
    null
  )
}

/** `formatRuntime`'s "I don't know" answer, compared against rather than re-spelled. */
const UNKNOWN_RUNTIME = formatRuntime(0, 'hours')

/**
 * The one metadata line under the title - `2014 · 6 seasons · 29m · TV-MA`.
 *
 * `show-detail.mjs` writes `2022– · 3 seasons · Drama`; the season count comes
 * from the seasons payload rather than from `Show`, because **`ShowSchema`
 * carries no season or episode summary at all** - `listSeasons` is the only
 * source. Specials are not a season for counting purposes, matching Sonarr.
 *
 * ⚠️ `runtime` is **seconds** (the Radarr/Sonarr mappers already multiplied
 * minutes by 60) and `formatRuntime` answers {@link UNKNOWN_VALUE} for a zero
 * or missing one, which is dropped here rather than rendered - an em dash in
 * the middle of a metadata run reads as a broken field.
 */
export function showMetaLine(media: Show, seasons: readonly Season[]): string {
  const seasonCount = seasons.filter(
    season => season.seasonNumber !== SPECIALS_SEASON_NUMBER,
  ).length
  const runtime = formatRuntime(media.runtime, 'hours')

  return [
    media.year === undefined ? null : String(media.year),
    seasonCount === 0
      ? null
      : `${seasonCount} ${seasonCount === 1 ? 'season' : 'seasons'}`,
    runtime === UNKNOWN_RUNTIME ? null : runtime,
    media.certification ?? null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ')
}

/**
 * Whether the metadata lookup failed.
 *
 * ⚠️ A `tvdb:` key **always resolves** - `MediaResolverService` catches an
 * upstream failure and emits a placeholder rather than propagating it, so
 * `GET /media/tvdb:99999999` answers `200` with `{ id: 'tvdb:99999999', title:
 * 'tvdb:99999999' }` and never `404`. An unknown show is therefore a metadata
 * lookup that did not land, not a missing page, and `notFound()` would be the
 * wrong answer twice over: it would claim the route does not exist, and it
 * would hide the fact that Sonarr is what is unreachable.
 *
 * The placeholder's tell is that the title *is* the id, which is what this
 * detects. Deliberately narrow: a real show whose title happened to equal its
 * own key is not a thing TVDB can produce.
 */
export function isMetadataMissing(media: Media): boolean {
  return media.title === media.id
}
