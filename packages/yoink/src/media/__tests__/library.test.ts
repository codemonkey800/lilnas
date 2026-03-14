import {
  getPosterUrl,
  interleave,
  movieToLibraryItem,
  seriesToLibraryItem,
} from 'src/media/library'

// Minimal shape matching what getPosterUrl expects
function makeImages(
  items: Array<{
    coverType?: string
    remoteUrl?: string | null
    url?: string | null
  }>,
) {
  return items
}

describe('getPosterUrl', () => {
  it('returns null for null, undefined, or empty images', () => {
    expect(getPosterUrl(undefined)).toBeNull()
    expect(getPosterUrl(null)).toBeNull()
    expect(getPosterUrl([])).toBeNull()
  })

  it('returns null when no poster in images', () => {
    const images = makeImages([
      { coverType: 'fanart', remoteUrl: '/fanart.jpg' },
    ])
    expect(getPosterUrl(images as never)).toBeNull()
  })

  it('returns remoteUrl when present', () => {
    const images = makeImages([
      { coverType: 'poster', remoteUrl: '/remote.jpg', url: '/local.jpg' },
    ])
    expect(getPosterUrl(images as never)).toBe('/remote.jpg')
  })

  it('falls back to url when remoteUrl is null', () => {
    const images = makeImages([
      { coverType: 'poster', remoteUrl: null, url: '/local.jpg' },
    ])
    expect(getPosterUrl(images as never)).toBe('/local.jpg')
  })

  it('returns null when both remoteUrl and url are null', () => {
    const images = makeImages([
      { coverType: 'poster', remoteUrl: null, url: null },
    ])
    expect(getPosterUrl(images as never)).toBeNull()
  })

  it('finds poster when mixed with other image types', () => {
    const images = makeImages([
      { coverType: 'fanart', remoteUrl: '/fanart.jpg' },
      { coverType: 'poster', remoteUrl: '/poster.jpg' },
      { coverType: 'banner', remoteUrl: '/banner.jpg' },
    ])
    expect(getPosterUrl(images as never)).toBe('/poster.jpg')
  })
})

describe('movieToLibraryItem', () => {
  const baseMovie = {
    id: 10,
    title: 'Test Movie',
    year: 2023,
    tmdbId: 456,
    hasFile: true,
    added: '2023-06-01T00:00:00Z',
    releaseDate: '2023-05-01',
    images: [{ coverType: 'poster', remoteUrl: '/poster.jpg', url: null }],
    movieFile: { quality: { quality: { name: '1080p' } } },
    digitalRelease: null,
    inCinemas: null,
  }

  it('maps all core fields', () => {
    const item = movieToLibraryItem(baseMovie as never)
    expect(item.id).toBe(10)
    expect(item.title).toBe('Test Movie')
    expect(item.year).toBe(2023)
    expect(item.mediaType).toBe('movie')
  })

  it('sets href using tmdbId', () => {
    expect(movieToLibraryItem(baseMovie as never).href).toBe('/movie/456')
  })

  it('sets status to downloaded when hasFile is true', () => {
    expect(movieToLibraryItem(baseMovie as never).status).toBe('downloaded')
  })

  it('sets status to missing when hasFile is false', () => {
    const movie = { ...baseMovie, hasFile: false }
    expect(movieToLibraryItem(movie as never).status).toBe('missing')
  })

  it('extracts quality from movieFile', () => {
    expect(movieToLibraryItem(baseMovie as never).quality).toBe('1080p')
  })

  it('sets quality to null when no movieFile', () => {
    const movie = { ...baseMovie, movieFile: undefined }
    expect(movieToLibraryItem(movie as never).quality).toBeNull()
  })

  it('extracts posterUrl from images', () => {
    expect(movieToLibraryItem(baseMovie as never).posterUrl).toBe('/poster.jpg')
  })

  it('sets posterUrl to null when no poster image', () => {
    const movie = { ...baseMovie, images: [] }
    expect(movieToLibraryItem(movie as never).posterUrl).toBeNull()
  })

  it('uses releaseDate as the release date', () => {
    expect(movieToLibraryItem(baseMovie as never).releaseDate).toBe(
      '2023-05-01',
    )
  })

  it('falls back to digitalRelease when releaseDate is null', () => {
    const movie = {
      ...baseMovie,
      releaseDate: null,
      digitalRelease: '2023-04-01',
    }
    expect(movieToLibraryItem(movie as never).releaseDate).toBe('2023-04-01')
  })

  it('falls back to inCinemas when releaseDate and digitalRelease are null', () => {
    const movie = {
      ...baseMovie,
      releaseDate: null,
      digitalRelease: null,
      inCinemas: '2023-03-01',
    }
    expect(movieToLibraryItem(movie as never).releaseDate).toBe('2023-03-01')
  })

  it('handles missing title with default', () => {
    const movie = { ...baseMovie, title: undefined }
    expect(movieToLibraryItem(movie as never).title).toBe('Unknown')
  })

  it('handles missing id with 0', () => {
    const movie = { ...baseMovie, id: undefined }
    expect(movieToLibraryItem(movie as never).id).toBe(0)
  })
})

describe('seriesToLibraryItem', () => {
  const baseSeries = {
    id: 20,
    title: 'Test Show',
    year: 2022,
    tvdbId: 789,
    added: '2022-01-01T00:00:00Z',
    firstAired: '2022-01-15',
    images: [{ coverType: 'poster', remoteUrl: '/show-poster.jpg', url: null }],
    statistics: {
      episodeFileCount: 5,
      totalEpisodeCount: 10,
    },
  }

  it('maps all core fields', () => {
    const item = seriesToLibraryItem(baseSeries as never)
    expect(item.id).toBe(20)
    expect(item.title).toBe('Test Show')
    expect(item.year).toBe(2022)
    expect(item.mediaType).toBe('show')
  })

  it('sets href using tvdbId', () => {
    expect(seriesToLibraryItem(baseSeries as never).href).toBe('/show/789')
  })

  it('sets status to downloaded when episodeFileCount > 0', () => {
    expect(seriesToLibraryItem(baseSeries as never).status).toBe('downloaded')
  })

  it('sets status to missing when episodeFileCount is 0', () => {
    const series = { ...baseSeries, statistics: { episodeFileCount: 0 } }
    expect(seriesToLibraryItem(series as never).status).toBe('missing')
  })

  it('sets status to missing when statistics is null', () => {
    const series = { ...baseSeries, statistics: null }
    expect(seriesToLibraryItem(series as never).status).toBe('missing')
  })

  it('sets quality to null (shows have no file-level quality)', () => {
    expect(seriesToLibraryItem(baseSeries as never).quality).toBeNull()
  })

  it('uses firstAired as release date', () => {
    expect(seriesToLibraryItem(baseSeries as never).releaseDate).toBe(
      '2022-01-15',
    )
  })

  it('sets releaseDate to null when firstAired is absent', () => {
    const series = { ...baseSeries, firstAired: undefined }
    expect(seriesToLibraryItem(series as never).releaseDate).toBeNull()
  })

  it('extracts posterUrl from images', () => {
    expect(seriesToLibraryItem(baseSeries as never).posterUrl).toBe(
      '/show-poster.jpg',
    )
  })
})

describe('interleave', () => {
  it('interleaves arrays of equal length', () => {
    const a = [{ id: 1 }, { id: 3 }] as never[]
    const b = [{ id: 2 }, { id: 4 }] as never[]
    const result = interleave(a, b)
    expect(result.map((i: { id: number }) => i.id)).toEqual([1, 2, 3, 4])
  })

  it('handles first array being longer', () => {
    const a = [{ id: 1 }, { id: 2 }, { id: 3 }] as never[]
    const b = [{ id: 4 }] as never[]
    const result = interleave(a, b)
    expect(result.map((i: { id: number }) => i.id)).toEqual([1, 4, 2, 3])
  })

  it('handles second array being longer', () => {
    const a = [{ id: 1 }] as never[]
    const b = [{ id: 2 }, { id: 3 }, { id: 4 }] as never[]
    const result = interleave(a, b)
    expect(result.map((i: { id: number }) => i.id)).toEqual([1, 2, 3, 4])
  })

  it('returns second array when first is empty', () => {
    const b = [{ id: 1 }, { id: 2 }] as never[]
    const result = interleave([], b)
    expect(result).toEqual(b)
  })

  it('returns first array when second is empty', () => {
    const a = [{ id: 1 }, { id: 2 }] as never[]
    const result = interleave(a, [])
    expect(result).toEqual(a)
  })

  it('returns empty array when both are empty', () => {
    expect(interleave([], [])).toEqual([])
  })

  it('handles single-element arrays', () => {
    const a = [{ id: 1 }] as never[]
    const b = [{ id: 2 }] as never[]
    const result = interleave(a, b)
    expect(result.map((i: { id: number }) => i.id)).toEqual([1, 2])
  })
})
