import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { TokenAuthGuard } from 'src/auth/token-auth.guard'
import { MoviesController } from 'src/movies/movies.controller'
import { MoviesService } from 'src/movies/movies.service'
import { type MovieDetail } from 'src/movies/movies.types'

function makeMovieDetail(overrides: Partial<MovieDetail> = {}): MovieDetail {
  return {
    id: 1,
    tmdbId: 100,
    title: 'Test Movie',
    year: 2024,
    runtime: 120,
    certification: 'PG-13',
    overview: 'A great film.',
    posterUrl: null,
    fanartUrl: null,
    quality: '1080p',
    status: 'downloaded',
    genres: ['Action'],
    ratings: { imdb: 8.0, tmdb: 7.5 },
    sizeOnDisk: 5_000_000_000,
    files: [],
    ...overrides,
  }
}

describe('MoviesController', () => {
  let controller: MoviesController
  let mockService: jest.Mocked<
    Pick<MoviesService, 'getMovie' | 'deleteMovieFile'>
  >

  beforeEach(async () => {
    mockService = {
      getMovie: jest.fn().mockResolvedValue(makeMovieDetail()),
      deleteMovieFile: jest.fn().mockResolvedValue(undefined),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [MoviesController],
      providers: [{ provide: MoviesService, useValue: mockService }],
    })
      .overrideGuard(TokenAuthGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get(MoviesController)
  })

  // ---------------------------------------------------------------------------
  // GET /movies/:tmdbId
  // ---------------------------------------------------------------------------

  describe('getMovie', () => {
    it('delegates to service with parsed tmdbId and returns movie detail', async () => {
      const detail = makeMovieDetail({ tmdbId: 42 })
      mockService.getMovie.mockResolvedValue(detail)

      const result = await controller.getMovie('42')

      expect(mockService.getMovie).toHaveBeenCalledWith(42)
      expect(result).toStrictEqual(detail)
    })

    it('throws BadRequestException for non-numeric tmdbId', async () => {
      await expect(controller.getMovie('abc')).rejects.toThrow(
        BadRequestException,
      )
      expect(mockService.getMovie).not.toHaveBeenCalled()
    })

    it('throws BadRequestException for zero tmdbId', async () => {
      await expect(controller.getMovie('0')).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException for negative tmdbId', async () => {
      await expect(controller.getMovie('-5')).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException for empty string tmdbId', async () => {
      await expect(controller.getMovie('')).rejects.toThrow(BadRequestException)
    })

    it('propagates NotFoundException from service when movie not found', async () => {
      mockService.getMovie.mockRejectedValue(
        new NotFoundException('Movie not found'),
      )
      await expect(controller.getMovie('999')).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // DELETE /movies/:tmdbId/files/:fileId
  // ---------------------------------------------------------------------------

  describe('deleteMovieFile', () => {
    it('delegates to service with parsed tmdbId and fileId', async () => {
      await controller.deleteMovieFile('100', '10')

      expect(mockService.deleteMovieFile).toHaveBeenCalledWith(100, 10)
    })

    it('throws BadRequestException for non-numeric tmdbId', async () => {
      await expect(controller.deleteMovieFile('abc', '10')).rejects.toThrow(
        BadRequestException,
      )
      expect(mockService.deleteMovieFile).not.toHaveBeenCalled()
    })

    it('throws BadRequestException for non-numeric fileId', async () => {
      await expect(controller.deleteMovieFile('100', 'xyz')).rejects.toThrow(
        BadRequestException,
      )
      expect(mockService.deleteMovieFile).not.toHaveBeenCalled()
    })

    it('throws BadRequestException for zero fileId', async () => {
      await expect(controller.deleteMovieFile('100', '0')).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException for negative fileId', async () => {
      await expect(controller.deleteMovieFile('100', '-1')).rejects.toThrow(
        BadRequestException,
      )
    })

    it('propagates NotFoundException from service when file not found', async () => {
      mockService.deleteMovieFile.mockRejectedValue(
        new NotFoundException('Movie file not found'),
      )
      await expect(controller.deleteMovieFile('100', '10')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('returns undefined on successful deletion', async () => {
      const result = await controller.deleteMovieFile('100', '10')
      expect(result).toBeUndefined()
    })
  })
})
