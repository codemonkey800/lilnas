import type {
  ManualImportCandidate,
  ShowScope,
} from '@lilnas/utils/download/types'

import {
  isInShowScope,
  type RadarrManualImportResource,
  type SonarrManualImportResource,
  toMovieCandidate,
  toShowCandidates,
  UNPARSED_EPISODES_REASON,
} from 'src/media/manual-import-mapper.util'

/**
 * The real Radarr candidate behind this feature, read from the live queue on
 * 2026-09-21: movie 434 (*Game Night*, tmdb 445571), finished, never
 * imported, one `permanent` rejection explaining why the automatic import
 * gave up. Trimmed only where the full `MovieResource` would add noise.
 */
const gameNight: RadarrManualImportResource = {
  customFormatScore: 0,
  customFormats: [],
  downloadId: 'ce427a39-be9f-4271-b193-f7067dd82c4a',
  folderName: 'Game.Night.2018.1080p.BluRay.x265',
  id: 26454175,
  indexerFlags: 0,
  languages: [{ id: 1, name: 'English' }],
  movie: { id: 434, title: 'Game Night' },
  movieFileId: null,
  name: 'Game.Night.2018.1080p.BluRay.x265',
  path: '/downloads/Game.Night.2018.1080p.BluRay.x265/Game.Night.2018.1080p.BluRay.x265.mp4',
  quality: {
    quality: {
      id: 7,
      modifier: 'none',
      name: 'Bluray-1080p',
      resolution: 1080,
      source: 'bluray',
    },
    revision: { isRepack: false, real: 0, version: 1 },
  },
  qualityWeight: 20,
  rejections: [
    {
      reason:
        'Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265',
      type: 'permanent',
    },
  ],
  relativePath: 'Game.Night.2018.1080p.BluRay.x265.mp4',
  releaseGroup: null,
  size: 1674940307,
}

/** The same download, as Sonarr would describe a single-episode file. */
const seasonPack: SonarrManualImportResource = {
  downloadId: 'sonarr-download-1',
  folderName: 'The.Wire.S03.1080p.BluRay.x265',
  id: 900,
  languages: [{ id: 1, name: 'English' }],
  path: '/downloads/The.Wire.S03.1080p.BluRay.x265/the.wire.s03e05.mkv',
  quality: {
    quality: { id: 7, name: 'Bluray-1080p', resolution: 1080 },
    revision: { version: 1 },
  },
  rejections: [],
  relativePath: 'the.wire.s03e05.mkv',
  seasonNumber: 3,
  size: 2_000_000,
}

describe('toMovieCandidate', () => {
  it('flattens quality, languages and rejections off the live Radarr candidate', () => {
    expect(toMovieCandidate(gameNight, 'Resolved Title')).toEqual({
      downloadId: 'ce427a39-be9f-4271-b193-f7067dd82c4a',
      importable: true,
      languages: ['English'],
      movieTitle: 'Game Night',
      name: 'Game.Night.2018.1080p.BluRay.x265',
      path: '/downloads/Game.Night.2018.1080p.BluRay.x265/Game.Night.2018.1080p.BluRay.x265.mp4',
      quality: { name: 'Bluray-1080p', resolution: 1080 },
      // `reason` only - the `permanent` type is deliberately dropped, since
      // a manual import overrides it either way.
      rejections: [
        'Movie [Game Night (2018)][tt2704998, 445571] was not found in the grabbed release: Game.Night.2018.1080p.BluRay.x265',
      ],
      relativePath: 'Game.Night.2018.1080p.BluRay.x265.mp4',
      releaseGroup: undefined,
      size: 1674940307,
    })
  })

  it('stays importable and falls back to the resolved title when Radarr echoes no movie', () => {
    const candidate = toMovieCandidate(
      { ...gameNight, movie: undefined },
      'Resolved Title',
    )

    expect(candidate?.importable).toBe(true)
    expect(candidate?.movieTitle).toBe('Resolved Title')
  })

  it('reports no quality or languages rather than a placeholder', () => {
    const candidate = toMovieCandidate({
      ...gameNight,
      languages: [{ id: 1 }],
      quality: { revision: { version: 1 } },
    })

    expect(candidate?.quality).toBeUndefined()
    expect(candidate?.languages).toBeUndefined()
    expect(candidate?.rejections).toEqual([gameNight.rejections?.[0]?.reason])
  })

  it('skips a resource with no path - there is nothing to commit', () => {
    expect(toMovieCandidate({ ...gameNight, path: null })).toBeUndefined()
  })
})

/** Maps one resource as a listing of its own - the single-file case. */
function toShowCandidate(
  resource: SonarrManualImportResource,
  scope?: ShowScope,
): ManualImportCandidate | undefined {
  return toShowCandidates([resource], scope)[0]
}

describe('toShowCandidates', () => {
  it('uses the episodes Sonarr parsed', () => {
    const candidate = toShowCandidate({
      ...seasonPack,
      episodes: [
        {
          episodeNumber: 5,
          id: 4201,
          seasonNumber: 3,
          title: 'Straight and True',
        },
      ],
    })

    expect(candidate).toEqual(
      expect.objectContaining({
        episodes: [
          {
            episodeNumber: 5,
            id: 4201,
            seasonNumber: 3,
            title: 'Straight and True',
          },
        ],
        importable: true,
        languages: ['English'],
        path: '/downloads/The.Wire.S03.1080p.BluRay.x265/the.wire.s03e05.mkv',
        quality: { name: 'Bluray-1080p', resolution: 1080 },
        rejections: [],
      }),
    )
  })

  it('falls back to the episode-level scope when Sonarr parsed none', () => {
    const candidate = toShowCandidate(
      { ...seasonPack, episodes: [] },
      { episodeId: 4201, episodeNumber: 5, seasonNumber: 3 },
    )

    expect(candidate?.importable).toBe(true)
    expect(candidate?.episodes).toEqual([
      { episodeNumber: 5, id: 4201, seasonNumber: 3 },
    ])
  })

  it('takes the season number off the resource when the scope has none', () => {
    const candidate = toShowCandidate(
      { ...seasonPack, episodes: null },
      { episodeId: 4201 },
    )

    expect(candidate?.episodes).toEqual([
      { episodeNumber: 0, id: 4201, seasonNumber: 3 },
    ])
  })

  it('blocks a file Sonarr could not attribute to any episode', () => {
    const candidate = toShowCandidate({ ...seasonPack, episodes: [] })

    expect(candidate?.importable).toBe(false)
    expect(candidate?.blockedReason).toBe(UNPARSED_EPISODES_REASON)
    expect(candidate?.episodes).toBeUndefined()
  })

  it('drops an episode Sonarr handed back with no id', () => {
    const candidate = toShowCandidate({
      ...seasonPack,
      episodes: [{ episodeNumber: 5, seasonNumber: 3 }],
    })

    expect(candidate?.importable).toBe(false)
    expect(candidate?.blockedReason).toBe(UNPARSED_EPISODES_REASON)
  })

  it('skips a resource with no path', () => {
    expect(toShowCandidate({ ...seasonPack, path: '' })).toBeUndefined()
  })

  describe('the episode-scope fallback', () => {
    const scope: ShowScope = { episodeId: 4201, episodeNumber: 5 }
    const sample: SonarrManualImportResource = {
      ...seasonPack,
      episodes: [],
      path: '/downloads/The.Wire.S03E05/sample.mkv',
      size: 40_000_000,
    }
    const episode: SonarrManualImportResource = {
      ...seasonPack,
      episodes: [],
      path: '/downloads/The.Wire.S03E05/episode.mkv',
      size: 2_000_000_000,
    }
    const extra: SonarrManualImportResource = {
      ...seasonPack,
      episodes: [],
      path: '/downloads/The.Wire.S03E05/extra.mkv',
      size: 300_000_000,
    }

    it('maps only the largest unparsed file onto the scoped episode', () => {
      const candidates = toShowCandidates([sample, episode, extra], scope)

      expect(candidates.map(candidate => candidate?.importable)).toEqual([
        false,
        true,
        false,
      ])
      expect(candidates[1]?.episodes).toEqual([
        { episodeNumber: 5, id: 4201, seasonNumber: 3 },
      ])
    })

    it('leaves the others unmapped and blocked', () => {
      const [first, , third] = toShowCandidates([sample, episode, extra], scope)

      for (const candidate of [first, third]) {
        expect(candidate?.episodes).toBeUndefined()
        expect(candidate?.blockedReason).toBe(UNPARSED_EPISODES_REASON)
      }
    })

    it('keeps the first listed on a tie', () => {
      const twin = { ...episode, path: '/downloads/The.Wire.S03E05/twin.mkv' }

      const candidates = toShowCandidates([episode, twin], scope)

      expect(candidates.map(candidate => candidate?.importable)).toEqual([
        true,
        false,
      ])
    })

    it('never picks a file with no path', () => {
      const candidates = toShowCandidates(
        [{ ...episode, path: null }, sample],
        scope,
      )

      expect(candidates[0]).toBeUndefined()
      expect(candidates[1]?.importable).toBe(true)
    })

    it('leaves a parsed file alone and still maps one unparsed file', () => {
      const parsed: SonarrManualImportResource = {
        ...seasonPack,
        episodes: [{ episodeNumber: 5, id: 4201, seasonNumber: 3 }],
        size: 9_000_000_000,
      }

      const candidates = toShowCandidates([parsed, sample, episode], scope)

      expect(candidates.map(candidate => candidate?.importable)).toEqual([
        true,
        false,
        true,
      ])
    })

    it('maps nothing without an episode scope', () => {
      const candidates = toShowCandidates([sample, episode], {
        seasonNumber: 3,
      })

      expect(candidates.every(candidate => !candidate?.importable)).toBe(true)
    })
  })
})

describe('isInShowScope', () => {
  const inSeries: SonarrManualImportResource = {
    ...seasonPack,
    series: { id: 9 },
  }

  it('keeps a file of the series when no season is asked for', () => {
    expect(isInShowScope(inSeries, 9)).toBe(true)
  })

  it('drops a file of another series', () => {
    expect(isInShowScope({ ...inSeries, series: { id: 10 } }, 9)).toBe(false)
  })

  it('drops a file Sonarr tied to no series', () => {
    expect(isInShowScope({ ...seasonPack, series: undefined }, 9)).toBe(false)
  })

  it('matches the season on the resource', () => {
    expect(isInShowScope(inSeries, 9, 3)).toBe(true)
    expect(isInShowScope(inSeries, 9, 4)).toBe(false)
  })

  it('matches the season on the parsed episodes', () => {
    const resource: SonarrManualImportResource = {
      ...inSeries,
      episodes: [{ episodeNumber: 1, id: 5001, seasonNumber: 4 }],
      seasonNumber: null,
    }

    expect(isInShowScope(resource, 9, 4)).toBe(true)
    expect(isInShowScope(resource, 9, 3)).toBe(false)
  })

  // Season 0 is specials - a falsy season number that is still a season.
  it('treats season 0 as a real season', () => {
    const special: SonarrManualImportResource = { ...inSeries, seasonNumber: 0 }

    expect(isInShowScope(special, 9, 0)).toBe(true)
    expect(isInShowScope(special, 9, 3)).toBe(false)
    expect(isInShowScope(inSeries, 9, 0)).toBe(false)
  })

  it('keeps a file whose season Sonarr could not tell', () => {
    const unparsed: SonarrManualImportResource = {
      ...inSeries,
      episodes: [],
      seasonNumber: null,
    }

    expect(isInShowScope(unparsed, 9, 3)).toBe(true)
  })
})
