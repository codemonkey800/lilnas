import {
  deleteApiV3EpisodefileBulk,
  deleteApiV3EpisodefileById,
  getApiV3Episode,
  getApiV3Episodefile,
  getApiV3SeriesLookup,
} from '@lilnas/media/sonarr'
import { NotFoundException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { SONARR_CLIENT } from 'src/media/clients'
import { ShowsService } from 'src/shows/shows.service'

const mockGetApiV3SeriesLookup = getApiV3SeriesLookup as jest.MockedFunction<
  typeof getApiV3SeriesLookup
>
const mockGetApiV3Episodefile = getApiV3Episodefile as jest.MockedFunction<
  typeof getApiV3Episodefile
>
const mockGetApiV3Episode = getApiV3Episode as jest.MockedFunction<
  typeof getApiV3Episode
>
const mockDeleteApiV3EpisodefileBulk =
  deleteApiV3EpisodefileBulk as jest.MockedFunction<
    typeof deleteApiV3EpisodefileBulk
  >
const mockDeleteApiV3EpisodefileById =
  deleteApiV3EpisodefileById as jest.MockedFunction<
    typeof deleteApiV3EpisodefileById
  >

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function apiOk<T>(data: T): any {
  return { data }
}

function makeSeries(overrides = {}) {
  return {
    id: 10,
    tvdbId: 2000,
    title: 'Test Show',
    ...overrides,
  }
}

function makeFile(overrides = {}) {
  return {
    id: 100,
    seriesId: 10,
    seasonNumber: 1,
    relativePath: 'S01E01.mkv',
    size: 5_000_000_000,
    ...overrides,
  }
}

function makeEpisode(overrides = {}) {
  return {
    id: 1,
    seriesId: 10,
    seasonNumber: 1,
    episodeNumber: 1,
    hasFile: true,
    monitored: true,
    episodeFileId: 100,
    ...overrides,
  }
}

describe('ShowsService', () => {
  let service: ShowsService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ShowsService, { provide: SONARR_CLIENT, useValue: {} }],
    }).compile()

    service = module.get(ShowsService)
    mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([makeSeries()]))
  })

  // ---------------------------------------------------------------------------
  // getShow
  // ---------------------------------------------------------------------------

  describe('getShow', () => {
    it('returns show detail with seasons and episodes', async () => {
      const series = {
        ...makeSeries(),
        seasons: [{ seasonNumber: 1, monitored: true }],
      }
      mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([series]))
      mockGetApiV3Episode.mockResolvedValue(
        apiOk([makeEpisode({ id: 1, episodeFileId: 100 })]),
      )
      mockGetApiV3Episodefile.mockResolvedValue(apiOk([makeFile({ id: 100 })]))

      const result = await service.getShow(2000)

      expect(result.tvdbId).toBe(2000)
      expect(result.title).toBe('Test Show')
      expect(result.seasons).toHaveLength(1)
      expect(result.seasons[0]?.episodes).toHaveLength(1)
    })

    it('throws NotFoundException when show not found in Sonarr', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([]))

      await expect(service.getShow(9999)).rejects.toThrow(NotFoundException)
    })

    it('throws NotFoundException when series has no id', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue(
        apiOk([{ ...makeSeries(), id: undefined }]),
      )

      await expect(service.getShow(2000)).rejects.toThrow(NotFoundException)
    })

    it('returns empty seasons when series has no seasons', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue(
        apiOk([{ ...makeSeries(), seasons: [] }]),
      )
      mockGetApiV3Episode.mockResolvedValue(apiOk([]))
      mockGetApiV3Episodefile.mockResolvedValue(apiOk([]))

      const result = await service.getShow(2000)

      expect(result.seasons).toEqual([])
    })

    it('excludes season 0 (specials) from seasons list', async () => {
      const series = {
        ...makeSeries(),
        seasons: [
          { seasonNumber: 0, monitored: false },
          { seasonNumber: 1, monitored: true },
        ],
      }
      mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([series]))
      mockGetApiV3Episode.mockResolvedValue(apiOk([makeEpisode()]))
      mockGetApiV3Episodefile.mockResolvedValue(apiOk([]))

      const result = await service.getShow(2000)

      expect(result.seasons.every(s => s.seasonNumber > 0)).toBe(true)
    })

    it('attaches file quality and size to episodes that have a file', async () => {
      const series = {
        ...makeSeries(),
        seasons: [{ seasonNumber: 1, monitored: true }],
      }
      mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([series]))
      mockGetApiV3Episode.mockResolvedValue(
        apiOk([makeEpisode({ id: 1, episodeFileId: 100 })]),
      )
      mockGetApiV3Episodefile.mockResolvedValue(
        apiOk([
          makeFile({
            id: 100,
            size: 1_500_000_000,
            quality: { quality: { name: 'HDTV-1080p' } },
          }),
        ]),
      )

      const result = await service.getShow(2000)

      const ep = result.seasons[0]?.episodes[0]
      expect(ep?.fileSize).toBe(1_500_000_000)
      expect(ep?.quality).toBe('HDTV-1080p')
    })
  })

  // ---------------------------------------------------------------------------
  // deleteEpisodeFile
  // ---------------------------------------------------------------------------

  describe('deleteEpisodeFile', () => {
    it('deletes the episode file when episodeFileId belongs to the series', async () => {
      mockGetApiV3Episodefile.mockResolvedValue(apiOk([makeFile({ id: 100 })]))
      mockDeleteApiV3EpisodefileById.mockResolvedValue(apiOk(undefined))

      await expect(
        service.deleteEpisodeFile(2000, 100),
      ).resolves.toBeUndefined()

      expect(mockDeleteApiV3EpisodefileById).toHaveBeenCalledWith(
        expect.objectContaining({ path: { id: 100 } }),
      )
    })

    it('throws NotFoundException when show not found in Sonarr', async () => {
      mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([]))

      await expect(service.deleteEpisodeFile(9999, 100)).rejects.toThrow(
        NotFoundException,
      )
      expect(mockGetApiV3Episodefile).not.toHaveBeenCalled()
    })

    it('throws NotFoundException (IDOR guard) when fileId does not belong to this series', async () => {
      // Series only has file id=100; caller tries to delete file id=999
      mockGetApiV3Episodefile.mockResolvedValue(apiOk([makeFile({ id: 100 })]))

      await expect(service.deleteEpisodeFile(2000, 999)).rejects.toThrow(
        NotFoundException,
      )
      expect(mockDeleteApiV3EpisodefileById).not.toHaveBeenCalled()
    })

    it('throws NotFoundException when series has no episode files', async () => {
      mockGetApiV3Episodefile.mockResolvedValue(apiOk([]))

      await expect(service.deleteEpisodeFile(2000, 100)).rejects.toThrow(
        NotFoundException,
      )
      expect(mockDeleteApiV3EpisodefileById).not.toHaveBeenCalled()
    })

    it('throws NotFoundException and logs when delete API call fails', async () => {
      mockGetApiV3Episodefile.mockResolvedValue(apiOk([makeFile({ id: 100 })]))
      mockDeleteApiV3EpisodefileById.mockRejectedValue(
        new Error('Sonarr unavailable'),
      )

      await expect(service.deleteEpisodeFile(2000, 100)).rejects.toThrow(
        NotFoundException,
      )
    })

    it('does not expose upstream error message in the thrown exception', async () => {
      mockGetApiV3Episodefile.mockResolvedValue(apiOk([makeFile({ id: 100 })]))
      mockDeleteApiV3EpisodefileById.mockRejectedValue(
        new Error('Sonarr internal error'),
      )

      await service.deleteEpisodeFile(2000, 100).catch(err => {
        expect((err as Error).message).not.toContain('Sonarr internal error')
      })
    })
  })
})

describe('ShowsService.deleteSeasonFiles', () => {
  let service: ShowsService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ShowsService, { provide: SONARR_CLIENT, useValue: {} }],
    }).compile()

    service = module.get(ShowsService)
    mockDeleteApiV3EpisodefileBulk.mockResolvedValue(apiOk({}))
    mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([makeSeries()]))
  })

  it('calls bulk delete with the correct file IDs for the season', async () => {
    // getApiV3Episodefile returns ALL series files (season 1 and 2)
    mockGetApiV3Episodefile.mockResolvedValue(
      apiOk([
        makeFile({ id: 100, seasonNumber: 1 }),
        makeFile({ id: 101, seasonNumber: 2 }),
      ]),
    )
    // getApiV3Episode is called with seasonNumber filter -- Sonarr returns only season 1 episodes
    mockGetApiV3Episode.mockResolvedValue(
      apiOk([makeEpisode({ id: 1, episodeFileId: 100 })]),
    )

    const result = await service.deleteSeasonFiles(2000, 1)

    // Only season 1 file (id=100) should be deleted; season 2 file not referenced by season 1 episodes
    expect(mockDeleteApiV3EpisodefileBulk).toHaveBeenCalledWith(
      expect.objectContaining({ body: { episodeFileIds: [100] } }),
    )
    expect(result.deletedFileIds).toEqual([100])
  })

  it('returns empty deletedFileIds and does not call bulk delete when season has no files', async () => {
    mockGetApiV3Episodefile.mockResolvedValue(apiOk([]))
    mockGetApiV3Episode.mockResolvedValue(
      apiOk([makeEpisode({ episodeFileId: undefined })]),
    )

    const result = await service.deleteSeasonFiles(2000, 1)

    expect(mockDeleteApiV3EpisodefileBulk).not.toHaveBeenCalled()
    expect(result.deletedFileIds).toEqual([])
  })

  it('skips episodes without an episodeFileId when computing the file set', async () => {
    // Files exist but episodes don't reference them (episodeFileId is null)
    mockGetApiV3Episodefile.mockResolvedValue(apiOk([makeFile({ id: 200 })]))
    mockGetApiV3Episode.mockResolvedValue(
      apiOk([makeEpisode({ id: 1, episodeFileId: undefined })]),
    )

    const result = await service.deleteSeasonFiles(2000, 1)

    expect(mockDeleteApiV3EpisodefileBulk).not.toHaveBeenCalled()
    expect(result.deletedFileIds).toEqual([])
  })

  it('does not delete files from other seasons even if they exist on disk', async () => {
    // Series has files for season 1 and 2; we only delete season 2
    mockGetApiV3Episodefile.mockResolvedValue(
      apiOk([
        makeFile({ id: 300, seasonNumber: 1 }),
        makeFile({ id: 301, seasonNumber: 2 }),
      ]),
    )
    mockGetApiV3Episode.mockResolvedValue(
      apiOk([makeEpisode({ id: 5, seasonNumber: 2, episodeFileId: 301 })]),
    )

    const result = await service.deleteSeasonFiles(2000, 2)

    expect(mockDeleteApiV3EpisodefileBulk).toHaveBeenCalledWith(
      expect.objectContaining({ body: { episodeFileIds: [301] } }),
    )
    expect(result.deletedFileIds).toEqual([301])
  })

  it('handles multiple episodes with files in the same season', async () => {
    mockGetApiV3Episodefile.mockResolvedValue(
      apiOk([
        makeFile({ id: 400 }),
        makeFile({ id: 401 }),
        makeFile({ id: 402 }),
      ]),
    )
    mockGetApiV3Episode.mockResolvedValue(
      apiOk([
        makeEpisode({ id: 10, episodeFileId: 400 }),
        makeEpisode({ id: 11, episodeFileId: 401, episodeNumber: 2 }),
        makeEpisode({ id: 12, episodeFileId: 402, episodeNumber: 3 }),
      ]),
    )

    const result = await service.deleteSeasonFiles(2000, 1)

    const calledIds = (
      mockDeleteApiV3EpisodefileBulk.mock.calls[0]?.[0] as {
        body: { episodeFileIds: number[] }
      }
    )?.body?.episodeFileIds
    expect(calledIds).toHaveLength(3)
    expect(calledIds).toEqual(expect.arrayContaining([400, 401, 402]))
    expect(result.deletedFileIds).toHaveLength(3)
  })

  it('throws NotFoundException when show not found in Sonarr', async () => {
    mockGetApiV3SeriesLookup.mockResolvedValue(apiOk([]))

    await expect(service.deleteSeasonFiles(9999, 1)).rejects.toThrow(
      'Show with tvdbId 9999 not found in Sonarr library',
    )
    expect(mockDeleteApiV3EpisodefileBulk).not.toHaveBeenCalled()
  })
})
