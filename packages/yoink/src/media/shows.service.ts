import {
  deleteApiV3EpisodefileBulk,
  deleteApiV3EpisodefileById,
  deleteApiV3QueueBulk,
  deleteApiV3QueueById,
  deleteApiV3SeriesById,
  type EpisodeResource,
  getApiV3Episode,
  getApiV3EpisodeById,
  getApiV3Qualityprofile,
  getApiV3QueueDetails,
  getApiV3Rootfolder,
  getApiV3SeriesLookup,
  postApiV3Release,
  postApiV3Series,
  putApiV3EpisodeById,
  putApiV3EpisodeMonitor,
  type QueueResource,
  type ReleaseResource,
  type SeriesResource,
} from '@lilnas/media/sonarr'
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'

import { getSonarrClient } from './clients'
import {
  clearAllShowSearchResults,
  clearEpisodeSearchResult,
} from './search-results'
import { searchShowReleases, type ShowDetail, type ShowRelease } from './shows'
import { getShow } from './shows.server'

function toHttpError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err)
  throw new NotFoundException(message)
}

@Injectable()
export class ShowsService {
  async getShow(tvdbId: number): Promise<ShowDetail> {
    try {
      return await getShow(tvdbId)
    } catch (err) {
      toHttpError(err)
    }
  }

  async cancelQueueItem(_tvdbId: number, queueId: number): Promise<void> {
    try {
      const client = getSonarrClient()
      await deleteApiV3QueueById({
        client,
        path: { id: queueId },
        query: { removeFromClient: true, blocklist: false },
      })
    } catch (err) {
      toHttpError(err)
    }
  }

  async cancelAllQueueItems(
    _tvdbId: number,
    seriesId: number,
  ): Promise<{ cancelledEpisodeIds: number[] }> {
    try {
      const client = getSonarrClient()
      const result = await getApiV3QueueDetails({
        client,
        query: { seriesId, includeEpisode: false },
        cache: 'no-store',
      })
      const items = (result.data ?? []) as QueueResource[]
      const activeItems = items.filter(q => q.id != null && q.episodeId != null)
      if (activeItems.length === 0) return { cancelledEpisodeIds: [] }

      const queueIds = activeItems.map(q => q.id!)
      const episodeIds = activeItems.map(q => q.episodeId!)

      await Promise.all([
        deleteApiV3QueueBulk({
          client,
          body: { ids: queueIds },
          query: { removeFromClient: true, blocklist: false },
        }),
        putApiV3EpisodeMonitor({
          client,
          body: { episodeIds, monitored: false },
        }),
      ])
      return { cancelledEpisodeIds: episodeIds }
    } catch (err) {
      toHttpError(err)
    }
  }

  async deleteEpisodeFile(
    _tvdbId: number,
    episodeFileId: number,
  ): Promise<void> {
    try {
      const client = getSonarrClient()
      const episodesResult = await getApiV3Episode({
        client,
        query: { episodeFileId },
      })
      const episodes = (episodesResult.data ?? []) as EpisodeResource[]
      const episodeIds = episodes.map(ep => ep.id ?? 0).filter(id => id > 0)

      await Promise.all([
        episodeIds.length > 0
          ? putApiV3EpisodeMonitor({
              client,
              body: { episodeIds, monitored: false },
            })
          : Promise.resolve(),
        deleteApiV3EpisodefileById({ client, path: { id: episodeFileId } }),
      ])
    } catch (err) {
      toHttpError(err)
    }
  }

  async deleteSeasonFiles(
    _tvdbId: number,
    seasonNumber: number,
    seriesId: number,
  ): Promise<void> {
    try {
      const client = getSonarrClient()
      const episodesResult = await getApiV3Episode({
        client,
        query: { seriesId, seasonNumber },
      })
      const episodes = (episodesResult.data ?? []) as EpisodeResource[]
      const episodeIds = episodes.map(ep => ep.id ?? 0).filter(id => id > 0)
      const episodeFileIds = episodes
        .map(ep => ep.episodeFileId ?? 0)
        .filter(id => id > 0)

      if (episodeFileIds.length === 0) return

      await Promise.all([
        episodeIds.length > 0
          ? putApiV3EpisodeMonitor({
              client,
              body: { episodeIds, monitored: false },
            })
          : Promise.resolve(),
        deleteApiV3EpisodefileBulk({ client, body: { episodeFileIds } }),
      ])
    } catch (err) {
      toHttpError(err)
    }
  }

  async searchEpisodeReleases(episodeId: number): Promise<ShowRelease[]> {
    try {
      return await searchShowReleases(episodeId)
    } catch (err) {
      toHttpError(err)
    }
  }

  async grabRelease(
    _tvdbId: number,
    guid: string,
    indexerId: number,
  ): Promise<void> {
    try {
      const client = getSonarrClient()
      await postApiV3Release({
        client,
        body: { guid, indexerId } as ReleaseResource,
      })
    } catch (err) {
      toHttpError(err)
    }
  }

  async setEpisodeMonitored(
    episodeId: number,
    monitored: boolean,
  ): Promise<void> {
    try {
      const client = getSonarrClient()
      const result = await getApiV3EpisodeById({
        client,
        path: { id: episodeId },
      })
      const episode = result.data as EpisodeResource
      await putApiV3EpisodeById({
        client,
        path: { id: episodeId },
        body: { ...episode, monitored },
      })
    } catch (err) {
      toHttpError(err)
    }
  }

  async addShowToLibrary(tvdbId: number): Promise<{ seriesId: number }> {
    try {
      const client = getSonarrClient()
      const [lookupResult, rootFolderResult, qualityProfileResult] =
        await Promise.all([
          getApiV3SeriesLookup({ client, query: { term: `tvdb:${tvdbId}` } }),
          getApiV3Rootfolder({ client }),
          getApiV3Qualityprofile({ client }),
        ])

      const series = ((lookupResult.data ?? []) as SeriesResource[])[0]
      if (!series) {
        throw new BadRequestException(`No series found for tvdbId ${tvdbId}`)
      }

      const rootFolders = rootFolderResult.data as Array<{
        path?: string | null
      }>
      const qualityProfiles = qualityProfileResult.data as Array<{
        id?: number
      }>
      const rootFolderPath = rootFolders[0]?.path ?? '/shows'
      const qualityProfileId = qualityProfiles[0]?.id ?? 1

      const result = await postApiV3Series({
        client,
        body: {
          ...series,
          rootFolderPath,
          qualityProfileId,
          monitored: false,
          addOptions: { searchForMissingEpisodes: false, monitor: 'none' },
        } as SeriesResource,
      })
      const created = result.data as SeriesResource
      return { seriesId: created.id ?? 0 }
    } catch (err) {
      if (err instanceof BadRequestException) throw err
      toHttpError(err)
    }
  }

  async removeShowFromLibrary(seriesId: number, tvdbId: number): Promise<void> {
    try {
      const client = getSonarrClient()
      await Promise.all([
        deleteApiV3SeriesById({
          client,
          path: { id: seriesId },
          query: { deleteFiles: true, addImportListExclusion: false },
        }),
        clearAllShowSearchResults(tvdbId),
      ])
    } catch (err) {
      toHttpError(err)
    }
  }

  async clearEpisodeSearchNotFound(
    tvdbId: number,
    seasonNumber: number,
    episodeNumber: number,
  ): Promise<void> {
    await clearEpisodeSearchResult(tvdbId, seasonNumber, episodeNumber)
  }
}
