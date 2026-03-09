jest.mock('@lilnas/media/sonarr', () => ({
  deleteApiV3EpisodefileBulk: jest.fn(),
  deleteApiV3EpisodefileById: jest.fn(),
  deleteApiV3QueueBulk: jest.fn(),
  deleteApiV3QueueById: jest.fn(),
  deleteApiV3SeriesById: jest.fn(),
  getApiV3Episode: jest.fn(),
  getApiV3EpisodeById: jest.fn(),
  getApiV3Qualityprofile: jest.fn(),
  getApiV3QueueDetails: jest.fn(),
  getApiV3Rootfolder: jest.fn(),
  getApiV3SeriesLookup: jest.fn(),
  postApiV3Release: jest.fn(),
  postApiV3Series: jest.fn(),
  putApiV3EpisodeById: jest.fn(),
  putApiV3EpisodeMonitor: jest.fn(),
}))

jest.mock('src/media/shows.server', () => ({
  getShow: jest.fn(),
}))

jest.mock('src/media/shows', () => ({
  searchShowReleases: jest.fn(),
}))

import {
  deleteApiV3EpisodefileBulk,
  deleteApiV3EpisodefileById,
  deleteApiV3QueueBulk,
  deleteApiV3QueueById,
  deleteApiV3SeriesById,
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
} from '@lilnas/media/sonarr'
import { BadRequestException, NotFoundException } from '@nestjs/common'

import { clearAllShowSearchResults } from 'src/media/search-results'
import { searchShowReleases } from 'src/media/shows'
import { getShow } from 'src/media/shows.server'
import { ShowsService } from 'src/media/shows.service'

describe('ShowsService', () => {
  let service: ShowsService

  beforeEach(() => {
    service = new ShowsService()
    ;(getShow as jest.Mock).mockResolvedValue({
      id: 20,
      tvdbId: 789,
      title: 'Test Show',
    })
    ;(searchShowReleases as jest.Mock).mockResolvedValue([
      { guid: 'xyz', title: 'Episode Release' },
    ])
    ;(deleteApiV3QueueById as jest.Mock).mockResolvedValue({})
    ;(getApiV3QueueDetails as jest.Mock).mockResolvedValue({ data: [] })
    ;(deleteApiV3QueueBulk as jest.Mock).mockResolvedValue({})
    ;(putApiV3EpisodeMonitor as jest.Mock).mockResolvedValue({})
    ;(getApiV3Episode as jest.Mock).mockResolvedValue({ data: [] })
    ;(deleteApiV3EpisodefileById as jest.Mock).mockResolvedValue({})
    ;(deleteApiV3EpisodefileBulk as jest.Mock).mockResolvedValue({})
    ;(getApiV3EpisodeById as jest.Mock).mockResolvedValue({
      data: { id: 1, monitored: true, seasonNumber: 1, episodeNumber: 1 },
    })
    ;(putApiV3EpisodeById as jest.Mock).mockResolvedValue({})
    ;(postApiV3Release as jest.Mock).mockResolvedValue({})
    ;(getApiV3SeriesLookup as jest.Mock).mockResolvedValue({
      data: [{ id: 20, tvdbId: 789 }],
    })
    ;(getApiV3Rootfolder as jest.Mock).mockResolvedValue({
      data: [{ path: '/shows' }],
    })
    ;(getApiV3Qualityprofile as jest.Mock).mockResolvedValue({
      data: [{ id: 1 }],
    })
    ;(postApiV3Series as jest.Mock).mockResolvedValue({ data: { id: 20 } })
    ;(deleteApiV3SeriesById as jest.Mock).mockResolvedValue({})
  })

  // ---------------------------------------------------------------------------
  // getShow
  // ---------------------------------------------------------------------------

  describe('getShow', () => {
    it('returns the show detail from the server', async () => {
      const show = { id: 20, tvdbId: 789, title: 'Test Show' }
      ;(getShow as jest.Mock).mockResolvedValue(show)
      const result = await service.getShow(789)
      expect(result).toEqual(show)
    })

    it('throws NotFoundException when getShow throws', async () => {
      ;(getShow as jest.Mock).mockRejectedValue(new Error('Not found'))
      await expect(service.getShow(999)).rejects.toThrow(NotFoundException)
    })
  })

  // ---------------------------------------------------------------------------
  // cancelQueueItem
  // ---------------------------------------------------------------------------

  describe('cancelQueueItem', () => {
    it('calls deleteApiV3QueueById with removeFromClient=true', async () => {
      await service.cancelQueueItem(789, 50)
      expect(deleteApiV3QueueById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 50 },
          query: { removeFromClient: true, blocklist: false },
        }),
      )
    })

    it('throws NotFoundException on API error', async () => {
      ;(deleteApiV3QueueById as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      )
      await expect(service.cancelQueueItem(789, 50)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // cancelAllQueueItems
  // ---------------------------------------------------------------------------

  describe('cancelAllQueueItems', () => {
    it('returns empty array when no active queue items', async () => {
      ;(getApiV3QueueDetails as jest.Mock).mockResolvedValue({ data: [] })
      const result = await service.cancelAllQueueItems(789, 20)
      expect(result.cancelledEpisodeIds).toEqual([])
    })

    it('bulk deletes active queue items and unmonitors episodes', async () => {
      ;(getApiV3QueueDetails as jest.Mock).mockResolvedValue({
        data: [
          { id: 50, episodeId: 1 },
          { id: 51, episodeId: 2 },
        ],
      })
      await service.cancelAllQueueItems(789, 20)
      expect(deleteApiV3QueueBulk).toHaveBeenCalledWith(
        expect.objectContaining({ body: { ids: [50, 51] } }),
      )
      expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            episodeIds: [1, 2],
            monitored: false,
          }),
        }),
      )
    })

    it('returns the cancelled episode IDs', async () => {
      ;(getApiV3QueueDetails as jest.Mock).mockResolvedValue({
        data: [
          { id: 50, episodeId: 1 },
          { id: 51, episodeId: 2 },
        ],
      })
      const result = await service.cancelAllQueueItems(789, 20)
      expect(result.cancelledEpisodeIds).toEqual([1, 2])
    })

    it('skips items without id or episodeId', async () => {
      ;(getApiV3QueueDetails as jest.Mock).mockResolvedValue({
        data: [
          { id: null, episodeId: 1 },
          { id: 50, episodeId: null },
          { id: 51, episodeId: 2 },
        ],
      })
      const result = await service.cancelAllQueueItems(789, 20)
      expect(result.cancelledEpisodeIds).toEqual([2])
    })

    it('throws NotFoundException on API error', async () => {
      ;(getApiV3QueueDetails as jest.Mock).mockRejectedValue(
        new Error('Sonarr down'),
      )
      await expect(service.cancelAllQueueItems(789, 20)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // deleteEpisodeFile
  // ---------------------------------------------------------------------------

  describe('deleteEpisodeFile', () => {
    it('fetches episodes by fileId, unmonitors, then deletes file', async () => {
      ;(getApiV3Episode as jest.Mock).mockResolvedValue({
        data: [{ id: 1 }],
      })
      await service.deleteEpisodeFile(789, 5)
      expect(getApiV3Episode).toHaveBeenCalledWith(
        expect.objectContaining({ query: { episodeFileId: 5 } }),
      )
      expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ episodeIds: [1], monitored: false }),
        }),
      )
      expect(deleteApiV3EpisodefileById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 5 } }),
      )
    })

    it('still deletes file when no episodes returned', async () => {
      ;(getApiV3Episode as jest.Mock).mockResolvedValue({ data: [] })
      await service.deleteEpisodeFile(789, 5)
      expect(putApiV3EpisodeMonitor).not.toHaveBeenCalled()
      expect(deleteApiV3EpisodefileById).toHaveBeenCalled()
    })

    it('throws NotFoundException on API error', async () => {
      ;(getApiV3Episode as jest.Mock).mockRejectedValue(
        new Error('Sonarr error'),
      )
      await expect(service.deleteEpisodeFile(789, 5)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // deleteSeasonFiles
  // ---------------------------------------------------------------------------

  describe('deleteSeasonFiles', () => {
    it('returns early when no episode files in season', async () => {
      ;(getApiV3Episode as jest.Mock).mockResolvedValue({
        data: [{ id: 1, episodeFileId: null }],
      })
      await service.deleteSeasonFiles(789, 1, 20)
      expect(deleteApiV3EpisodefileBulk).not.toHaveBeenCalled()
    })

    it('bulk deletes episode files and unmonitors episodes', async () => {
      ;(getApiV3Episode as jest.Mock).mockResolvedValue({
        data: [
          { id: 1, episodeFileId: 10 },
          { id: 2, episodeFileId: 11 },
        ],
      })
      await service.deleteSeasonFiles(789, 1, 20)
      expect(deleteApiV3EpisodefileBulk).toHaveBeenCalledWith(
        expect.objectContaining({ body: { episodeFileIds: [10, 11] } }),
      )
      expect(putApiV3EpisodeMonitor).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            episodeIds: [1, 2],
            monitored: false,
          }),
        }),
      )
    })

    it('throws NotFoundException on API error', async () => {
      ;(getApiV3Episode as jest.Mock).mockRejectedValue(
        new Error('Sonarr error'),
      )
      await expect(service.deleteSeasonFiles(789, 1, 20)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // searchEpisodeReleases
  // ---------------------------------------------------------------------------

  describe('searchEpisodeReleases', () => {
    it('returns the list of available releases for the episode', async () => {
      const releases = [
        { guid: 'xyz', title: 'Show.S01E01.BluRay.mkv' },
        { guid: 'uvw', title: 'Show.S01E01.WEB-DL.mkv' },
      ]
      ;(searchShowReleases as jest.Mock).mockResolvedValue(releases)
      const result = await service.searchEpisodeReleases(1)
      expect(result).toEqual(releases)
    })

    it('throws NotFoundException on error', async () => {
      ;(searchShowReleases as jest.Mock).mockRejectedValue(
        new Error('Sonarr error'),
      )
      await expect(service.searchEpisodeReleases(1)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // grabRelease
  // ---------------------------------------------------------------------------

  describe('grabRelease', () => {
    it('posts release with guid and indexerId', async () => {
      await service.grabRelease(789, 'xyz-guid', 3)
      expect(postApiV3Release).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ guid: 'xyz-guid', indexerId: 3 }),
        }),
      )
    })

    it('throws NotFoundException on API error', async () => {
      ;(postApiV3Release as jest.Mock).mockRejectedValue(
        new Error('Grab failed'),
      )
      await expect(service.grabRelease(789, 'xyz', 1)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // setEpisodeMonitored
  // ---------------------------------------------------------------------------

  describe('setEpisodeMonitored', () => {
    it('fetches episode then updates monitored flag', async () => {
      await service.setEpisodeMonitored(1, false)
      expect(getApiV3EpisodeById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 1 } }),
      )
      expect(putApiV3EpisodeById).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ monitored: false }),
        }),
      )
    })

    it('throws NotFoundException on API error', async () => {
      ;(getApiV3EpisodeById as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      )
      await expect(service.setEpisodeMonitored(999, true)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // addShowToLibrary
  // ---------------------------------------------------------------------------

  describe('addShowToLibrary', () => {
    it('looks up series, root folder, and quality profile in parallel', async () => {
      await service.addShowToLibrary(789)
      expect(getApiV3SeriesLookup).toHaveBeenCalledWith(
        expect.objectContaining({ query: { term: 'tvdb:789' } }),
      )
      expect(getApiV3Rootfolder).toHaveBeenCalled()
      expect(getApiV3Qualityprofile).toHaveBeenCalled()
    })

    it('posts series with root folder and quality profile', async () => {
      await service.addShowToLibrary(789)
      expect(postApiV3Series).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            rootFolderPath: '/shows',
            qualityProfileId: 1,
            monitored: false,
          }),
        }),
      )
    })

    it('returns created series ID', async () => {
      ;(postApiV3Series as jest.Mock).mockResolvedValue({ data: { id: 42 } })
      const result = await service.addShowToLibrary(789)
      expect(result?.seriesId).toBe(42)
    })

    it('throws BadRequestException when no series found in lookup', async () => {
      ;(getApiV3SeriesLookup as jest.Mock).mockResolvedValue({ data: [] })
      await expect(service.addShowToLibrary(999)).rejects.toThrow(
        BadRequestException,
      )
    })

    it('throws NotFoundException on generic API error', async () => {
      ;(postApiV3Series as jest.Mock).mockRejectedValue(
        new Error('Network error'),
      )
      await expect(service.addShowToLibrary(789)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // removeShowFromLibrary
  // ---------------------------------------------------------------------------

  describe('removeShowFromLibrary', () => {
    it('deletes series by id with deleteFiles=true and clears search results', async () => {
      await service.removeShowFromLibrary(20, 789)
      expect(deleteApiV3SeriesById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: 20 },
          query: { deleteFiles: true, addImportListExclusion: false },
        }),
      )
      expect(clearAllShowSearchResults).toHaveBeenCalledWith(789)
    })

    it('throws NotFoundException on API error', async () => {
      ;(deleteApiV3SeriesById as jest.Mock).mockRejectedValue(
        new Error('Not found'),
      )
      await expect(service.removeShowFromLibrary(20, 789)).rejects.toThrow(
        NotFoundException,
      )
    })
  })

  // ---------------------------------------------------------------------------
  // deleteSeasonFiles – mixed episodeFileId
  // ---------------------------------------------------------------------------

  describe('deleteSeasonFiles with mixed episodeFileIds', () => {
    it('only deletes episodes that have episodeFileIds', async () => {
      ;(getApiV3Episode as jest.Mock).mockResolvedValue({
        data: [
          { id: 1, episodeFileId: 10 },
          { id: 2, episodeFileId: null },
          { id: 3, episodeFileId: 12 },
        ],
      })
      await service.deleteSeasonFiles(789, 1, 20)
      expect(deleteApiV3EpisodefileBulk).toHaveBeenCalledWith(
        expect.objectContaining({ body: { episodeFileIds: [10, 12] } }),
      )
    })
  })
})
