import {
  deleteApiV3EpisodefileBulk,
  deleteApiV3EpisodefileById,
  type EpisodeFileResource,
  type EpisodeResource,
  getApiV3Episode,
  getApiV3Episodefile,
  getApiV3SeriesLookup,
  type SeriesResource,
} from '@lilnas/media/sonarr'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { SONARR_CLIENT, type SonarrMediaClient } from 'src/media/clients'

import { buildShowDetail, type ShowDetail } from './shows.types'

@Injectable()
export class ShowsService {
  constructor(
    @Inject(SONARR_CLIENT) private readonly sonarr: SonarrMediaClient,
  ) {}

  async getShow(tvdbId: number): Promise<ShowDetail> {
    const lookupResult = await getApiV3SeriesLookup({
      client: this.sonarr,
      query: { term: `tvdb:${tvdbId}` },
    })
    const series = ((lookupResult.data ?? []) as SeriesResource[])[0]

    if (!series?.id) {
      throw new NotFoundException(
        `Show with tvdbId ${tvdbId} not found in Sonarr library`,
      )
    }

    const [episodesResult, filesResult] = await Promise.all([
      getApiV3Episode({ client: this.sonarr, query: { seriesId: series.id } }),
      getApiV3Episodefile({
        client: this.sonarr,
        query: { seriesId: series.id },
      }),
    ])

    const episodes = (episodesResult.data ?? []) as EpisodeResource[]
    const files = (filesResult.data ?? []) as EpisodeFileResource[]

    return buildShowDetail(series, episodes, files)
  }

  async deleteEpisodeFile(
    tvdbId: number,
    episodeFileId: number,
  ): Promise<void> {
    const lookupResult = await getApiV3SeriesLookup({
      client: this.sonarr,
      query: { term: `tvdb:${tvdbId}` },
    })
    const series = ((lookupResult.data ?? []) as SeriesResource[])[0]

    if (!series?.id) {
      throw new NotFoundException(
        `Show with tvdbId ${tvdbId} not found in Sonarr library`,
      )
    }

    try {
      await deleteApiV3EpisodefileById({
        client: this.sonarr,
        path: { id: episodeFileId },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new NotFoundException(`Episode file not found: ${message}`)
    }
  }

  async deleteSeasonFiles(
    tvdbId: number,
    seasonNumber: number,
    seriesId: number,
  ): Promise<{ deletedFileIds: number[] }> {
    const filesResult = await getApiV3Episodefile({
      client: this.sonarr,
      query: { seriesId },
    })
    const files = (filesResult.data ?? []) as EpisodeFileResource[]

    const episodesResult = await getApiV3Episode({
      client: this.sonarr,
      query: { seriesId, seasonNumber },
    })
    const episodes = (episodesResult.data ?? []) as EpisodeResource[]

    const episodeFileIds = new Set(
      episodes
        .filter(ep => ep.episodeFileId != null)
        .map(ep => ep.episodeFileId!),
    )

    const seasonFiles = files.filter(
      f => f.id != null && episodeFileIds.has(f.id),
    )

    if (seasonFiles.length === 0) {
      return { deletedFileIds: [] }
    }

    const ids = seasonFiles.map(f => f.id!)
    await deleteApiV3EpisodefileBulk({
      client: this.sonarr,
      body: { episodeFileIds: ids } as Record<string, unknown>,
    })

    void tvdbId
    return { deletedFileIds: ids }
  }
}
