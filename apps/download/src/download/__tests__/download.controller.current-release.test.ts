// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> MediaDownloadService) must mock it first.
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import { DownloadType, Media, Movie } from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AuditLogService } from 'src/audit/audit-log.service'
import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { AdminCheckService } from 'src/auth/admin-check.service'
import { DiscordLinkService } from 'src/auth/discord-link.service'
import type { MediaFileReleaseRow } from 'src/db/schema'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadMetricsService } from 'src/download/download-metrics.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { ProfileService } from 'src/download/profile.service'
import { createFakeMediaResolver } from 'src/media/__tests__/helpers/fake-media-resolver'
import { CurrentReleaseService } from 'src/media/current-release.service'
import { DiscoveryService } from 'src/media/discovery.service'
import { ManualImportService } from 'src/media/manual-import.service'
import { MediaDownloadService } from 'src/media/media-download.service'
import { MediaFileService } from 'src/media/media-file.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { ReleaseService } from 'src/media/release.service'
import { ShowService } from 'src/media/show.service'

// GET /media/:id is the ONLY route that annotates `currentReleaseGuid` -
// every list route would pay a history call per row for it. These specs pin
// both halves of that: that a movie detail carries the guid, and that
// nothing which isn't a library movie pays for the lookup.
describe('DownloadController - current release on the detail route', () => {
  let controller: DownloadController
  let currentReleaseService: { forMovie: jest.Mock }
  let mediaResolver: ReturnType<typeof createFakeMediaResolver>

  const movie: Movie = {
    id: 'tmdb:438631',
    radarrId: 12,
    title: 'Dune',
    tmdbId: 438631,
    type: DownloadType.Movie,
  }

  const show: Media = {
    id: 'tvdb:121361',
    sonarrId: 7,
    title: 'Game of Thrones',
    tvdbId: 121361,
    type: DownloadType.Show,
  }

  const releaseRow: MediaFileReleaseRow = {
    downloadId: 'dl-1',
    episodeId: null,
    id: 1,
    indexer: 'Nyaa',
    indexerId: 3,
    mediaId: 'tmdb:438631',
    mediaType: DownloadType.Movie,
    protocol: 'torrent',
    publishDate: new Date('2026-01-01T00:00:00.000Z'),
    releaseGroup: 'GRP',
    releaseGuid: 'guid-abc',
    releaseTitle: 'Dune.2021.2160p',
    resolvedAt: new Date('2026-08-20T12:00:00.000Z'),
    size: 42,
    upstreamFileId: 99,
  }

  beforeEach(async () => {
    currentReleaseService = { forMovie: jest.fn().mockResolvedValue(undefined) }
    mediaResolver = createFakeMediaResolver()

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        fakeAttributionResolutionProvider(),
        {
          provide: AdminCheckService,
          useValue: { checkIsAdmin: jest.fn().mockResolvedValue(false) },
        },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
        { provide: CurrentReleaseService, useValue: currentReleaseService },
        {
          provide: DiscordLinkService,
          useValue: { registerObservedIdentity: jest.fn() },
        },
        { provide: DiscoveryService, useValue: {} },
        { provide: DownloadMetricsService, useValue: {} },
        { provide: DownloadService, useValue: {} },
        { provide: DownloadStateService, useValue: { getVideo: jest.fn() } },
        {
          provide: JobQueryService,
          useValue: { listJobsForMedia: jest.fn().mockResolvedValue([]) },
        },
        { provide: ManualImportService, useValue: {} },
        { provide: MediaDownloadService, useValue: {} },
        { provide: MediaFileService, useValue: {} },
        { provide: MediaResolverService, useValue: mediaResolver },
        { provide: ProfileService, useValue: {} },
        { provide: ReleaseService, useValue: {} },
        { provide: ShowService, useValue: {} },
      ],
    }).compile()

    controller = module.get(DownloadController)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  it('annotates a movie whose file resolves to a release', async () => {
    mediaResolver.fixtures.set(movie.id, movie)
    currentReleaseService.forMovie.mockResolvedValue(releaseRow)

    const response = await controller.getMediaDetail(movie.id, undefined)

    expect(currentReleaseService.forMovie).toHaveBeenCalledWith(movie.id, 12)
    expect(response.media).toEqual({ ...movie, currentReleaseGuid: 'guid-abc' })
  })

  // "Unresolvable" has to leave the payload exactly as the resolver produced
  // it - an explicit `currentReleaseGuid: undefined` would read as a present
  // key to anything inspecting the object rather than the serialized body.
  it('leaves a movie with no recoverable release untouched', async () => {
    mediaResolver.fixtures.set(movie.id, movie)

    const response = await controller.getMediaDetail(movie.id, undefined)

    expect(response.media).toEqual(movie)
    expect(response.media).not.toHaveProperty('currentReleaseGuid')
  })

  // A movie that isn't in Radarr's library (a discover-only lookup) has no
  // file id to key the cache on, so it never reaches the service at all.
  it('skips a movie with no radarrId', async () => {
    mediaResolver.fixtures.set(movie.id, {
      id: movie.id,
      title: movie.title,
      tmdbId: movie.tmdbId,
      type: DownloadType.Movie,
    })

    const response = await controller.getMediaDetail(movie.id, undefined)

    expect(currentReleaseService.forMovie).not.toHaveBeenCalled()
    expect(response.media).not.toHaveProperty('currentReleaseGuid')
  })

  it('leaves a tvdb key alone', async () => {
    mediaResolver.fixtures.set(show.id, show)

    const response = await controller.getMediaDetail(show.id, undefined)

    expect(currentReleaseService.forMovie).not.toHaveBeenCalled()
    expect(response.media).toEqual(show)
  })

  // MediaResolverService hands the same object back for the whole TTL
  // window, so annotating in place would publish this guid to every other
  // reader of that cache entry - including the next request, after the guid
  // has stopped being the answer.
  it('does not write the guid onto the cached resolver object', async () => {
    mediaResolver.fixtures.set(movie.id, movie)
    currentReleaseService.forMovie.mockResolvedValue(releaseRow)

    await controller.getMediaDetail(movie.id, undefined)

    currentReleaseService.forMovie.mockResolvedValue(undefined)
    const second = await controller.getMediaDetail(movie.id, undefined)

    expect(movie).not.toHaveProperty('currentReleaseGuid')
    expect(second.media).not.toHaveProperty('currentReleaseGuid')
  })

  // CurrentReleaseService is documented never to throw; this pins that a
  // regression in it would still cost a release label rather than the page.
  it('still serves the page when the lookup throws', async () => {
    mediaResolver.fixtures.set(movie.id, movie)
    currentReleaseService.forMovie.mockRejectedValue(new Error('radarr down'))

    const response = await controller.getMediaDetail(movie.id, undefined)

    expect(response.media).toEqual(movie)
    expect(response.jobs).toEqual([])
  })
})
