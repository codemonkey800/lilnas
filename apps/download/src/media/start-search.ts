import { mediaIdSuffix } from '@lilnas/utils/download/media-id'
import {
  type DownloadJobRecord,
  DownloadType,
  type Release,
  type ShowScope,
} from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import type { Logger } from '@nestjs/common'

import { listBadFilesByMediaId } from 'src/db/bad-files.repo'
import type { Db } from 'src/db/db.service'

import type { CommandRef } from './arr-command.types'
import { mediaMutex } from './keyed-mutex.util'
import type { RadarrService } from './radarr.service'
import {
  type EpisodeMappedRelease,
  pickBestRelease,
  pickSeasonReleases,
} from './release-selection.util'
import { type SonarrService, toSonarrReleaseScope } from './sonarr.service'

/**
 * The note a job ends `not_found` with when the title has flagged releases
 * and every release the indexers returned is flagged, rejected upstream, not
 * allowed to download, or covers nothing the job still needs.
 */
export const NO_USABLE_RELEASE_NOTE =
  'No usable release — every result is flagged or rejected'

/**
 * What `startSearch` works with. Plain values rather than an injected
 * provider, so both the poller - which must not inject
 * `MediaDownloadService` - and the request path can call it.
 */
export interface StartSearchDeps {
  /** The job store's database - read for the title's flagged releases. */
  db: Db
  logger: Pick<Logger, 'log' | 'warn'>
  radarrService: RadarrService
  sonarrService: SonarrService
}

/**
 * How `startSearch` left a job. Every outcome carries the job's scope as
 * resolved against Sonarr (display fields filled in, an episode asked for by
 * number turned into its `episodeId`), for the caller to write back; a movie,
 * or a show job with no scope, has none.
 *
 * - `search`: a search command was queued - the caller stores it on the job
 *   (kind `search`) so the poller can follow it to a grab or to `not_found`.
 * - `grabbed`: the title has flagged releases, so this app picked and
 *   grabbed releases itself. There is no command to follow: the poller
 *   claims the grabs from history. `grabbedAt` is when the first grab was
 *   sent - the caller stores it as `upstreamCommandAt`, which ranks this job
 *   first for those grabs (`claimGrab`).
 * - `not_found`: nothing was worth grabbing - terminal, with the reason in
 *   `statusNote` (absent when there was nothing left to look for at all).
 * - `failed`: the job can't be searched as asked - terminal, with `error`.
 */
export type StartSearchResult =
  | { outcome: 'search'; command: CommandRef; scope?: ShowScope }
  | {
      outcome: 'grabbed'
      grabbedAt: string
      guids: string[]
      scope?: ShowScope
    }
  | { outcome: 'not_found'; scope?: ShowScope; statusNote?: string }
  | { outcome: 'failed'; error: string; scope?: ShowScope }

/**
 * Starts the Radarr/Sonarr search for one movie/show job - shared by the
 * request path (a title already in the library) and the poller (once a
 * fresh add's refresh has finished). Writes nothing to the job itself; see
 * `StartSearchResult` for what the caller writes.
 *
 * For a show, first:
 *
 * - resolves the scope - an `episodeId` gets its season/episode numbers, and
 *   an episode asked for by number (`seasonNumber` + `episodeNumber`) gets
 *   its `episodeId`, or the job fails "S02E05 isn't in Sonarr";
 * - monitors what the scope covers (`SonarrService.monitorScope`), under the
 *   title's `mediaMutex`. Only now, never during the add-time refresh:
 *   Sonarr's refresh saves back a snapshot taken before it fetched, undoing
 *   any flag written meanwhile.
 *
 * Then, when the title has no flagged releases, queues the narrowest
 * command the scope allows:
 *
 * - movie: `MoviesSearch`;
 * - show, one episode: `EpisodeSearch`;
 * - show, one season: `SeasonSearch` - season 0 (specials) included;
 * - show, whole series: `SeriesSearch`.
 *
 * With flagged releases, none of those commands can be told "anything but
 * that one", so this picks from the interactive search itself and grabs
 * (`pickRelease`, `grabPerSeason`).
 *
 * `upstreamId` is the title's Radarr movie id / Sonarr series id when the
 * caller already has it. Left out, it is read from the library by the job's
 * tmdb/tvdb id; a title the library doesn't hold throws. So does any
 * upstream call that fails - the request path fails the job, the poller
 * tries again.
 */
export async function startSearch(
  deps: StartSearchDeps,
  job: DownloadJobRecord,
  upstreamId?: number,
): Promise<StartSearchResult> {
  if (job.type !== DownloadType.Movie && job.type !== DownloadType.Show) {
    throw new Error(`startSearch: a ${job.type} job has no upstream search`)
  }

  const id = upstreamId ?? (await libraryId(deps, job.type, job.mediaId))
  const result =
    job.type === DownloadType.Movie
      ? await searchMovie(deps, job, id)
      : await searchShow(deps, job, id)

  deps.logger.log(
    {
      action: 'startSearch',
      ...(result.outcome === 'search'
        ? { command: result.command.name, commandId: result.command.id }
        : {}),
      ...(result.outcome === 'grabbed' ? { guids: result.guids } : {}),
      jobId: job.id,
      mediaId: job.mediaId,
      outcome: result.outcome,
      scope: result.scope ?? job.scope,
    },
    'Started an upstream search',
  )
  return result
}

async function searchMovie(
  deps: StartSearchDeps,
  job: DownloadJobRecord,
  radarrId: number,
): Promise<StartSearchResult> {
  const { radarrService } = deps
  const flagged = flaggedGuids(deps.db, job.mediaId)

  if (flagged.size === 0) {
    return {
      command: await radarrService.triggerSearch(radarrId),
      outcome: 'search',
    }
  }

  const picked = pickRelease(
    deps,
    job.mediaId,
    await radarrService.getReleases(radarrId),
    flagged,
  )
  if (picked.length === 0) {
    return { outcome: 'not_found', statusNote: NO_USABLE_RELEASE_NOTE }
  }

  const grabbedAt = nowIso()
  for (const release of picked) {
    await radarrService.grabRelease(release.guid, release.indexerId)
  }
  return {
    grabbedAt,
    guids: picked.map(release => release.guid),
    outcome: 'grabbed',
  }
}

async function searchShow(
  deps: StartSearchDeps,
  job: DownloadJobRecord,
  sonarrId: number,
): Promise<StartSearchResult> {
  const { sonarrService } = deps

  const resolved = await resolveShowScope(sonarrService, sonarrId, job.scope)
  if ('error' in resolved) {
    return { error: resolved.error, outcome: 'failed' }
  }
  const { scope } = resolved

  await mediaMutex.run(job.mediaId, () =>
    sonarrService.monitorScope(sonarrId, scope ?? {}),
  )

  const flagged = flaggedGuids(deps.db, job.mediaId)
  if (flagged.size === 0) {
    return {
      command: await triggerShowSearch(sonarrService, sonarrId, scope),
      outcome: 'search',
      scope,
    }
  }

  // No season and no episode: Sonarr's unscoped release list is its RSS
  // feed, not a search, so the whole series is picked season by season.
  const releaseScope = scope ? toSonarrReleaseScope(scope) : undefined
  if (!releaseScope) {
    return grabPerSeason(deps, job.mediaId, sonarrId, flagged)
  }

  // A season scope (no episode) can need several grabs - a pack, or one
  // release per missing episode - so it picks against the season's missing
  // episodes. `!= null`: season 0 is the specials.
  const seasonNumber =
    releaseScope.episodeId == null ? releaseScope.seasonNumber : undefined
  const picked = pickRelease(
    deps,
    job.mediaId,
    await sonarrService.getReleases(sonarrId, releaseScope),
    flagged,
    seasonNumber != null
      ? await missingEpisodeNumbers(sonarrService, sonarrId, seasonNumber)
      : undefined,
  )
  if (picked.length === 0) {
    return { outcome: 'not_found', scope, statusNote: NO_USABLE_RELEASE_NOTE }
  }

  const grabbedAt = nowIso()
  for (const release of picked) {
    await sonarrService.grabRelease(release.guid, release.indexerId)
  }
  return {
    grabbedAt,
    guids: picked.map(release => release.guid),
    outcome: 'grabbed',
    scope,
  }
}

/**
 * The job's scope, filled in against Sonarr - or the reason it can't be.
 *
 * - `episodeId`: `SonarrService.resolveScope` adds its season/episode
 *   numbers (an id Sonarr doesn't know throws).
 * - `seasonNumber` + `episodeNumber`, no id: the season's episodes are read
 *   for that number. Only possible once the series' episodes exist - which
 *   is why a fresh add resolves it here, after its refresh, and not at
 *   request time.
 * - anything else is returned as it is, with no round trip.
 */
async function resolveShowScope(
  sonarrService: SonarrService,
  sonarrId: number,
  scope: ShowScope | undefined,
): Promise<{ scope?: ShowScope } | { error: string }> {
  if (scope?.episodeId != null) {
    return { scope: await sonarrService.resolveScope(scope) }
  }

  // `!= null`, not truthiness - season 0 is Sonarr's specials season.
  if (scope?.episodeNumber == null || scope.seasonNumber == null) {
    return { scope }
  }

  const { episodeNumber, seasonNumber } = scope
  const episodes = await sonarrService.getEpisodes(sonarrId, { seasonNumber })
  const episode = episodes.find(
    candidate =>
      candidate.seasonNumber === seasonNumber &&
      candidate.episodeNumber === episodeNumber,
  )

  if (episode?.id == null) {
    return {
      error: `${episodeLabel(seasonNumber, episodeNumber)} isn't in Sonarr`,
    }
  }
  return { scope: { episodeId: episode.id, episodeNumber, seasonNumber } }
}

/** `S02E05` - zero-padded to two digits, as release names spell it. */
function episodeLabel(seasonNumber: number, episodeNumber: number): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `S${pad(seasonNumber)}E${pad(episodeNumber)}`
}

function triggerShowSearch(
  sonarrService: SonarrService,
  sonarrId: number,
  scope: ShowScope | undefined,
): Promise<CommandRef> {
  if (scope?.episodeId != null) {
    return sonarrService.triggerEpisodeSearch([scope.episodeId])
  }

  // `!= null`, not truthiness - season 0 is Sonarr's specials season.
  if (scope?.seasonNumber != null) {
    return sonarrService.triggerSeasonSearch(sonarrId, scope.seasonNumber)
  }

  return sonarrService.triggerSearch(sonarrId)
}

/** The title's Radarr/Sonarr library id, read fresh by its tmdb/tvdb id. */
async function libraryId(
  deps: StartSearchDeps,
  type: DownloadType.Movie | DownloadType.Show,
  mediaId: string,
): Promise<number> {
  const externalId = Number(mediaIdSuffix(mediaId))
  const id =
    type === DownloadType.Movie
      ? (await deps.radarrService.getLibraryMovie(externalId))?.radarrId
      : (await deps.sonarrService.getLibraryShow(externalId))?.sonarrId

  if (id == null) {
    throw new Error(`startSearch: ${mediaId} is not in the library`)
  }
  return id
}

/**
 * Every release guid flagged as bad for a title. An empty set is the common
 * case and the one that matters most - it's what keeps a title with no
 * flags on the plain command path.
 */
function flaggedGuids(db: Db, jobMediaId: string): Set<string> {
  return new Set(
    listBadFilesByMediaId(db, jobMediaId).map(row => row.releaseGuid),
  )
}

/**
 * An episode a pick still has to cover: monitored, and with no file yet.
 * Specials are not excluded here - the callers decide which seasons count.
 */
function isMissingEpisode(episode: {
  hasFile?: boolean | null
  monitored?: boolean | null
}): boolean {
  return episode.monitored === true && !episode.hasFile
}

/**
 * The episode numbers of a season that are monitored and still have no file
 * - what a season-scoped pick has to cover. Read after `monitorScope`, so
 * every episode the request asked for counts.
 */
async function missingEpisodeNumbers(
  sonarrService: SonarrService,
  sonarrId: number,
  seasonNumber: number,
): Promise<number[]> {
  const episodes = await sonarrService.getEpisodes(sonarrId, { seasonNumber })

  return episodes
    .filter(isMissingEpisode)
    .map(episode => episode.episodeNumber)
    .filter((episodeNumber): episodeNumber is number => episodeNumber != null)
}

/**
 * `missingEpisodeNumbers` for every season past the specials at once, in
 * season order, leaving out the seasons with nothing missing. One episode
 * read for the whole series rather than one per season.
 */
async function missingEpisodesBySeason(
  sonarrService: SonarrService,
  sonarrId: number,
): Promise<Map<number, number[]>> {
  const bySeason = new Map<number, number[]>()

  for (const episode of await sonarrService.getEpisodes(sonarrId)) {
    const { episodeNumber, seasonNumber } = episode

    // `> 0`, not truthiness - season 0 is the specials, which a whole-show
    // request never covers.
    if (
      seasonNumber == null ||
      seasonNumber <= 0 ||
      episodeNumber == null ||
      !isMissingEpisode(episode)
    ) {
      continue
    }

    bySeason.set(seasonNumber, [
      ...(bySeason.get(seasonNumber) ?? []),
      episodeNumber,
    ])
  }

  return new Map([...bySeason].sort(([a], [b]) => a - b))
}

/**
 * The app's own pick for an **unscoped** show job with flagged releases.
 * Sonarr's `GET /release` with only a series id is its RSS feed, not a
 * search, so the series is searched one season at a time instead: every
 * season past the specials that still has monitored, fileless episodes, each
 * picked exactly as a season job would be (`pickSeasonReleases`) and
 * grabbed as soon as it is picked - a long series' later searches can't
 * outlive an earlier season's cached pick.
 *
 * A season whose search or grab fails, or that has nothing usable, is logged
 * and skipped: the other seasons are still worth having. With no grab at
 * all it is `not_found` - with no note when no season had anything missing
 * (there was nothing to look for), `NO_USABLE_RELEASE_NOTE` otherwise - and
 * it throws only when every season's search failed, which is an upstream
 * problem rather than an answer.
 */
async function grabPerSeason(
  deps: StartSearchDeps,
  jobMediaId: string,
  sonarrId: number,
  flagged: ReadonlySet<string>,
): Promise<StartSearchResult> {
  const { sonarrService } = deps
  const missingBySeason = await missingEpisodesBySeason(sonarrService, sonarrId)
  const grabbed: string[] = []
  const failures: string[] = []
  let candidates = 0
  let grabbedAt: string | undefined

  for (const [seasonNumber, missing] of missingBySeason) {
    try {
      const releases = await sonarrService.getReleases(sonarrId, {
        seasonNumber,
      })
      candidates += releases.length

      for (const release of pickSeasonReleases(releases, flagged, missing)) {
        grabbedAt ??= nowIso()
        await sonarrService.grabRelease(release.guid, release.indexerId)
        grabbed.push(release.guid)
      }
    } catch (err) {
      const error = getErrorMessage(err)
      failures.push(`season ${seasonNumber}: ${error}`)
      deps.logger.warn(
        { action: 'grabPerSeason', error, mediaId: jobMediaId, seasonNumber },
        'Could not search or grab one season - carrying on with the rest',
      )
    }
  }

  deps.logger.log(
    {
      action: 'grabPerSeason',
      candidates,
      failures,
      flaggedCount: flagged.size,
      guids: grabbed,
      mediaId: jobMediaId,
      seasons: [...missingBySeason.keys()],
    },
    'Picked release(s) ourselves, season by season - this title has flagged bad files',
  )

  if (grabbedAt != null && grabbed.length > 0) {
    return { grabbedAt, guids: grabbed, outcome: 'grabbed' }
  }

  if (missingBySeason.size === 0) {
    return { outcome: 'not_found' }
  }

  if (failures.length === missingBySeason.size) {
    throw new Error(
      `Could not search any season of ${jobMediaId}: ${failures.join('; ')}`,
    )
  }

  return { outcome: 'not_found', statusNote: NO_USABLE_RELEASE_NOTE }
}

/**
 * The app's own pick, used only once a title has flagged releases: every
 * release to grab - one for a movie or an episode, and possibly several for
 * a season (`missingEpisodeNumbers` given): a pack, or one release per
 * missing episode. The order is Radarr/Sonarr's own; see `pickBestRelease`.
 * A whole series never comes through here - see `grabPerSeason`.
 *
 * Empty when nothing survives the filter - the caller ends the job
 * `not_found` with `NO_USABLE_RELEASE_NOTE`.
 */
function pickRelease(
  deps: StartSearchDeps,
  jobMediaId: string,
  releases: readonly EpisodeMappedRelease[],
  flagged: ReadonlySet<string>,
  missingEpisodeNumbers?: readonly number[],
): Release[] {
  let picked: Release[]
  if (missingEpisodeNumbers != null) {
    picked = pickSeasonReleases(releases, flagged, missingEpisodeNumbers)
  } else {
    const best = pickBestRelease(releases, flagged)
    picked = best ? [best] : []
  }

  deps.logger.log(
    {
      action: 'pickRelease',
      candidates: releases.length,
      flaggedCount: flagged.size,
      guids: picked.map(release => release.guid),
      mediaId: jobMediaId,
    },
    picked.length > 0
      ? 'Picked release(s) ourselves - this title has flagged bad files'
      : 'No usable release - every result is flagged or rejected',
  )

  return picked
}

/** Now, read through `Date.now` so the poller's tests can pin it. */
function nowIso(): string {
  return new Date(Date.now()).toISOString()
}
