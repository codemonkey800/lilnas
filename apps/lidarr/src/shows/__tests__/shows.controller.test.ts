import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { TokenAuthGuard } from 'src/auth/token-auth.guard'
import { ShowsController } from 'src/shows/shows.controller'
import { ShowsService } from 'src/shows/shows.service'
import { type ShowDetail } from 'src/shows/shows.types'

function makeShowDetail(overrides: Partial<ShowDetail> = {}): ShowDetail {
  return {
    id: 10,
    tvdbId: 2000,
    title: 'Test Show',
    year: 2021,
    overview: 'A great show.',
    posterUrl: null,
    fanartUrl: null,
    network: 'HBO',
    status: 'continuing',
    genres: ['Drama'],
    ratings: { value: 8.5 },
    runtime: 45,
    sizeOnDisk: 0,
    seasons: [],
    firstAired: '2021-01-01',
    imdbId: 'tt1234567',
    tmdbId: null,
    totalEpisodeCount: 10,
    episodeFileCount: 5,
    ...overrides,
  }
}

describe('ShowsController', () => {
  let controller: ShowsController
  let mockService: jest.Mocked<
    Pick<ShowsService, 'getShow' | 'deleteEpisodeFile' | 'deleteSeasonFiles'>
  >

  beforeEach(async () => {
    mockService = {
      getShow: jest.fn().mockResolvedValue(makeShowDetail()),
      deleteEpisodeFile: jest.fn().mockResolvedValue(undefined),
      deleteSeasonFiles: jest.fn().mockResolvedValue({ deletedFileIds: [] }),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ShowsController],
      providers: [{ provide: ShowsService, useValue: mockService }],
    })
      .overrideGuard(TokenAuthGuard)
      .useValue({ canActivate: () => true })
      .compile()

    controller = module.get(ShowsController)
  })

  // ---------------------------------------------------------------------------
  // GET /shows/:tvdbId
  // ---------------------------------------------------------------------------

  describe('getShow', () => {
    it('delegates to service with parsed tvdbId and returns show detail', async () => {
      const detail = makeShowDetail({ tvdbId: 2000 })
      mockService.getShow.mockResolvedValue(detail)

      const result = await controller.getShow('2000')

      expect(mockService.getShow).toHaveBeenCalledWith(2000)
      expect(result).toStrictEqual(detail)
    })

    it('throws BadRequestException for non-numeric tvdbId', async () => {
      await expect(controller.getShow('abc')).rejects.toThrow(
        BadRequestException,
      )
      expect(mockService.getShow).not.toHaveBeenCalled()
    })

    it('throws BadRequestException for zero tvdbId', async () => {
      await expect(controller.getShow('0')).rejects.toThrow(BadRequestException)
    })

    it('throws BadRequestException for negative tvdbId', async () => {
      await expect(controller.getShow('-1')).rejects.toThrow(
        BadRequestException,
      )
    })

    it('propagates NotFoundException from service when show not found', async () => {
      mockService.getShow.mockRejectedValue(
        new NotFoundException('Show not found'),
      )
      await expect(controller.getShow('9999')).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // DELETE /shows/:tvdbId/files/:episodeFileId
  // ---------------------------------------------------------------------------

  describe('deleteEpisodeFile', () => {
    it('delegates to service with parsed tvdbId and episodeFileId', async () => {
      await controller.deleteEpisodeFile('2000', '100')

      expect(mockService.deleteEpisodeFile).toHaveBeenCalledWith(2000, 100)
    })

    it('throws BadRequestException for non-numeric tvdbId', async () => {
      await expect(controller.deleteEpisodeFile('abc', '100')).rejects.toThrow(
        BadRequestException,
      )
      expect(mockService.deleteEpisodeFile).not.toHaveBeenCalled()
    })

    it('throws BadRequestException for non-numeric episodeFileId', async () => {
      await expect(controller.deleteEpisodeFile('2000', 'xyz')).rejects.toThrow(
        BadRequestException,
      )
      expect(mockService.deleteEpisodeFile).not.toHaveBeenCalled()
    })

    it('throws BadRequestException for zero episodeFileId', async () => {
      await expect(controller.deleteEpisodeFile('2000', '0')).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws BadRequestException for negative episodeFileId', async () => {
      await expect(controller.deleteEpisodeFile('2000', '-1')).rejects.toThrow(
        BadRequestException,
      )
    })

    it('propagates NotFoundException from service when file not found', async () => {
      mockService.deleteEpisodeFile.mockRejectedValue(
        new NotFoundException('Episode file not found'),
      )
      await expect(controller.deleteEpisodeFile('2000', '100')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('returns undefined on successful deletion', async () => {
      const result = await controller.deleteEpisodeFile('2000', '100')
      expect(result).toBeUndefined()
    })
  })

  // ---------------------------------------------------------------------------
  // DELETE /shows/:tvdbId/seasons/:seasonNumber/files
  // ---------------------------------------------------------------------------

  describe('deleteSeasonFiles', () => {
    it('delegates to service with parsed tvdbId and seasonNumber', async () => {
      mockService.deleteSeasonFiles.mockResolvedValue({
        deletedFileIds: [300, 301],
      })

      const result = await controller.deleteSeasonFiles('2000', '1')

      expect(mockService.deleteSeasonFiles).toHaveBeenCalledWith(2000, 1)
      expect(result.deletedFileIds).toEqual([300, 301])
    })

    it('accepts season 0 (specials)', async () => {
      await controller.deleteSeasonFiles('2000', '0')
      expect(mockService.deleteSeasonFiles).toHaveBeenCalledWith(2000, 0)
    })

    it('throws BadRequestException for non-numeric tvdbId', async () => {
      await expect(controller.deleteSeasonFiles('abc', '1')).rejects.toThrow(
        BadRequestException,
      )
      expect(mockService.deleteSeasonFiles).not.toHaveBeenCalled()
    })

    it('throws BadRequestException for non-numeric seasonNumber', async () => {
      await expect(controller.deleteSeasonFiles('2000', 'abc')).rejects.toThrow(
        BadRequestException,
      )
      expect(mockService.deleteSeasonFiles).not.toHaveBeenCalled()
    })

    it('throws BadRequestException for negative seasonNumber', async () => {
      await expect(controller.deleteSeasonFiles('2000', '-1')).rejects.toThrow(
        BadRequestException,
      )
      expect(mockService.deleteSeasonFiles).not.toHaveBeenCalled()
    })

    it('propagates NotFoundException from service when show not found', async () => {
      mockService.deleteSeasonFiles.mockRejectedValue(
        new NotFoundException('Show not found'),
      )
      await expect(controller.deleteSeasonFiles('9999', '1')).rejects.toThrow(
        NotFoundException,
      )
    })

    it('returns empty deletedFileIds when season has no files', async () => {
      mockService.deleteSeasonFiles.mockResolvedValue({ deletedFileIds: [] })

      const result = await controller.deleteSeasonFiles('2000', '1')

      expect(result.deletedFileIds).toEqual([])
    })
  })
})
