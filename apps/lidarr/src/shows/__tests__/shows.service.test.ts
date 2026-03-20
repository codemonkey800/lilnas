import {
  deleteApiV3EpisodefileBulk,
  getApiV3Episode,
  getApiV3Episodefile,
} from '@lilnas/media/sonarr'
import { Test, TestingModule } from '@nestjs/testing'

import { SONARR_CLIENT } from 'src/media/clients'
import { ShowsService } from 'src/shows/shows.service'

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

describe('ShowsService.deleteSeasonFiles', () => {
  let service: ShowsService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ShowsService, { provide: SONARR_CLIENT, useValue: {} }],
    }).compile()

    service = module.get(ShowsService)
    mockDeleteApiV3EpisodefileBulk.mockResolvedValue({} as never)
  })

  it('calls bulk delete with the correct file IDs for the season', async () => {
    // getApiV3Episodefile returns ALL series files (season 1 and 2)
    mockGetApiV3Episodefile.mockResolvedValue({
      data: [
        makeFile({ id: 100, seasonNumber: 1 }),
        makeFile({ id: 101, seasonNumber: 2 }),
      ],
    } as never)
    // getApiV3Episode is called with seasonNumber filter -- Sonarr returns only season 1 episodes
    mockGetApiV3Episode.mockResolvedValue({
      data: [makeEpisode({ id: 1, episodeFileId: 100 })],
    } as never)

    const result = await service.deleteSeasonFiles(2000, 1, 10)

    // Only season 1 file (id=100) should be deleted; season 2 file not referenced by season 1 episodes
    expect(mockDeleteApiV3EpisodefileBulk).toHaveBeenCalledWith(
      expect.objectContaining({ body: { episodeFileIds: [100] } }),
    )
    expect(result.deletedFileIds).toEqual([100])
  })

  it('returns empty deletedFileIds and does not call bulk delete when season has no files', async () => {
    mockGetApiV3Episodefile.mockResolvedValue({ data: [] } as never)
    mockGetApiV3Episode.mockResolvedValue({
      data: [makeEpisode({ episodeFileId: undefined })],
    } as never)

    const result = await service.deleteSeasonFiles(2000, 1, 10)

    expect(mockDeleteApiV3EpisodefileBulk).not.toHaveBeenCalled()
    expect(result.deletedFileIds).toEqual([])
  })

  it('skips episodes without an episodeFileId when computing the file set', async () => {
    // Files exist but episodes don't reference them (episodeFileId is null)
    mockGetApiV3Episodefile.mockResolvedValue({
      data: [makeFile({ id: 200 })],
    } as never)
    mockGetApiV3Episode.mockResolvedValue({
      data: [makeEpisode({ id: 1, episodeFileId: undefined })],
    } as never)

    const result = await service.deleteSeasonFiles(2000, 1, 10)

    expect(mockDeleteApiV3EpisodefileBulk).not.toHaveBeenCalled()
    expect(result.deletedFileIds).toEqual([])
  })

  it('does not delete files from other seasons even if they exist on disk', async () => {
    // Series has files for season 1 and 2; we only delete season 2
    mockGetApiV3Episodefile.mockResolvedValue({
      data: [
        makeFile({ id: 300, seasonNumber: 1 }),
        makeFile({ id: 301, seasonNumber: 2 }),
      ],
    } as never)
    mockGetApiV3Episode.mockResolvedValue({
      data: [makeEpisode({ id: 5, seasonNumber: 2, episodeFileId: 301 })],
    } as never)

    const result = await service.deleteSeasonFiles(2000, 2, 10)

    expect(mockDeleteApiV3EpisodefileBulk).toHaveBeenCalledWith(
      expect.objectContaining({ body: { episodeFileIds: [301] } }),
    )
    expect(result.deletedFileIds).toEqual([301])
  })

  it('handles multiple episodes with files in the same season', async () => {
    mockGetApiV3Episodefile.mockResolvedValue({
      data: [
        makeFile({ id: 400 }),
        makeFile({ id: 401 }),
        makeFile({ id: 402 }),
      ],
    } as never)
    mockGetApiV3Episode.mockResolvedValue({
      data: [
        makeEpisode({ id: 10, episodeFileId: 400 }),
        makeEpisode({ id: 11, episodeFileId: 401, episodeNumber: 2 }),
        makeEpisode({ id: 12, episodeFileId: 402, episodeNumber: 3 }),
      ],
    } as never)

    const result = await service.deleteSeasonFiles(2000, 1, 10)

    const calledIds = (
      mockDeleteApiV3EpisodefileBulk.mock.calls[0]?.[0] as {
        body: { episodeFileIds: number[] }
      }
    )?.body?.episodeFileIds
    expect(calledIds).toHaveLength(3)
    expect(calledIds).toEqual(expect.arrayContaining([400, 401, 402]))
    expect(result.deletedFileIds).toHaveLength(3)
  })
})
