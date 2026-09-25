import {
  type RadarrManualImportResource,
  type SonarrManualImportResource,
  toMovieCandidate,
  toShowCandidate,
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

describe('toShowCandidate', () => {
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
})
