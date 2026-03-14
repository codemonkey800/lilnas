// Mock @lilnas/media/radarr-next so the module can be loaded without the
// built dist being present. Only getApiV3Release is a runtime value in movies.ts.
jest.mock('@lilnas/media/radarr-next', () => ({
  getApiV3Release: jest.fn(),
}))

import { movieResourceToDetail, queueToDownloadInfo } from 'src/media/movies'

const baseMovie = {
  id: 10,
  tmdbId: 456,
  title: 'Test Movie',
  year: 2023,
  runtime: 120,
  certification: 'PG-13',
  overview: 'A test movie.',
  hasFile: true,
  sizeOnDisk: 5_000_000_000,
  added: '2023-06-01T00:00:00Z',
  releaseDate: '2023-05-01',
  images: [
    { coverType: 'poster', remoteUrl: '/poster.jpg', url: null },
    { coverType: 'fanart', remoteUrl: '/fanart.jpg', url: null },
  ],
  movieFile: { quality: { quality: { name: '1080p Bluray' } } },
  genres: ['Action', 'Thriller'],
  ratings: {
    imdb: { value: 7.5 },
    tmdb: { value: 8.0 },
  },
}

const baseQueue = {
  id: 99,
  title: 'Test Movie [1080p]',
  size: 10_000_000_000,
  sizeleft: 5_000_000_000,
  status: 'downloading',
  trackedDownloadState: 'downloading',
  estimatedCompletionTime: '2023-06-01T12:00:00Z',
}

describe('queueToDownloadInfo', () => {
  it('maps all queue resource fields', () => {
    const info = queueToDownloadInfo(baseQueue as never)
    expect(info).toEqual({
      id: 99,
      title: 'Test Movie [1080p]',
      size: 10_000_000_000,
      sizeleft: 5_000_000_000,
      status: 'downloading',
      trackedDownloadState: 'downloading',
      estimatedCompletionTime: '2023-06-01T12:00:00Z',
    })
  })

  it('defaults null fields to null / 0', () => {
    const info = queueToDownloadInfo({
      id: undefined,
      title: undefined,
      size: undefined,
      sizeleft: undefined,
      status: undefined,
      trackedDownloadState: undefined,
      estimatedCompletionTime: undefined,
    } as never)
    expect(info.id).toBe(0)
    expect(info.title).toBeNull()
    expect(info.size).toBe(0)
    expect(info.sizeleft).toBe(0)
    expect(info.status).toBe('unknown')
    expect(info.trackedDownloadState).toBeNull()
    expect(info.estimatedCompletionTime).toBeNull()
  })
})

describe('movieResourceToDetail', () => {
  it('maps all core movie fields', () => {
    const detail = movieResourceToDetail(baseMovie as never, [], [], true, null)
    expect(detail.id).toBe(10)
    expect(detail.tmdbId).toBe(456)
    expect(detail.title).toBe('Test Movie')
    expect(detail.year).toBe(2023)
    expect(detail.runtime).toBe(120)
    expect(detail.certification).toBe('PG-13')
    expect(detail.overview).toBe('A test movie.')
    expect(detail.isInLibrary).toBe(true)
    expect(detail.sizeOnDisk).toBe(5_000_000_000)
  })

  it('maps poster and fanart URLs from images', () => {
    const detail = movieResourceToDetail(baseMovie as never, [], [], true, null)
    expect(detail.posterUrl).toBe('/poster.jpg')
    expect(detail.fanartUrl).toBe('/fanart.jpg')
  })

  it('maps genres and ratings', () => {
    const detail = movieResourceToDetail(baseMovie as never, [], [], true, null)
    expect(detail.genres).toEqual(['Action', 'Thriller'])
    expect(detail.ratings.imdb).toBe(7.5)
    expect(detail.ratings.tmdb).toBe(8.0)
  })

  it('sets status to downloaded when hasFile is true', () => {
    expect(
      movieResourceToDetail(baseMovie as never, [], [], true, null).status,
    ).toBe('downloaded')
  })

  it('sets status to missing when hasFile is false', () => {
    const movie = { ...baseMovie, hasFile: false }
    expect(
      movieResourceToDetail(movie as never, [], [], true, null).status,
    ).toBe('missing')
  })

  it('maps file list', () => {
    const files = [
      {
        id: 1,
        relativePath: 'Test Movie (2023).mkv',
        size: 5_000_000_000,
        quality: { quality: { name: '1080p' } },
        dateAdded: '2023-06-01T00:00:00Z',
      },
    ]
    const detail = movieResourceToDetail(
      baseMovie as never,
      files as never,
      [],
      true,
      null,
    )
    expect(detail.files).toHaveLength(1)
    expect(detail.files[0]!.id).toBe(1)
    expect(detail.files[0]!.relativePath).toBe('Test Movie (2023).mkv')
    expect(detail.files[0]!.quality).toBe('1080p')
  })

  it('sets download to null when no active queue items', () => {
    const detail = movieResourceToDetail(baseMovie as never, [], [], true, null)
    expect(detail.download).toBeNull()
  })

  it('picks the active queue item as download', () => {
    const queue = [
      { ...baseQueue, status: 'downloading' },
      { id: 100, status: 'completed', title: 'Other', size: 0, sizeleft: 0 },
    ]
    const detail = movieResourceToDetail(
      baseMovie as never,
      [],
      queue as never,
      true,
      null,
    )
    expect(detail.download).not.toBeNull()
    expect(detail.download!.id).toBe(99)
  })

  it('includes lastSearchedAt when provided', () => {
    const date = new Date('2023-01-01T00:00:00Z')
    const detail = movieResourceToDetail(baseMovie as never, [], [], true, date)
    expect(detail.lastSearchedAt).toBe('2023-01-01T00:00:00.000Z')
  })

  it('sets lastSearchedAt to null when date is null', () => {
    const detail = movieResourceToDetail(baseMovie as never, [], [], true, null)
    expect(detail.lastSearchedAt).toBeNull()
  })

  it('handles missing optional movie fields with defaults', () => {
    const minimal = {
      id: undefined,
      tmdbId: undefined,
      title: undefined,
      year: undefined,
      runtime: undefined,
      certification: undefined,
      overview: undefined,
      hasFile: false,
      sizeOnDisk: undefined,
      added: undefined,
      releaseDate: undefined,
      images: undefined,
      movieFile: undefined,
      genres: undefined,
      ratings: undefined,
    }
    const detail = movieResourceToDetail(minimal as never, [], [], false, null)
    expect(detail.id).toBe(0)
    expect(detail.tmdbId).toBeNull()
    expect(detail.title).toBe('Unknown')
    expect(detail.year).toBe(0)
    expect(detail.runtime).toBeNull()
    expect(detail.genres).toEqual([])
    expect(detail.ratings).toEqual({ imdb: null, tmdb: null })
    expect(detail.posterUrl).toBeNull()
    expect(detail.fanartUrl).toBeNull()
  })
})
