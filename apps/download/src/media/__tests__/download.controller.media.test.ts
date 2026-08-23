// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> MediaDownloadService) must mock it first (see
// apps/tdr-bot/src/media/services/__tests__/radarr.service.test.ts for the
// same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  type BadFile,
  DownloadJob,
  DownloadJobStatus,
  DownloadType,
  Media,
  type Release,
} from '@lilnas/utils/download/types'
import {
  ConflictException,
  HttpException,
  Logger,
  NotFoundException,
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AdminCheckService } from 'src/auth/admin-check.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { DiscoveryService } from 'src/media/discovery.service'
import { MediaDownloadService } from 'src/media/media-download.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { ReleaseService } from 'src/media/release.service'

import { createFakeMediaResolver } from './helpers/fake-media-resolver'

// This exercises DownloadController's new movie/show endpoints only. It
// lives under src/media/__tests__ (rather than src/download/__tests__)
// because this unit's file ownership only covers specific files inside
// src/download, not the whole directory - a parallel unit owns the rest of
// that directory's test surface.
describe('DownloadController - media endpoints', () => {
  let controller: DownloadController
  let mediaDownloadService: jest.Mocked<MediaDownloadService>
  let adminCheckService: jest.Mocked<AdminCheckService>
  let mediaResolver: ReturnType<typeof createFakeMediaResolver>
  let jobQueryService: { listJobsForMedia: jest.Mock }
  let releaseService: jest.Mocked<ReleaseService>
  let videosById: Map<string, unknown>

  beforeEach(async () => {
    const mockMediaDownloadService = {
      searchMovies: jest.fn(),
      searchShows: jest.fn(),
      requestMovie: jest.fn(),
      requestShow: jest.fn(),
      getMovieJob: jest.fn(),
      getShowJob: jest.fn(),
      deleteMovieJob: jest.fn(),
      deleteShowJob: jest.fn(),
    }
    const mockAdminCheckService = { checkIsAdmin: jest.fn() }
    const mockReleaseService = {
      flagBadFile: jest.fn(),
      grabRelease: jest.fn(),
      listBadFiles: jest.fn(),
      listReleases: jest.fn(),
      replaceRelease: jest.fn(),
    }
    mediaResolver = createFakeMediaResolver()
    jobQueryService = { listJobsForMedia: jest.fn().mockResolvedValue([]) }
    videosById = new Map()

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        { provide: AdminCheckService, useValue: mockAdminCheckService },
        { provide: DiscoveryService, useValue: {} },
        { provide: DownloadService, useValue: {} },
        {
          provide: DownloadStateService,
          useValue: {
            jobs: new Map(),
            getVideo: (id: string) => videosById.get(id),
          },
        },
        { provide: JobQueryService, useValue: jobQueryService },
        { provide: MediaDownloadService, useValue: mockMediaDownloadService },
        { provide: MediaResolverService, useValue: mediaResolver },
        { provide: ReleaseService, useValue: mockReleaseService },
      ],
    }).compile()

    controller = module.get(DownloadController)
    mediaDownloadService = module.get(MediaDownloadService)
    releaseService = module.get(ReleaseService)
    adminCheckService = module.get(AdminCheckService)
    adminCheckService.checkIsAdmin.mockResolvedValue(false)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  const NOW_ISO = '2026-08-20T12:00:00.000Z'

  const movieMedia: Media = {
    id: 'tmdb:1',
    posterUrl: 'poster.jpg',
    queueSnapshot: { progress: 50 },
    radarrId: 42,
    title: 'A Movie',
    tmdbId: 1,
    type: DownloadType.Movie,
  }

  const showMedia: Media = {
    id: 'tvdb:1',
    posterUrl: 'poster.jpg',
    queueSnapshot: { progress: 25 },
    sonarrId: 9,
    title: 'A Show',
    tvdbId: 1,
    type: DownloadType.Show,
  }

  function buildJob(id: string, media: Media, status: DownloadJobStatus) {
    return {
      completedAt: null,
      createdAt: NOW_ISO,
      hiddenAttribution: false,
      id,
      media,
      requester: null,
      status,
      updatedAt: NOW_ISO,
    } satisfies DownloadJob
  }

  const movieJob = buildJob(
    'movie-1',
    movieMedia,
    DownloadJobStatus.Downloading,
  )
  const showJob = buildJob('show-1', showMedia, DownloadJobStatus.Importing)

  describe('searchMovies', () => {
    it('wraps MediaDownloadService results in a results envelope', async () => {
      mediaDownloadService.searchMovies.mockResolvedValue([movieMedia])

      const response = await controller.searchMovies({ query: 'a' })

      expect(mediaDownloadService.searchMovies).toHaveBeenCalledWith('a')
      // Search now returns the same `Media` shape every other endpoint
      // does - a search hit and a library item are one type.
      expect(response).toEqual({ results: [movieMedia] })
    })
  })

  describe('requestMovie', () => {
    it('returns the created job with its media nested', async () => {
      mediaDownloadService.requestMovie.mockResolvedValue(movieJob)

      const response = await controller.requestMovie({ tmdbId: 123 }, undefined)

      expect(mediaDownloadService.requestMovie).toHaveBeenCalledWith(
        123,
        undefined,
      )
      expect(response).toEqual(movieJob)
      expect(response).not.toHaveProperty('url')
    })

    it('threads the resolved requester through to MediaDownloadService', async () => {
      const user: ForwardedUser = { email: 'alice@example.com', userId: 'u1' }
      mediaDownloadService.requestMovie.mockResolvedValue(movieJob)

      await controller.requestMovie({ tmdbId: 123 }, user)

      expect(mediaDownloadService.requestMovie).toHaveBeenCalledWith(123, user)
    })
  })

  describe('getMovieJob', () => {
    it('returns the mapped job on success', async () => {
      mediaDownloadService.getMovieJob.mockResolvedValue(movieJob)

      const response = await controller.getMovieJob('movie-1', undefined)

      expect(response.id).toBe('movie-1')
      expect(response.media).toEqual(movieMedia)
    })

    it('converts a MediaDownloadService error into a 404 HttpException', async () => {
      mediaDownloadService.getMovieJob.mockRejectedValue(
        new Error("Job with ID 'missing' not found"),
      )

      await expect(
        controller.getMovieJob('missing', undefined),
      ).rejects.toThrow(HttpException)

      try {
        await controller.getMovieJob('missing', undefined)
      } catch (err) {
        expect(err).toBeInstanceOf(HttpException)
        expect((err as HttpException).getStatus()).toBe(404)
      }
    })
  })

  describe('deleteMovieJob', () => {
    it('returns the mapped job after deletion', async () => {
      mediaDownloadService.deleteMovieJob.mockResolvedValue({
        ...movieJob,
        status: DownloadJobStatus.Cancelled,
      })

      const response = await controller.deleteMovieJob('movie-1', undefined)

      expect(mediaDownloadService.deleteMovieJob).toHaveBeenCalledWith(
        'movie-1',
      )
      expect(response.status).toBe(DownloadJobStatus.Cancelled)
    })

    it('converts a MediaDownloadService error into a 404 HttpException', async () => {
      mediaDownloadService.deleteMovieJob.mockRejectedValue(
        new Error('not found'),
      )

      await expect(
        controller.deleteMovieJob('missing', undefined),
      ).rejects.toThrow(HttpException)
    })
  })

  describe('searchShows / requestShow / getShowJob / deleteShowJob', () => {
    it('mirror the movie endpoints for shows', async () => {
      mediaDownloadService.searchShows.mockResolvedValue([showMedia])
      await expect(controller.searchShows({ query: 'b' })).resolves.toEqual({
        results: [showMedia],
      })

      mediaDownloadService.requestShow.mockResolvedValue(showJob)
      const requested = await controller.requestShow({ tvdbId: 456 }, undefined)
      expect(requested.media).toEqual(showMedia)
      expect(requested).not.toHaveProperty('url')
      expect(mediaDownloadService.requestShow).toHaveBeenCalledWith(
        456,
        undefined,
      )

      mediaDownloadService.getShowJob.mockResolvedValue(showJob)
      expect((await controller.getShowJob('show-1', undefined)).id).toBe(
        'show-1',
      )

      mediaDownloadService.deleteShowJob.mockResolvedValue({
        ...showJob,
        status: DownloadJobStatus.Cancelled,
      })
      const deleted = await controller.deleteShowJob('show-1', undefined)
      expect(deleted.status).toBe(DownloadJobStatus.Cancelled)
    })
  })

  describe('isAdmin resolution', () => {
    it('resolves isAdmin from the current user (movie/show jobs are always attributed)', async () => {
      const admin: ForwardedUser = { email: 'admin@example.com', userId: 'a1' }
      adminCheckService.checkIsAdmin.mockResolvedValue(true)
      mediaDownloadService.getMovieJob.mockResolvedValue({
        ...movieJob,
        requester: { email: 'alice@example.com', userId: 'u1' },
      })

      const response = await controller.getMovieJob('movie-1', admin)

      expect(adminCheckService.checkIsAdmin).toHaveBeenCalledWith(
        'admin@example.com',
      )
      expect(response.requester).toEqual({
        email: 'alice@example.com',
        userId: 'u1',
      })
    })

    it('never calls checkIsAdmin when there is no current user', async () => {
      mediaDownloadService.getMovieJob.mockResolvedValue(movieJob)

      await controller.getMovieJob('movie-1', undefined)

      expect(adminCheckService.checkIsAdmin).not.toHaveBeenCalled()
    })
  })

  // GET /download/media/:id - the library view. Job-keyed routes stay
  // job-keyed; this is the media-keyed one, and it is what makes a movie
  // have a detail page before anyone has requested it.
  describe('getMediaDetail', () => {
    it('resolves a movie nobody has downloaded, with an empty jobs list', async () => {
      mediaResolver.fixtures.set('tmdb:438631', {
        id: 'tmdb:438631',
        title: 'Dune',
        tmdbId: 438631,
        type: DownloadType.Movie,
      })

      const response = await controller.getMediaDetail('tmdb:438631', undefined)

      expect(response.media).toMatchObject({ title: 'Dune' })
      // `jobs: []` IS the "not downloaded yet" state - the frontend needs
      // no extra field, and no row has to exist anywhere.
      expect(response.jobs).toEqual([])
    })

    it('attaches every job for a downloaded title', async () => {
      jobQueryService.listJobsForMedia.mockResolvedValue([movieJob])

      const response = await controller.getMediaDetail('tmdb:1', undefined)

      expect(jobQueryService.listJobsForMedia).toHaveBeenCalledWith('tmdb:1')
      expect(response.jobs.map(job => job.id)).toEqual(['movie-1'])
    })

    it('masks attribution on the attached jobs', async () => {
      jobQueryService.listJobsForMedia.mockResolvedValue([
        {
          ...buildJob(
            'video-1',
            {
              id: 'video:v1',
              sourceUrl: 'https://example.com/video',
              title: 'A video',
              type: DownloadType.Video,
            },
            DownloadJobStatus.Completed,
          ),
          hiddenAttribution: true,
          requester: { email: 'alice@example.com', userId: 'u1' },
        },
      ])
      videosById.set('video:v1', { id: 'v1' })

      const response = await controller.getMediaDetail('video:v1', undefined)

      expect(response.jobs[0]?.requester).toBeNull()
    })

    // A video can't exist before it's downloaded, so an unknown video key is
    // a genuine 404 - unlike a tmdb/tvdb key, which always resolves.
    it('404s an unknown video key', async () => {
      await expect(
        controller.getMediaDetail('video:nonexistent', undefined),
      ).rejects.toThrow(HttpException)
      expect(mediaResolver.resolve).not.toHaveBeenCalled()
    })

    it('404s a key with an unrecognized prefix rather than reaching upstream', async () => {
      await expect(
        controller.getMediaDetail('garbage', undefined),
      ).rejects.toThrow(HttpException)
      expect(mediaResolver.resolve).not.toHaveBeenCalled()
    })

    // With Radarr down the resolver degrades to a placeholder rather than
    // throwing, so the page still renders its jobs with correct status and
    // attribution - the title is what degrades, not the request.
    it('still returns a page when the upstream lookup is degraded', async () => {
      mediaResolver.fixtures.set('tmdb:5', {
        id: 'tmdb:5',
        title: 'tmdb:5',
        tmdbId: 5,
        type: DownloadType.Movie,
      })
      jobQueryService.listJobsForMedia.mockResolvedValue([movieJob])

      const response = await controller.getMediaDetail('tmdb:5', undefined)

      expect(response.media.title).toBe('tmdb:5')
      expect(response.jobs).toHaveLength(1)
    })
  })

  // ---- Phase 3 ----

  const alice: ForwardedUser = { email: 'alice@example.com', userId: 'u1' }

  const sampleRelease: Release = {
    downloadAllowed: true,
    flaggedBad: false,
    guid: 'indexer://abc',
    indexerId: 3,
    rejected: false,
    title: 'Some.Movie.2020.1080p',
  }

  const sampleBadFile: BadFile = {
    createdAt: '2026-08-20T12:00:00.000Z',
    flaggedBy: alice,
    id: 1,
    indexerId: 3,
    mediaId: 'tmdb:1',
    reason: null,
    releaseGuid: 'indexer://abc',
    releaseTitle: 'Some.Movie.2020.1080p',
  }

  describe('listReleases', () => {
    it('wraps the service results in a releases envelope', async () => {
      releaseService.listReleases.mockResolvedValue([sampleRelease])

      const response = await controller.listReleases('tmdb:1', {})

      expect(releaseService.listReleases).toHaveBeenCalledWith('tmdb:1', {
        episodeId: undefined,
        seasonNumber: undefined,
      })
      expect(response).toEqual({ releases: [sampleRelease] })
    })

    it('passes the season/episode scope through', async () => {
      releaseService.listReleases.mockResolvedValue([])

      await controller.listReleases('tvdb:1', {
        episodeId: 4412,
        seasonNumber: 2,
      })

      expect(releaseService.listReleases).toHaveBeenCalledWith('tvdb:1', {
        episodeId: 4412,
        seasonNumber: 2,
      })
    })

    it('returns an empty envelope rather than 404ing when nothing was found', async () => {
      releaseService.listReleases.mockResolvedValue([])

      await expect(controller.listReleases('tmdb:1', {})).resolves.toEqual({
        releases: [],
      })
    })

    // Unlike the job routes, a service error is not laundered into a 404 -
    // ReleaseService already throws the right HttpException for a bad media
    // id, and anything else is a real failure.
    it('lets a service error propagate untouched', async () => {
      releaseService.listReleases.mockRejectedValue(
        new NotFoundException('nope'),
      )

      await expect(controller.listReleases('video:x', {})).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  describe('grabRelease / replaceRelease', () => {
    const input = { guid: 'indexer://abc', indexerId: 3 }

    it('returns the created job for a grab, threading the requester through', async () => {
      releaseService.grabRelease.mockResolvedValue(movieJob)

      const response = await controller.grabRelease('tmdb:1', input, alice)

      expect(releaseService.grabRelease).toHaveBeenCalledWith(
        'tmdb:1',
        input,
        alice,
      )
      expect(response).toEqual(movieJob)
    })

    it('accepts a grab with no forwarded identity', async () => {
      releaseService.grabRelease.mockResolvedValue(movieJob)

      await controller.grabRelease('tmdb:1', input, undefined)

      expect(releaseService.grabRelease).toHaveBeenCalledWith(
        'tmdb:1',
        input,
        undefined,
      )
    })

    it('returns the created job for a replace', async () => {
      releaseService.replaceRelease.mockResolvedValue(movieJob)

      const response = await controller.replaceRelease('tmdb:1', input, alice)

      expect(releaseService.replaceRelease).toHaveBeenCalledWith(
        'tmdb:1',
        input,
        alice,
      )
      expect(response).toEqual(movieJob)
    })

    // A flagged guid must stay a 409. mediaJobRoute() would have turned it
    // into a 404, which is why these routes deliberately don't use it.
    it('lets a ConflictException through as-is rather than laundering it to a 404', async () => {
      releaseService.grabRelease.mockRejectedValue(
        new ConflictException('flagged'),
      )

      await expect(
        controller.grabRelease('tmdb:1', input, alice),
      ).rejects.toThrow(ConflictException)
    })
  })

  describe('flagBadFile / listBadFiles', () => {
    it('records the flag with the guard-supplied identity', () => {
      releaseService.flagBadFile.mockReturnValue(sampleBadFile)

      const response = controller.flagBadFile(
        'tmdb:1',
        { guid: 'indexer://abc' },
        alice,
      )

      expect(releaseService.flagBadFile).toHaveBeenCalledWith(
        'tmdb:1',
        { guid: 'indexer://abc' },
        alice,
      )
      expect(response).toEqual({ badFile: sampleBadFile })
    })

    it('wraps the flag list in a badFiles envelope', () => {
      releaseService.listBadFiles.mockReturnValue([sampleBadFile])

      expect(controller.listBadFiles('tmdb:1')).toEqual({
        badFiles: [sampleBadFile],
      })
    })

    it('returns an empty envelope for a title with no flags', () => {
      releaseService.listBadFiles.mockReturnValue([])

      expect(controller.listBadFiles('tmdb:1')).toEqual({ badFiles: [] })
    })
  })
})
