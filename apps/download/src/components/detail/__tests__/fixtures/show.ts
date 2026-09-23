import type {
  DownloadJob,
  Episode,
  MediaState,
  Season,
  Show,
  ShowScope,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

/**
 * Builders for the show detail specs, shared so the four suites disagree about
 * nothing.
 *
 * Shaped on a real payload rather than invented: `tvdb:277165` is Silicon
 * Valley as `GET /media/tvdb:277165/seasons` actually answers for it on the dev
 * box - **including season 0 reporting `episodeCount: 0` while listing five
 * episodes**, which is the disagreement `seasonEpisodeTotal` exists to settle.
 *
 * ⚠️ A `.ts` module under `__tests__/fixtures/`, which both Jest projects
 * exclude: the node project by the explicit negated fixtures pattern in
 * `jest.config.js`, the jsdom project because it only collects `.tsx`.
 */

/** ⚠️ The media key. It is this string for **every** scope - see `showRequestScope`. */
export const SHOW_ID = 'tvdb:277165'
export const SHOW_TVDB_ID = 277165
export const SHOW_TITLE = 'Silicon Valley'

/** The one instant every relative stamp in these specs is measured against. */
export const NOW = Date.parse('2026-09-15T12:00:00.000Z')

export function show(overrides: Partial<Show> = {}): Show {
  return {
    certification: 'TV-MA',
    id: SHOW_ID,
    overview: 'Engineers who cannot handle success.',
    // ⚠️ Seconds. Sonarr reports minutes and `toShow()` multiplies by 60.
    runtime: 1740,
    title: SHOW_TITLE,
    tvdbId: SHOW_TVDB_ID,
    type: DownloadType.Show,
    year: 2014,
    ...overrides,
  }
}

/**
 * An episode, with the `state` the server would derive for it when nothing is
 * queued: `available` with a file, else `wanted` when monitored, else `absent`
 * (`deriveManagedState`'s no-queue-item branch). So `episode({ hasFile: true })`
 * stays self-consistent; pass `state` to describe a queued one, or
 * `state: undefined` to model a payload that carries none.
 */
export function episode(overrides: Partial<Episode> = {}): Episode {
  const base: Episode = {
    episodeNumber: 1,
    hasFile: false,
    // ⚠️ Sonarr's episode primary key, not the episode number.
    id: 2430,
    monitored: true,
    runtime: 1740,
    seasonNumber: 1,
    title: 'Minimum Viable Product',
    ...overrides,
  }

  return 'state' in overrides ? base : { ...base, state: restingState(base) }
}

function restingState({ hasFile, monitored }: Episode): MediaState {
  if (hasFile) {
    return 'available'
  }

  return monitored ? 'wanted' : 'absent'
}

export function season(overrides: Partial<Season> = {}): Season {
  return {
    episodeCount: 2,
    episodeFileCount: 0,
    episodes: [],
    monitored: true,
    seasonNumber: 1,
    ...overrides,
  }
}

/**
 * Season 0, exactly as Sonarr reports it: `episodeCount: 0` over a real list of
 * episodes, and `monitored: false`.
 */
export function specials(overrides: Partial<Season> = {}): Season {
  return season({
    episodeCount: 0,
    episodes: [
      episode({ episodeNumber: 1, id: 9001, seasonNumber: 0, title: 'Pilot' }),
      episode({
        episodeNumber: 2,
        id: 9002,
        seasonNumber: 0,
        title: 'Inside the Episode',
      }),
    ],
    monitored: false,
    seasonNumber: 0,
    ...overrides,
  })
}

export function job(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-09-15T11:48:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job_1',
    linkedDiscord: null,
    media: show(),
    requester: { email: 'jeremy.asuncion@lilnas.io', userId: 'u_1' },
    status: DownloadJobStatus.Downloading,
    updatedAt: '2026-09-15T11:50:00.000Z',
    ...overrides,
  }
}

/** A job with a scope, spelled through the same field the backend persists. */
export function scopedJob(
  scope: ShowScope | undefined,
  overrides: Partial<DownloadJob> = {},
): DownloadJob {
  return job({ scope, ...overrides })
}
