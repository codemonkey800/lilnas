import type {
  DownloadJob,
  Episode,
  Media,
  MediaState,
  Season,
  Show,
} from '@lilnas/utils/download/types'
import {
  DownloadType,
  isMediaInFlight,
  mediaState,
  rollupMediaState,
} from '@lilnas/utils/download/types'

import {
  mediaStateIsLive,
  mediaStateLabel,
} from 'src/components/detail/media-state'
import type { StatusTone } from 'src/lib/format'
import { formatRuntime, mediaStateTone } from 'src/lib/format'

/**
 * Everything the show detail screen *decides*, in a module with no directive
 * and no JSX.
 *
 * Same split `job-state.ts` makes, for the same two reasons. The season panel
 * is `'use client'` (a tab strip owns which season is open), and every export
 * of a `'use client'` module reaches a server component as an opaque client
 * reference - so the page itself could not call any of this if it lived beside
 * the component. And this is where the load-bearing rules are: how episode
 * states roll up into a season's and a series', which job belongs to which
 * scope's Attempts, what a season's progress actually adds up to, and the fact
 * that **scope is never expressed by mutating the media id**. Those
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
 *
 * Jobs are attempts, not state: these helpers only decide which attempts a
 * season's or an episode's Attempts list shows. What a scope *is* right now
 * comes from its episodes - see {@link seasonState}.
 */
function scopeOf(job: DownloadJob): {
  episodeId?: number
  seasonNumber?: number
} {
  return job.scope ?? {}
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
 * that it will eventually fetch it, but listing it on all seven tabs at once
 * turns one attempt into seven; the series lists it once, which is where it
 * belongs.
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

/**
 * One episode's state, exactly as the seasons route served it.
 *
 * `mediaState` rather than `episode.state` read directly: `state` is optional
 * on the wire (an `Episode` is built before the queue is consulted), and the
 * shared reader is the one place that decides what a missing one means.
 */
export function episodeMediaState(episode: Episode): MediaState {
  return mediaState(episode)
}

/**
 * A season's state, rolled up over its episodes by `MEDIA_STATE_PRECEDENCE` -
 * one episode needing a decision outranks nine on disk, because that is the
 * one somebody has to do something about. A season Sonarr has listed no
 * episodes for is `absent`.
 */
export function seasonState(season: Season): MediaState {
  return rollupMediaState(season.episodes.map(episodeMediaState))
}

/**
 * The series' state, rolled up over every episode outside season 0.
 *
 * ⚠️ **Specials are excluded**, for the same reason {@link seriesProgress}
 * excludes them: they are opt-in extras almost nobody grabs, and a series
 * whose only unfetched episodes are specials would otherwise never read as
 * anything but `wanted`. The specials tab still carries its own rollup.
 *
 * Falls back to the show's own `state` when there is nothing to roll up - the
 * seasons payload failed or has not landed, or the series only has specials -
 * because the server computes that one from the same episodes and it is the
 * honest answer when the per-episode detail is missing.
 */
export function seriesState(
  show: Show,
  seasons: readonly Season[],
): MediaState {
  const states = seasons
    .filter(season => season.seasonNumber !== SPECIALS_SEASON_NUMBER)
    .flatMap(season => season.episodes.map(episodeMediaState))

  return states.length === 0 ? mediaState(show) : rollupMediaState(states)
}

/**
 * How far up the series a delete reaches once it removes what was asked.
 *
 * The same three answers `ShowDeleteCascade` gives on the backend, and
 * deliberately the same words: `'none'` takes only what was named, `'season'`
 * also unmonitors the season, `'series'` removes the series from Sonarr.
 */
export type DeleteCascade = 'none' | 'season' | 'series'

/** The delete a cascade is being predicted for - one episode, or one season. */
export type DeleteCascadeScope =
  | { episodeId: number; seasonNumber: number }
  | { seasonNumber: number }

/**
 * Whether an episode is on disk or on its way. A download in any in-flight
 * state - moving, importing, paused, or waiting on a human - is a file that is
 * about to exist, whoever started it.
 */
function episodeRemains(episode: Episode): boolean {
  return episode.hasFile || isMediaInFlight(episodeMediaState(episode))
}

/**
 * Whether anything outside `seasonNumber` is still on disk or on its way - a
 * file in another season, or an episode of another season in flight.
 *
 * ⚠️ Specials are a season here, on both sides of the comparison. Season 0 is
 * compared with `!==` against a number, never tested for truthiness, and it is
 * never filtered out: a series whose only remaining file is a special is still
 * a series Sonarr should keep.
 */
function seriesRemains(
  seasons: readonly Season[],
  seasonNumber: number,
): boolean {
  return seasons.some(
    other =>
      other.seasonNumber !== seasonNumber &&
      (other.episodeFileCount > 0 || other.episodes.some(episodeRemains)),
  )
}

/** Whether anything in `season` other than `target` is still on disk or on its way. */
function seasonRemains(season: Season, target: Episode): boolean {
  return season.episodes.some(
    entry => entry.id !== target.id && episodeRemains(entry),
  )
}

/**
 * ⚠️ What a delete will take *beyond* what it was asked for, so the confirm
 * dialog can say it before the user presses the button.
 *
 * Mirrors the backend planner (`media/delete-cascade.util.ts`): "remaining"
 * means a file on disk **or** an in-flight download, because a download is a
 * file that is about to exist and a delete must never cancel a sibling's grab
 * by unmonitoring the season it is landing in. Deleting the last remaining
 * episode of a season unmonitors the season; deleting the last remaining
 * season removes the series from Sonarr.
 *
 * "In flight" is read off each episode's `state`, which the server derives
 * from Sonarr's **full** queue - so a grab Sonarr made from its own RSS feed
 * holds a season back exactly as one this app started does. It is still a
 * **prediction**: the states are as fresh as the last poll, and the backend's
 * own queue read at delete time is the truth.
 */
export function deleteCascade(
  seasons: readonly Season[],
  scope: DeleteCascadeScope,
): DeleteCascade {
  const season = seasons.find(
    entry => entry.seasonNumber === scope.seasonNumber,
  )

  if ('episodeId' in scope) {
    const target = season?.episodes.find(entry => entry.id === scope.episodeId)

    // An episode that cannot be placed in a listed season cannot cascade to
    // one - the same answer `planShowDelete` gives an unplaceable episode.
    if (season === undefined || target === undefined) {
      return 'none'
    }

    if (seasonRemains(season, target)) {
      return 'none'
    }

    return seriesRemains(seasons, season.seasonNumber) ? 'season' : 'series'
  }

  return seriesRemains(seasons, scope.seasonNumber) ? 'none' : 'series'
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
 * What one episode row says about itself - its own `state`, nothing else.
 *
 * No job is consulted: a job is one attempt, and the newest one failing says
 * nothing about whether the file is on disk now (the *Cars* bug). A season- or
 * series-scoped download shows up here as this episode's own state once Sonarr
 * queues it, which is also the only honest answer to "which episode is
 * transferring right now".
 *
 * The words, tone and live dot are the same `mediaStateLabel` /
 * `mediaStateTone` / `mediaStateIsLive` the series chip reads, so the page has
 * one vocabulary at every level rather than a second table that can drift.
 */
export function episodeState(episode: Episode): EpisodeState {
  const state = episodeMediaState(episode)

  return {
    label: mediaStateLabel(state, DownloadType.Show),
    live: mediaStateIsLive(state),
    tone: mediaStateTone(state),
  }
}

/** See {@link isDownloadableState}. */
const DOWNLOADABLE_STATES: ReadonlySet<MediaState> = new Set<MediaState>([
  'absent',
  'wanted',
])

/**
 * Whether a scope can be asked for right now: nothing on disk and nothing in
 * Sonarr's queue (`absent` or `wanted`). Everything else either has its files
 * or already has a download under way. Drives an episode row's Download and
 * whether an Attempts list offers Retry - read off the media, never the job.
 */
export function isDownloadableState(state: MediaState): boolean {
  return DOWNLOADABLE_STATES.has(state)
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
