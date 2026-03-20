import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { TokenAuthGuard } from 'src/auth/token-auth.guard'
import { DownloadsController } from 'src/downloads/downloads.controller'
import { DownloadsService } from 'src/downloads/downloads.service'

describe('DownloadsController', () => {
  let controller: DownloadsController
  let mockService: jest.Mocked<
    Pick<
      DownloadsService,
      | 'requestDownload'
      | 'getMovieStatus'
      | 'getShowStatus'
      | 'getAllDownloads'
      | 'cancelMovieDownload'
      | 'cancelShowDownloads'
      | 'cancelEpisodeDownload'
      | 'cancelSeasonDownloads'
    >
  >

  beforeEach(async () => {
    mockService = {
      requestDownload: jest.fn().mockResolvedValue(undefined),
      getMovieStatus: jest.fn().mockResolvedValue(null),
      getShowStatus: jest.fn().mockReturnValue([]),
      getAllDownloads: jest.fn().mockResolvedValue({ movies: [], shows: [] }),
      cancelMovieDownload: jest.fn().mockResolvedValue(undefined),
      cancelShowDownloads: jest
        .fn()
        .mockResolvedValue({ cancelledEpisodeIds: [] }),
      cancelEpisodeDownload: jest.fn().mockResolvedValue(undefined),
      cancelSeasonDownloads: jest
        .fn()
        .mockResolvedValue({ cancelledEpisodeIds: [] }),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadsController],
      providers: [{ provide: DownloadsService, useValue: mockService }],
    })
      .overrideGuard(TokenAuthGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get(DownloadsController)
  })

  // ---------------------------------------------------------------------------
  // POST / (requestDownload)
  // ---------------------------------------------------------------------------

  describe('requestDownload', () => {
    it('accepts a valid movie request and returns ok: true', async () => {
      const result = await controller.requestDownload({
        mediaType: 'movie',
        tmdbId: 123,
      })
      expect(result).toEqual({ ok: true })
      expect(mockService.requestDownload).toHaveBeenCalledWith(
        expect.objectContaining({ mediaType: 'movie', tmdbId: 123 }),
      )
    })

    it('accepts a valid show/series request', async () => {
      const result = await controller.requestDownload({
        mediaType: 'show',
        tvdbId: 456,
        scope: 'series',
      })
      expect(result).toEqual({ ok: true })
    })

    it('throws BadRequestException for an invalid request body', async () => {
      await expect(
        controller.requestDownload({ mediaType: 'unknown' }),
      ).rejects.toThrow(BadRequestException)
      expect(mockService.requestDownload).not.toHaveBeenCalled()
    })

    it('throws BadRequestException when body is empty', async () => {
      await expect(controller.requestDownload({})).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException when releaseGuid is provided without indexerId', async () => {
      await expect(
        controller.requestDownload({
          mediaType: 'movie',
          tmdbId: 123,
          releaseGuid: 'some-guid',
        }),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ---------------------------------------------------------------------------
  // GET movie/:tmdbId
  // ---------------------------------------------------------------------------

  describe('getMovieStatus', () => {
    it('delegates to service with parsed tmdbId', async () => {
      mockService.getMovieStatus.mockResolvedValue({
        state: 'downloading',
        title: null,
        size: 0,
        sizeleft: 0,
        progress: 50,
        eta: null,
        status: null,
      })
      const result = await controller.getMovieStatus('100')
      expect(mockService.getMovieStatus).toHaveBeenCalledWith(100)
      expect(result?.progress).toBe(50)
    })

    it('throws BadRequestException for non-numeric tmdbId', async () => {
      await expect(controller.getMovieStatus('abc')).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // DELETE movie/:tmdbId
  // ---------------------------------------------------------------------------

  describe('cancelMovieDownload', () => {
    it('delegates to service with parsed tmdbId', async () => {
      await controller.cancelMovieDownload('42')
      expect(mockService.cancelMovieDownload).toHaveBeenCalledWith(42)
    })

    it('throws BadRequestException for non-numeric tmdbId', async () => {
      await expect(controller.cancelMovieDownload('xyz')).rejects.toThrow(
        BadRequestException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // DELETE show/:tvdbId
  // ---------------------------------------------------------------------------

  describe('cancelShowDownloads', () => {
    it('delegates to service with parsed tvdbId', async () => {
      mockService.cancelShowDownloads.mockResolvedValue({
        cancelledEpisodeIds: [10, 11],
      })
      const result = await controller.cancelShowDownloads('2000')
      expect(mockService.cancelShowDownloads).toHaveBeenCalledWith(2000)
      expect(result.cancelledEpisodeIds).toEqual([10, 11])
    })

    it('throws BadRequestException for non-numeric tvdbId', async () => {
      await expect(
        controller.cancelShowDownloads('not-a-number'),
      ).rejects.toThrow(BadRequestException)
    })

    it('propagates NotFoundException from service when show not found', async () => {
      mockService.cancelShowDownloads.mockRejectedValue(
        new NotFoundException('Show not found'),
      )
      await expect(controller.cancelShowDownloads('9999')).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // DELETE show/:tvdbId/season/:seasonNumber
  // ---------------------------------------------------------------------------

  describe('cancelSeasonDownloads', () => {
    it('delegates to service with parsed tvdbId and seasonNumber', async () => {
      mockService.cancelSeasonDownloads.mockResolvedValue({
        cancelledEpisodeIds: [20],
      })
      const result = await controller.cancelSeasonDownloads('2000', '1')
      expect(mockService.cancelSeasonDownloads).toHaveBeenCalledWith(2000, 1)
      expect(result.cancelledEpisodeIds).toEqual([20])
    })

    it('accepts season 0 (specials)', async () => {
      await controller.cancelSeasonDownloads('2000', '0')
      expect(mockService.cancelSeasonDownloads).toHaveBeenCalledWith(2000, 0)
    })

    it('throws BadRequestException for negative seasonNumber', async () => {
      await expect(
        controller.cancelSeasonDownloads('2000', '-1'),
      ).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException for non-numeric seasonNumber', async () => {
      await expect(
        controller.cancelSeasonDownloads('2000', 'abc'),
      ).rejects.toThrow(BadRequestException)
    })
  })

  // ---------------------------------------------------------------------------
  // GET all
  // ---------------------------------------------------------------------------

  describe('getAllDownloads', () => {
    it('delegates to service and returns combined result', async () => {
      mockService.getAllDownloads.mockResolvedValue({
        movies: [],
        shows: [],
      })
      const result = await controller.getAllDownloads()
      expect(result).toEqual({ movies: [], shows: [] })
      expect(mockService.getAllDownloads).toHaveBeenCalled()
    })
  })
})
