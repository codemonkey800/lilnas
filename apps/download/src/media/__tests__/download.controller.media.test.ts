// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> MediaDownloadService) must mock it first (see
// apps/tdr-bot/src/media/services/__tests__/radarr.service.test.ts for the
// same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import {
  DownloadJobStatus,
  DownloadType,
  MovieDownloadJob,
  ShowDownloadJob,
} from '@lilnas/utils/download/types'
import { HttpException, Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AdminCheckService } from 'src/auth/admin-check.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { MediaDownloadService } from 'src/media/media-download.service'

// This exercises DownloadController's new movie/show endpoints only. It
// lives under src/media/__tests__ (rather than src/download/__tests__)
// because this unit's file ownership only covers specific files inside
// src/download, not the whole directory - a parallel unit owns the rest of
// that directory's test surface.
describe('DownloadController - media endpoints', () => {
  let controller: DownloadController
  let mediaDownloadService: jest.Mocked<MediaDownloadService>
  let adminCheckService: jest.Mocked<AdminCheckService>

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        { provide: AdminCheckService, useValue: mockAdminCheckService },
        { provide: DownloadService, useValue: {} },
        { provide: DownloadStateService, useValue: { jobs: new Map() } },
        { provide: MediaDownloadService, useValue: mockMediaDownloadService },
      ],
    }).compile()

    controller = module.get(DownloadController)
    mediaDownloadService = module.get(MediaDownloadService)
    adminCheckService = module.get(AdminCheckService)
    adminCheckService.checkIsAdmin.mockResolvedValue(false)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  const movieJob: MovieDownloadJob = {
    description: undefined,
    error: undefined,
    id: 'movie-1',
    mediaTitle: 'A Movie',
    posterUrl: 'poster.jpg',
    queueSnapshot: { progress: 50 },
    radarrId: 42,
    requester: null,
    status: DownloadJobStatus.Downloading,
    title: undefined,
    type: DownloadType.Movie,
    url: 'radarr://tmdb/1',
  }

  const showJob: ShowDownloadJob = {
    description: undefined,
    error: undefined,
    id: 'show-1',
    mediaTitle: 'A Show',
    posterUrl: 'poster.jpg',
    queueSnapshot: { progress: 25 },
    requester: null,
    sonarrId: 9,
    status: DownloadJobStatus.Importing,
    title: undefined,
    type: DownloadType.Show,
    url: 'sonarr://tvdb/1',
  }

  describe('searchMovies', () => {
    it('wraps MediaDownloadService results in a results envelope', async () => {
      mediaDownloadService.searchMovies.mockResolvedValue([
        { tmdbId: 1, title: 'A' },
      ])

      const response = await controller.searchMovies({ query: 'a' })

      expect(mediaDownloadService.searchMovies).toHaveBeenCalledWith('a')
      expect(response).toEqual({ results: [{ tmdbId: 1, title: 'A' }] })
    })
  })

  describe('requestMovie', () => {
    it('maps the created job to GetMovieJobResponse (excluding url)', async () => {
      mediaDownloadService.requestMovie.mockResolvedValue(movieJob)

      const response = await controller.requestMovie({ tmdbId: 123 }, undefined)

      expect(mediaDownloadService.requestMovie).toHaveBeenCalledWith(
        123,
        undefined,
      )
      expect(response).toEqual({
        description: undefined,
        error: undefined,
        hiddenAttribution: undefined,
        id: 'movie-1',
        mediaTitle: 'A Movie',
        posterUrl: 'poster.jpg',
        queueSnapshot: { progress: 50 },
        radarrId: 42,
        requester: null,
        status: DownloadJobStatus.Downloading,
        title: undefined,
        type: DownloadType.Movie,
      })
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
      mediaDownloadService.getMovieJob.mockReturnValue(movieJob)

      const response = await controller.getMovieJob('movie-1', undefined)

      expect(response.id).toBe('movie-1')
      expect(response.radarrId).toBe(42)
    })

    it('converts a MediaDownloadService error into a 404 HttpException', async () => {
      mediaDownloadService.getMovieJob.mockImplementation(() => {
        throw new Error("Job with ID 'missing' not found")
      })

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
      mediaDownloadService.searchShows.mockResolvedValue([
        { tvdbId: 2, title: 'B' },
      ])
      await expect(controller.searchShows({ query: 'b' })).resolves.toEqual({
        results: [{ tvdbId: 2, title: 'B' }],
      })

      mediaDownloadService.requestShow.mockResolvedValue(showJob)
      const requested = await controller.requestShow({ tvdbId: 456 }, undefined)
      expect(requested.sonarrId).toBe(9)
      expect(requested).not.toHaveProperty('url')
      expect(mediaDownloadService.requestShow).toHaveBeenCalledWith(
        456,
        undefined,
      )

      mediaDownloadService.getShowJob.mockReturnValue(showJob)
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
      mediaDownloadService.getMovieJob.mockReturnValue({
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
      mediaDownloadService.getMovieJob.mockReturnValue(movieJob)

      await controller.getMovieJob('movie-1', undefined)

      expect(adminCheckService.checkIsAdmin).not.toHaveBeenCalled()
    })
  })
})
