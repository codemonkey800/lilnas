import type { EpisodeFileResource, EpisodeResource } from '@lilnas/media/sonarr'

import {
  type EpisodeFileReader,
  resolveEpisodeFileIds,
} from 'src/media/episode-files.util'

// A stub rather than a mocked SonarrService: `EpisodeFileReader` is exactly
// the two reads this function makes, so there is nothing else to provide.
function stubSonarr(overrides: {
  episodeFiles?: EpisodeFileResource[]
  episodes?: EpisodeResource[]
}) {
  const getEpisodeFiles = jest.fn(async () => overrides.episodeFiles ?? [])
  const getEpisodes = jest.fn(async () => overrides.episodes ?? [])

  return {
    getEpisodeFiles,
    getEpisodes,
    reader: { getEpisodeFiles, getEpisodes } as unknown as EpisodeFileReader,
  }
}

describe('resolveEpisodeFileIds', () => {
  describe('an episode scope', () => {
    it('resolves the file the episode points at', async () => {
      const sonarr = stubSonarr({
        episodes: [
          { episodeFileId: 991, id: 4412, seasonNumber: 3 },
          { episodeFileId: 992, id: 4413, seasonNumber: 3 },
        ],
      })

      await expect(
        resolveEpisodeFileIds(sonarr.reader, 9, {
          episodeId: 4413,
          seasonNumber: 3,
        }),
      ).resolves.toEqual([992])

      // Episode-first, because Sonarr's file list carries no episode id.
      expect(sonarr.getEpisodes).toHaveBeenCalledWith(9, { seasonNumber: 3 })
      expect(sonarr.getEpisodeFiles).not.toHaveBeenCalled()
    })

    // Success, not an error: the caller asked for a state that already holds.
    it('returns [] for an episode whose episodeFileId is Sonarr’s 0', async () => {
      const sonarr = stubSonarr({
        episodes: [{ episodeFileId: 0, id: 4412, seasonNumber: 3 }],
      })

      await expect(
        resolveEpisodeFileIds(sonarr.reader, 9, { episodeId: 4412 }),
      ).resolves.toEqual([])
    })

    it('returns [] for an episode with no episodeFileId at all', async () => {
      const sonarr = stubSonarr({ episodes: [{ id: 4412, seasonNumber: 3 }] })

      await expect(
        resolveEpisodeFileIds(sonarr.reader, 9, { episodeId: 4412 }),
      ).resolves.toEqual([])
    })

    it('returns [] when the episode id matches nothing', async () => {
      const sonarr = stubSonarr({
        episodes: [{ episodeFileId: 991, id: 4412, seasonNumber: 3 }],
      })

      await expect(
        resolveEpisodeFileIds(sonarr.reader, 9, { episodeId: 9999 }),
      ).resolves.toEqual([])
    })

    it('passes no season filter when the scope names only an episode', async () => {
      const sonarr = stubSonarr({ episodes: [] })

      await resolveEpisodeFileIds(sonarr.reader, 9, { episodeId: 4412 })

      expect(sonarr.getEpisodes).toHaveBeenCalledWith(9, {
        seasonNumber: undefined,
      })
    })
  })

  describe('a season scope', () => {
    const files: EpisodeFileResource[] = [
      { id: 1, seasonNumber: 1 },
      { id: 2, seasonNumber: 3 },
      { id: 3, seasonNumber: 3 },
    ]

    it('narrows the file list to that season client-side', async () => {
      const sonarr = stubSonarr({ episodeFiles: files })

      await expect(
        resolveEpisodeFileIds(sonarr.reader, 9, { seasonNumber: 3 }),
      ).resolves.toEqual([2, 3])

      // Sonarr's episode-file endpoint has no season filter of its own.
      expect(sonarr.getEpisodeFiles).toHaveBeenCalledWith(9)
      expect(sonarr.getEpisodes).not.toHaveBeenCalled()
    })

    it('returns [] for a season with no files', async () => {
      const sonarr = stubSonarr({ episodeFiles: files })

      await expect(
        resolveEpisodeFileIds(sonarr.reader, 9, { seasonNumber: 4 }),
      ).resolves.toEqual([])
    })

    // Season 0 is specials - a truthiness check would widen this to the
    // whole series and delete far more than was asked for.
    it('treats season 0 as a real filter, not as "no season"', async () => {
      const sonarr = stubSonarr({
        episodeFiles: [
          { id: 1, seasonNumber: 0 },
          { id: 2, seasonNumber: 1 },
        ],
      })

      await expect(
        resolveEpisodeFileIds(sonarr.reader, 9, { seasonNumber: 0 }),
      ).resolves.toEqual([1])
    })
  })

  describe('no scope', () => {
    it('resolves every file id for the series', async () => {
      const sonarr = stubSonarr({
        episodeFiles: [
          { id: 1, seasonNumber: 1 },
          { id: 2, seasonNumber: 3 },
        ],
      })

      await expect(
        resolveEpisodeFileIds(sonarr.reader, 9, {}),
      ).resolves.toEqual([1, 2])
    })

    it('drops files Sonarr returned without an id', async () => {
      const sonarr = stubSonarr({
        episodeFiles: [{ seasonNumber: 1 }, { id: 2, seasonNumber: 1 }],
      })

      await expect(
        resolveEpisodeFileIds(sonarr.reader, 9, {}),
      ).resolves.toEqual([2])
    })

    it('returns [] for a series with no files at all', async () => {
      const sonarr = stubSonarr({ episodeFiles: [] })

      await expect(
        resolveEpisodeFileIds(sonarr.reader, 9, {}),
      ).resolves.toEqual([])
    })
  })
})
