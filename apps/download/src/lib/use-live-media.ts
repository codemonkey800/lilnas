'use client'

import {
  type DownloadJob,
  DownloadType,
  type Episode,
  type EpisodeStateEntry,
  type Media,
  type MediaEvent,
  type Season,
} from '@lilnas/utils/download/types'
import { useMemo } from 'react'

import {
  useJobEvents,
  useMediaEvents,
  useServedMedia,
} from 'src/lib/use-job-events'

/** What a movie, show or video page server-rendered for {@link useLiveMedia}. */
export interface LiveMediaInput<M extends Media> {
  /** The page's attempts, newest first — `MediaDetailResponse.jobs`. */
  jobs: readonly DownloadJob[]
  media: M
  /** A show's seasons from the seasons route. Absent for a movie or a video. */
  seasons?: readonly Season[]
}

/** The same shape, with every live frame for this media folded in. */
export interface LiveMedia<M extends Media> {
  /** Whether the live feed is open — see `JobEventsSnapshot.connected`. */
  connected: boolean
  /** Server and live attempts together, newest first by `createdAt`. */
  jobs: DownloadJob[]
  media: M
  seasons?: Season[]
}

/**
 * The live frame for `served`, or `undefined` when there is none or it is of
 * another `type`. The store keys frames by id, so a mismatched type would mean
 * the id was reused across kinds — the frame is ignored whole (media and
 * episodes) rather than handed to a page that only knows how to draw `M`.
 */
function matchingEvent<M extends Media>(
  served: M,
  event: MediaEvent | undefined,
): (MediaEvent & { media: M }) | undefined {
  return event && event.media.type === served.type
    ? (event as MediaEvent & { media: M })
    : undefined
}

/**
 * One episode with its live entry applied. An entry with no `queueSnapshot`
 * means the episode left the queue, so the served snapshot is dropped too.
 * Returns the served episode itself when nothing moved.
 */
function patchEpisode(episode: Episode, entry: EpisodeStateEntry): Episode {
  if (
    episode.state === entry.state &&
    episode.queueSnapshot === entry.queueSnapshot
  ) {
    return episode
  }

  const patched: Episode = { ...episode, state: entry.state }
  if (entry.queueSnapshot) {
    patched.queueSnapshot = entry.queueSnapshot
  } else {
    delete patched.queueSnapshot
  }
  return patched
}

/**
 * The served seasons with a live `episodes` array applied by `episodeId`.
 * An episode the array does not mention is left as served, and a season
 * none of whose episodes moved keeps its identity — so a consumer memoizing
 * on a season only re-renders for its own episodes.
 */
function patchSeasons(
  seasons: readonly Season[],
  entries: readonly EpisodeStateEntry[],
): Season[] {
  const byId = new Map(entries.map(entry => [entry.episodeId, entry]))

  return seasons.map(season => {
    let changed = false
    const episodes = season.episodes.map(episode => {
      const entry = byId.get(episode.id)
      if (!entry) return episode

      const next = patchEpisode(episode, entry)
      if (next !== episode) changed = true
      return next
    })

    return changed ? { ...season, episodes } : season
  })
}

/**
 * The served jobs with every live job for this media upserted by id (the
 * live copy wins), newest first by `createdAt` — the server's own order, so
 * a job started from Discord or another tab lands where a fresh render would
 * put it. A job for any other media is ignored. The sort is stable, so equal
 * timestamps keep the served order.
 */
function mergeJobs(
  served: readonly DownloadJob[],
  live: ReadonlyMap<string, DownloadJob>,
  mediaId: string,
): DownloadJob[] {
  const byId = new Map<string, DownloadJob>()
  for (const job of served) byId.set(job.id, job)
  for (const job of live.values()) {
    if (job.media.id === mediaId) byId.set(job.id, job)
  }

  return [...byId.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  )
}

/**
 * A movie, show or video page's media, episodes and attempts, kept current
 * off the download gateway.
 *
 * Both subscriptions key on `media.id`, not on the served job ids, so a
 * download this tab did not start (Radarr's UI, Discord, another tab) shows
 * up live. The media frame carries the file, the state and the queue
 * snapshot, so nothing here asks the router for a fresh server render, and a
 * landed job is shown as landed — the page's chip reads the media's state,
 * not the job's.
 *
 * A movie or show is also watched closely (`MediaEventsFilter.watch`), so a
 * file deleted or added in Radarr's/Sonarr's own UI reaches the page within
 * about a second. And a new server copy of the media - a delete's
 * `revalidatePath`, say - drops the frame that came before it
 * (`useServedMedia`), so an older frame never outranks a fresher render.
 *
 * Every output is memoized, and the whole result keeps its identity until a
 * frame for this media (or a `connected` flip) actually changes something.
 */
export function useLiveMedia<M extends Media>({
  jobs,
  media,
  seasons,
}: LiveMediaInput<M>): LiveMedia<M> {
  const mediaIds = [media.id]
  const { connected, jobs: liveJobs } = useJobEvents({ mediaIds })
  const { media: liveMedia } = useMediaEvents({
    mediaIds,
    watch: media.type !== DownloadType.Video,
  })
  useServedMedia(media.id, media)
  const event = matchingEvent(media, liveMedia.get(media.id))
  const liveOrServedMedia = event?.media ?? media

  const episodes = event?.episodes
  const liveSeasons = useMemo(() => {
    if (!seasons) return undefined
    return episodes ? patchSeasons(seasons, episodes) : [...seasons]
  }, [episodes, seasons])

  const mergedJobs = useMemo(
    () => mergeJobs(jobs, liveJobs, media.id),
    [jobs, liveJobs, media.id],
  )

  return useMemo(
    () => ({
      connected,
      jobs: mergedJobs,
      media: liveOrServedMedia,
      ...(liveSeasons ? { seasons: liveSeasons } : {}),
    }),
    [connected, liveOrServedMedia, liveSeasons, mergedJobs],
  )
}
