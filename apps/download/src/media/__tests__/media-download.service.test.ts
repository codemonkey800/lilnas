// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// MediaDownloadService) must mock it first (see
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
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { DownloadStateService } from 'src/download/download-state.service'
import { MediaDownloadService } from 'src/media/media-download.service'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

describe('MediaDownloadService', () => {
  let service: MediaDownloadService
  let downloadStateService: DownloadStateService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>

  beforeEach(async () => {
    const mockRadarrService = {
      search: jest.fn(),
      requestMovie: jest.fn(),
      getQueue: jest.fn(),
      unmonitorAndDelete: jest.fn(),
    }
    const mockSonarrService = {
      search: jest.fn(),
      requestShow: jest.fn(),
      getQueue: jest.fn(),
      unmonitorAndDelete: jest.fn(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MediaDownloadService,
        DownloadStateService,
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: SonarrService, useValue: mockSonarrService },
      ],
    }).compile()

    service = module.get(MediaDownloadService)
    downloadStateService = module.get(DownloadStateService)
    radarrService = module.get(RadarrService)
    sonarrService = module.get(SonarrService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  describe('searchMovies / searchShows', () => {
    it('delegates to RadarrService/SonarrService', async () => {
      radarrService.search.mockResolvedValue([
        { tmdbId: 1, title: 'A' },
      ] as never)
      sonarrService.search.mockResolvedValue([
        { tvdbId: 2, title: 'B' },
      ] as never)

      await expect(service.searchMovies('a')).resolves.toEqual([
        { tmdbId: 1, title: 'A' },
      ])
      await expect(service.searchShows('b')).resolves.toEqual([
        { tvdbId: 2, title: 'B' },
      ])
      expect(radarrService.search).toHaveBeenCalledWith('a')
      expect(sonarrService.search).toHaveBeenCalledWith('b')
    })
  })

  describe('requestMovie', () => {
    it('creates a Requested job, then moves it to Searching on success', async () => {
      radarrService.requestMovie.mockResolvedValue({
        radarrId: 42,
        title: 'A Movie',
        posterUrl: 'poster.jpg',
      })

      const job = await service.requestMovie(123)

      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(job.radarrId).toBe(42)
      expect(job.mediaTitle).toBe('A Movie')
      expect(job.posterUrl).toBe('poster.jpg')
      expect(job.type).toBe(DownloadType.Movie)
      expect(downloadStateService.jobs.get(job.id)).toEqual(job)
    })

    it('moves the job to Failed when RadarrService throws', async () => {
      radarrService.requestMovie.mockRejectedValue(new Error('radarr down'))

      const job = await service.requestMovie(123)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toBe('radarr down')
    })
  })

  describe('requestShow', () => {
    it('creates a Requested job, then moves it to Searching on success', async () => {
      sonarrService.requestShow.mockResolvedValue({
        sonarrId: 9,
        title: 'A Show',
        posterUrl: 'poster.jpg',
      })

      const job = await service.requestShow(456)

      expect(job.status).toBe(DownloadJobStatus.Searching)
      expect(job.sonarrId).toBe(9)
      expect(job.mediaTitle).toBe('A Show')
      expect(job.type).toBe(DownloadType.Show)
    })

    it('moves the job to Failed when SonarrService throws', async () => {
      sonarrService.requestShow.mockRejectedValue(new Error('sonarr down'))

      const job = await service.requestShow(456)

      expect(job.status).toBe(DownloadJobStatus.Failed)
      expect(job.error).toBe('sonarr down')
    })
  })

  describe('getMovieJob / getShowJob', () => {
    it('throws when the job does not exist', () => {
      expect(() => service.getMovieJob('missing')).toThrow('not found')
      expect(() => service.getShowJob('missing')).toThrow('not found')
    })

    it('throws when the job exists but is the wrong type', () => {
      const showJob: ShowDownloadJob = {
        id: 'show-1',
        status: DownloadJobStatus.Requested,
        type: DownloadType.Show,
        url: 'sonarr://tvdb/1',
      }
      downloadStateService.jobs.set(showJob.id, showJob)

      expect(() => service.getMovieJob('show-1')).toThrow(
        "Expected a movie job but got a 'show' job",
      )
    })

    it('returns the job when it matches the expected type', () => {
      const movieJob: MovieDownloadJob = {
        id: 'movie-1',
        status: DownloadJobStatus.Searching,
        type: DownloadType.Movie,
        url: 'radarr://tmdb/1',
      }
      downloadStateService.jobs.set(movieJob.id, movieJob)

      expect(service.getMovieJob('movie-1')).toEqual(movieJob)
    })
  })

  describe('deleteMovieJob', () => {
    it('unmonitors and deletes in Radarr when radarrId is set, then cancels the job', async () => {
      const movieJob: MovieDownloadJob = {
        id: 'movie-1',
        radarrId: 42,
        status: DownloadJobStatus.Downloading,
        type: DownloadType.Movie,
        url: 'radarr://tmdb/1',
      }
      downloadStateService.jobs.set(movieJob.id, movieJob)
      radarrService.unmonitorAndDelete.mockResolvedValue(undefined)

      const result = await service.deleteMovieJob('movie-1')

      expect(radarrService.unmonitorAndDelete).toHaveBeenCalledWith(42)
      expect(result.status).toBe(DownloadJobStatus.Cancelled)
    })

    it('skips the Radarr call when the job never got a radarrId', async () => {
      const movieJob: MovieDownloadJob = {
        id: 'movie-1',
        status: DownloadJobStatus.Requested,
        type: DownloadType.Movie,
        url: 'radarr://tmdb/1',
      }
      downloadStateService.jobs.set(movieJob.id, movieJob)

      const result = await service.deleteMovieJob('movie-1')

      expect(radarrService.unmonitorAndDelete).not.toHaveBeenCalled()
      expect(result.status).toBe(DownloadJobStatus.Cancelled)
    })
  })

  describe('deleteShowJob', () => {
    it('unmonitors and deletes in Sonarr when sonarrId is set, then cancels the job', async () => {
      const showJob: ShowDownloadJob = {
        id: 'show-1',
        sonarrId: 9,
        status: DownloadJobStatus.Downloading,
        type: DownloadType.Show,
        url: 'sonarr://tvdb/1',
      }
      downloadStateService.jobs.set(showJob.id, showJob)
      sonarrService.unmonitorAndDelete.mockResolvedValue(undefined)

      const result = await service.deleteShowJob('show-1')

      expect(sonarrService.unmonitorAndDelete).toHaveBeenCalledWith(9)
      expect(result.status).toBe(DownloadJobStatus.Cancelled)
    })
  })
})
