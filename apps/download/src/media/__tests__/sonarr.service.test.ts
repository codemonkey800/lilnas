import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

// Mock SDK module BEFORE any imports that reference it
jest.mock('@lilnas/media/sonarr', () => ({
  deleteApiV3QueueById: jest.fn(),
  deleteApiV3SeriesById: jest.fn(),
  getApiV3Qualityprofile: jest.fn(),
  getApiV3Queue: jest.fn(),
  getApiV3Rootfolder: jest.fn(),
  getApiV3Series: jest.fn(),
  getApiV3SeriesLookup: jest.fn(),
  postApiV3Command: jest.fn(),
  postApiV3Series: jest.fn(),
}))

import {
  deleteApiV3QueueById,
  deleteApiV3SeriesById,
  getApiV3Qualityprofile,
  getApiV3Queue,
  getApiV3Rootfolder,
  getApiV3Series,
  getApiV3SeriesLookup,
  postApiV3Command,
  postApiV3Series,
} from '@lilnas/media/sonarr'

import { SONARR_CLIENT } from 'src/media/clients'
import { SonarrService } from 'src/media/sonarr.service'

const mockGetApiV3SeriesLookup = getApiV3SeriesLookup as jest.Mock
const mockGetApiV3Qualityprofile = getApiV3Qualityprofile as jest.Mock
const mockGetApiV3Rootfolder = getApiV3Rootfolder as jest.Mock
const mockPostApiV3Series = postApiV3Series as jest.Mock
const mockPostApiV3Command = postApiV3Command as jest.Mock
const mockGetApiV3Series = getApiV3Series as jest.Mock
const mockDeleteApiV3SeriesById = deleteApiV3SeriesById as jest.Mock
const mockGetApiV3Queue = getApiV3Queue as jest.Mock
const mockDeleteApiV3QueueById = deleteApiV3QueueById as jest.Mock

describe('SonarrService', () => {
  let service: SonarrService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SonarrService, { provide: SONARR_CLIENT, useValue: {} }],
    }).compile()

    service = module.get<SonarrService>(SonarrService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  describe('search', () => {
    it('maps lookup results to ShowSearchResult', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          {
            tvdbId: 456,
            title: 'Some Show',
            year: 2019,
            overview: 'A show',
            images: [{ coverType: 'poster', url: 'poster.jpg' }],
          },
        ],
      })

      const result = await service.search('some show')

      expect(getApiV3SeriesLookup).toHaveBeenCalledWith(
        expect.objectContaining({ query: { term: 'some show' } }),
      )
      expect(result).toEqual([
        {
          overview: 'A show',
          posterUrl: 'poster.jpg',
          title: 'Some Show',
          tvdbId: 456,
          year: 2019,
        },
      ])
    })

    it('throws a descriptive error when the SDK call fails', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue({
        error: { message: 'boom' },
        response: { status: 500 },
      })

      await expect(service.search('x')).rejects.toThrow('searchShows failed')
    })
  })

  describe('requestShow', () => {
    it('triggers a search directly when the series is already in the library', async () => {
      mockGetApiV3Series.mockResolvedValue({
        data: [{ id: 9, tvdbId: 456, title: 'Existing Show', images: [] }],
      })
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      const result = await service.requestShow(456)

      expect(postApiV3Series).not.toHaveBeenCalled()
      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'SeriesSearch', seriesId: 9 },
        }),
      )
      expect(result).toEqual({
        posterUrl: undefined,
        sonarrId: 9,
        title: 'Existing Show',
      })
    })

    it('looks up, adds, and triggers a search for a new series', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [
          { tvdbId: 456, title: 'New Show', titleSlug: 'new-show' },
          { tvdbId: 999, title: 'Different Show', titleSlug: 'different' },
        ],
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [{ id: 2, name: 'Any' }],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/tv', accessible: true }],
      })
      mockPostApiV3Series.mockResolvedValue({
        data: {
          id: 77,
          tvdbId: 456,
          title: 'New Show',
          images: [{ coverType: 'poster', remoteUrl: 'remote-poster.jpg' }],
        },
      })
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      const result = await service.requestShow(456)

      expect(postApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            tvdbId: 456,
            title: 'New Show',
            titleSlug: 'new-show',
            qualityProfileId: 2,
            rootFolderPath: '/tv',
            monitored: true,
          }),
        }),
      )
      expect(postApiV3Command).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'SeriesSearch', seriesId: 77 },
        }),
      )
      expect(result).toEqual({
        posterUrl: 'remote-poster.jpg',
        sonarrId: 77,
        title: 'New Show',
      })
    })

    it('throws when the series cannot be found in Sonarr search results', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      mockGetApiV3SeriesLookup.mockResolvedValue({ data: [] })

      await expect(service.requestShow(456)).rejects.toThrow(
        'Series with TVDB ID 456 not found',
      )
    })

    it('prefers the "Any" quality profile when one exists', async () => {
      mockGetApiV3Series.mockResolvedValue({ data: [] })
      mockGetApiV3SeriesLookup.mockResolvedValue({
        data: [{ tvdbId: 456, title: 'New Show' }],
      })
      mockGetApiV3Qualityprofile.mockResolvedValue({
        data: [
          { id: 1, name: 'HD-1080p' },
          { id: 2, name: 'Any' },
        ],
      })
      mockGetApiV3Rootfolder.mockResolvedValue({
        data: [{ id: 1, path: '/tv', accessible: true }],
      })
      mockPostApiV3Series.mockResolvedValue({
        data: { id: 77, tvdbId: 456, title: 'New Show', images: [] },
      })
      mockPostApiV3Command.mockResolvedValue({ data: { id: 1 } })

      await service.requestShow(456)

      expect(postApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ qualityProfileId: 2 }),
        }),
      )
    })
  })

  describe('getQueue', () => {
    it('returns queue records, filtered by seriesIds when provided', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: { records: [{ id: 1, seriesId: 9, status: 'downloading' }] },
      })

      const result = await service.getQueue([9])

      expect(getApiV3Queue).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ seriesIds: [9] }),
        }),
      )
      expect(result).toEqual([{ id: 1, seriesId: 9, status: 'downloading' }])
    })

    it('returns an empty array when the queue has no records', async () => {
      mockGetApiV3Queue.mockResolvedValue({ data: {} })

      const result = await service.getQueue()

      expect(result).toEqual([])
    })
  })

  describe('unmonitorAndDelete', () => {
    it('cancels in-progress queue items then deletes the series', async () => {
      mockGetApiV3Queue.mockResolvedValue({
        data: { records: [{ id: 1 }, { id: 2 }] },
      })
      mockDeleteApiV3QueueById.mockResolvedValue({ data: undefined })
      mockDeleteApiV3SeriesById.mockResolvedValue({ data: undefined })

      await service.unmonitorAndDelete(9, true)

      expect(deleteApiV3QueueById).toHaveBeenCalledTimes(2)
      expect(deleteApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 9 },
          query: { deleteFiles: true, addImportListExclusion: false },
        }),
      )
    })

    it('throws when the delete call itself fails', async () => {
      mockGetApiV3Queue.mockResolvedValue({ data: { records: [] } })
      mockDeleteApiV3SeriesById.mockResolvedValue({
        error: { message: 'not found' },
        response: { status: 404 },
      })

      await expect(service.unmonitorAndDelete(9)).rejects.toThrow(
        'deleteSeries failed',
      )
    })
  })
})
