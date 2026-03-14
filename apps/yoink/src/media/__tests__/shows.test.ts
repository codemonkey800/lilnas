// Mock @lilnas/media/sonarr so the module can be loaded without the built
// dist. Only getApiV3Release is a runtime value import in shows.ts.
jest.mock('@lilnas/media/sonarr', () => ({
  getApiV3Release: jest.fn(),
}))

import { buildShowDetail } from 'src/media/shows'

function makeSeries(overrides = {}) {
  return {
    id: 20,
    tvdbId: 789,
    title: 'Test Show',
    year: 2022,
    overview: 'A test show.',
    network: 'HBO',
    status: 'continuing',
    seriesType: 'standard',
    genres: ['Drama'],
    ratings: { value: 8.5 },
    certification: 'TV-MA',
    runtime: 60,
    sizeOnDisk: 10_000_000_000,
    firstAired: '2022-01-15',
    lastAired: '2022-12-15',
    imdbId: 'tt1234567',
    tmdbId: 111,
    tvMazeId: 222,
    originalLanguage: { name: 'English' },
    statistics: {
      episodeFileCount: 8,
      totalEpisodeCount: 10,
      sizeOnDisk: 10_000_000_000,
    },
    images: [
      { coverType: 'poster', remoteUrl: '/show-poster.jpg', url: null },
      { coverType: 'fanart', remoteUrl: '/show-fanart.jpg', url: null },
      { coverType: 'banner', remoteUrl: '/show-banner.jpg', url: null },
    ],
    seasons: [
      {
        seasonNumber: 1,
        monitored: true,
        images: [
          { coverType: 'poster', remoteUrl: '/s1-poster.jpg', url: null },
        ],
        statistics: { totalEpisodeCount: 10, sizeOnDisk: 10_000_000_000 },
      },
    ],
    ...overrides,
  }
}

function makeEpisode(overrides = {}) {
  return {
    id: 1,
    episodeFileId: null,
    seasonNumber: 1,
    episodeNumber: 1,
    title: 'Pilot',
    airDate: '2022-01-15',
    hasFile: false,
    monitored: true,
    images: [],
    ...overrides,
  }
}

function makeFile(overrides = {}) {
  return {
    id: 10,
    size: 2_000_000_000,
    relativePath: 'Season 01/E01.mkv',
    quality: { quality: { name: '1080p' } },
    ...overrides,
  }
}

function makeQueueItem(overrides = {}) {
  return {
    id: 50,
    episodeId: 1,
    size: 5_000_000_000,
    sizeleft: 2_000_000_000,
    status: 'downloading',
    trackedDownloadState: 'downloading',
    estimatedCompletionTime: '2022-01-16T00:00:00Z',
    title: 'Pilot.mkv',
    ...overrides,
  }
}

describe('buildShowDetail', () => {
  it('maps all core series fields', () => {
    const detail = buildShowDetail(
      makeSeries() as never,
      [],
      [],
      [],
      true,
      new Map(),
    )
    expect(detail.id).toBe(20)
    expect(detail.tvdbId).toBe(789)
    expect(detail.title).toBe('Test Show')
    expect(detail.year).toBe(2022)
    expect(detail.overview).toBe('A test show.')
    expect(detail.network).toBe('HBO')
    expect(detail.status).toBe('continuing')
    expect(detail.seriesType).toBe('standard')
    expect(detail.genres).toEqual(['Drama'])
    expect(detail.ratings).toEqual({ value: 8.5 })
    expect(detail.certification).toBe('TV-MA')
    expect(detail.runtime).toBe(60)
    expect(detail.isInLibrary).toBe(true)
    expect(detail.imdbId).toBe('tt1234567')
    expect(detail.tmdbId).toBe(111)
    expect(detail.originalLanguage).toBe('English')
  })

  it('maps image URLs', () => {
    const detail = buildShowDetail(
      makeSeries() as never,
      [],
      [],
      [],
      true,
      new Map(),
    )
    expect(detail.posterUrl).toBe('/show-poster.jpg')
    expect(detail.fanartUrl).toBe('/show-fanart.jpg')
    expect(detail.bannerUrl).toBe('/show-banner.jpg')
  })

  it('sets isInLibrary based on parameter', () => {
    const notInLibrary = buildShowDetail(
      makeSeries() as never,
      [],
      [],
      [],
      false,
      new Map(),
    )
    expect(notInLibrary.isInLibrary).toBe(false)
  })

  it('filters out season 0 (specials)', () => {
    const series = makeSeries({
      seasons: [
        { seasonNumber: 0, monitored: false, images: [], statistics: {} },
        {
          seasonNumber: 1,
          monitored: true,
          images: [],
          statistics: { totalEpisodeCount: 5, sizeOnDisk: 0 },
        },
      ],
    })
    const detail = buildShowDetail(series as never, [], [], [], true, new Map())
    expect(detail.seasons.map(s => s.seasonNumber)).not.toContain(0)
    expect(detail.seasons.map(s => s.seasonNumber)).toContain(1)
  })

  it('sorts seasons by season number', () => {
    const series = makeSeries({
      seasons: [
        { seasonNumber: 3, monitored: true, images: [], statistics: {} },
        { seasonNumber: 1, monitored: true, images: [], statistics: {} },
        { seasonNumber: 2, monitored: true, images: [], statistics: {} },
      ],
    })
    const detail = buildShowDetail(series as never, [], [], [], true, new Map())
    expect(detail.seasons.map(s => s.seasonNumber)).toEqual([1, 2, 3])
  })

  it('builds episode info with file data', () => {
    const ep = makeEpisode({ id: 1, episodeFileId: 10, hasFile: true })
    const file = makeFile({ id: 10 })
    const detail = buildShowDetail(
      makeSeries() as never,
      [ep] as never,
      [file] as never,
      [],
      true,
      new Map(),
    )
    const episode = detail.seasons[0]!.episodes[0]!
    expect(episode.quality).toBe('1080p')
    expect(episode.fileSize).toBe(2_000_000_000)
    expect(episode.relativePath).toBe('Season 01/E01.mkv')
    expect(episode.hasFile).toBe(true)
  })

  it('builds episode info with active download', () => {
    const ep = makeEpisode({ id: 1 })
    const queueItem = makeQueueItem({ episodeId: 1, status: 'downloading' })
    const detail = buildShowDetail(
      makeSeries() as never,
      [ep] as never,
      [],
      [queueItem] as never,
      true,
      new Map(),
    )
    const episode = detail.seasons[0]!.episodes[0]!
    expect(episode.download).not.toBeNull()
    expect(episode.download!.id).toBe(50)
    expect(episode.download!.status).toBe('downloading')
  })

  it('maps search result key as S{season}E{episode}', () => {
    const ep = makeEpisode({ id: 1, seasonNumber: 1, episodeNumber: 1 })
    const searchMap = new Map([
      ['S1E1', { lastSearchedAt: new Date('2023-01-01T00:00:00Z') }],
    ])
    const detail = buildShowDetail(
      makeSeries() as never,
      [ep] as never,
      [],
      [],
      true,
      searchMap,
    )
    const episode = detail.seasons[0]!.episodes[0]!
    expect(episode.lastSearchedAt).toBe('2023-01-01T00:00:00.000Z')
  })

  it('returns null lastSearchedAt when no search result for episode', () => {
    const ep = makeEpisode({ id: 1 })
    const detail = buildShowDetail(
      makeSeries() as never,
      [ep] as never,
      [],
      [],
      true,
      new Map(),
    )
    expect(detail.seasons[0]!.episodes[0]!.lastSearchedAt).toBeNull()
  })

  it('counts downloaded episodes in season', () => {
    const episodes = [
      makeEpisode({ id: 1, episodeNumber: 1, hasFile: true }),
      makeEpisode({ id: 2, episodeNumber: 2, hasFile: false }),
    ]
    const detail = buildShowDetail(
      makeSeries() as never,
      episodes as never,
      [],
      [],
      true,
      new Map(),
    )
    expect(detail.seasons[0]!.downloadedCount).toBe(1)
  })

  it('collects episode screenshots', () => {
    const ep = makeEpisode({
      images: [
        { coverType: 'screenshot', remoteUrl: '/ep-screenshot.jpg', url: null },
      ],
    })
    const detail = buildShowDetail(
      makeSeries() as never,
      [ep] as never,
      [],
      [],
      true,
      new Map(),
    )
    expect(detail.screenshots).toContain('/ep-screenshot.jpg')
  })

  it('ignores non-active queue statuses', () => {
    const ep = makeEpisode({ id: 1 })
    const queueItem = makeQueueItem({ episodeId: 1, status: 'warning' })
    const detail = buildShowDetail(
      makeSeries() as never,
      [ep] as never,
      [],
      [queueItem] as never,
      true,
      new Map(),
    )
    expect(detail.seasons[0]!.episodes[0]!.download).toBeNull()
  })

  it('handles empty episodes, files and queue gracefully', () => {
    const detail = buildShowDetail(
      makeSeries() as never,
      [],
      [],
      [],
      false,
      new Map(),
    )
    expect(detail.seasons).toHaveLength(1)
    expect(detail.seasons[0]!.episodes).toHaveLength(0)
    expect(detail.screenshots).toEqual([])
  })

  it('maps statistics from series', () => {
    const detail = buildShowDetail(
      makeSeries() as never,
      [],
      [],
      [],
      true,
      new Map(),
    )
    expect(detail.totalEpisodeCount).toBe(10)
    expect(detail.episodeFileCount).toBe(8)
    expect(detail.sizeOnDisk).toBe(10_000_000_000)
  })
})
