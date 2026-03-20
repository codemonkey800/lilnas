import {
  type MovieFileResource,
  type MovieResource,
} from '@lilnas/media/radarr-next'

import { movieResourceToDetail } from 'src/movies/movies.types'

function makeMovie(overrides: Partial<MovieResource> = {}): MovieResource {
  return {
    id: 1,
    tmdbId: 100,
    title: 'Test Movie',
    year: 2024,
    runtime: 120,
    certification: 'PG-13',
    overview: 'A test movie',
    hasFile: true,
    genres: ['Action', 'Drama'],
    sizeOnDisk: 5_000_000_000,
    images: [
      { coverType: 'poster', remoteUrl: 'https://example.com/poster.jpg' },
      { coverType: 'fanart', remoteUrl: 'https://example.com/fanart.jpg' },
    ],
    movieFile: {
      quality: { quality: { name: '1080p Bluray' } },
    },
    ratings: {
      imdb: { value: 7.5 },
      tmdb: { value: 8.0 },
    },
    ...overrides,
  }
}

function makeFile(
  overrides: Partial<MovieFileResource> = {},
): MovieFileResource {
  return {
    id: 10,
    relativePath: 'Test Movie (2024)/Test.Movie.2024.mkv',
    size: 5_000_000_000,
    quality: { quality: { name: '1080p Bluray' } },
    dateAdded: '2024-01-15T00:00:00Z',
    ...overrides,
  }
}

describe('movieResourceToDetail', () => {
  describe('image URL resolution', () => {
    it('prefers remoteUrl over url for poster and fanart', () => {
      const movie = makeMovie({
        images: [
          {
            coverType: 'poster',
            remoteUrl: 'https://remote.example.com/poster.jpg',
            url: 'https://local.example.com/poster.jpg',
          },
          {
            coverType: 'fanart',
            remoteUrl: 'https://remote.example.com/fanart.jpg',
            url: 'https://local.example.com/fanart.jpg',
          },
        ],
      })
      const result = movieResourceToDetail(movie, [])
      expect(result.posterUrl).toBe('https://remote.example.com/poster.jpg')
      expect(result.fanartUrl).toBe('https://remote.example.com/fanart.jpg')
    })

    it('falls back to url when remoteUrl is absent', () => {
      const movie = makeMovie({
        images: [
          { coverType: 'poster', url: 'https://local.example.com/poster.jpg' },
        ],
      })
      const result = movieResourceToDetail(movie, [])
      expect(result.posterUrl).toBe('https://local.example.com/poster.jpg')
      expect(result.fanartUrl).toBeNull()
    })

    it('returns null for posterUrl and fanartUrl when images array is empty', () => {
      const movie = makeMovie({ images: [] })
      const result = movieResourceToDetail(movie, [])
      expect(result.posterUrl).toBeNull()
      expect(result.fanartUrl).toBeNull()
    })

    it('returns null for posterUrl and fanartUrl when images is undefined', () => {
      const movie = makeMovie({ images: undefined })
      const result = movieResourceToDetail(movie, [])
      expect(result.posterUrl).toBeNull()
      expect(result.fanartUrl).toBeNull()
    })
  })

  describe('status field', () => {
    it('returns "downloaded" when hasFile is true', () => {
      const result = movieResourceToDetail(makeMovie({ hasFile: true }), [])
      expect(result.status).toBe('downloaded')
    })

    it('returns "missing" when hasFile is false', () => {
      const result = movieResourceToDetail(makeMovie({ hasFile: false }), [])
      expect(result.status).toBe('missing')
    })

    it('returns "missing" when hasFile is undefined', () => {
      const result = movieResourceToDetail(
        makeMovie({ hasFile: undefined }),
        [],
      )
      expect(result.status).toBe('missing')
    })
  })

  describe('ratings null-safety', () => {
    it('returns null for both ratings when ratings is undefined', () => {
      const result = movieResourceToDetail(
        makeMovie({ ratings: undefined }),
        [],
      )
      expect(result.ratings.imdb).toBeNull()
      expect(result.ratings.tmdb).toBeNull()
    })

    it('returns null for imdb when imdb rating value is missing', () => {
      const result = movieResourceToDetail(
        makeMovie({ ratings: { imdb: {}, tmdb: { value: 8.0 } } }),
        [],
      )
      expect(result.ratings.imdb).toBeNull()
      expect(result.ratings.tmdb).toBe(8.0)
    })
  })

  describe('files mapping', () => {
    it('returns empty files array when no files provided', () => {
      const result = movieResourceToDetail(makeMovie(), [])
      expect(result.files).toEqual([])
    })

    it('maps multiple files with correct fields', () => {
      const files = [
        makeFile({
          id: 10,
          relativePath: 'path/a.mkv',
          size: 1000,
          dateAdded: '2024-01-01T00:00:00Z',
        }),
        makeFile({
          id: 11,
          relativePath: 'path/b.mkv',
          size: 2000,
          dateAdded: '2024-02-01T00:00:00Z',
        }),
      ]
      const result = movieResourceToDetail(makeMovie(), files)
      expect(result.files).toHaveLength(2)
      expect(result.files[0]).toMatchObject({
        id: 10,
        relativePath: 'path/a.mkv',
        size: 1000,
      })
      expect(result.files[1]).toMatchObject({
        id: 11,
        relativePath: 'path/b.mkv',
        size: 2000,
      })
    })

    it('handles file with missing quality gracefully', () => {
      const file = makeFile({ quality: undefined })
      const result = movieResourceToDetail(makeMovie(), [file])
      expect(result.files[0]?.quality).toBeNull()
    })

    it('uses 0 for file id when id is undefined', () => {
      const file = makeFile({ id: undefined })
      const result = movieResourceToDetail(makeMovie(), [file])
      expect(result.files[0]?.id).toBe(0)
    })
  })

  describe('other field defaults', () => {
    it('uses "Unknown" for title when title is undefined', () => {
      const result = movieResourceToDetail(makeMovie({ title: undefined }), [])
      expect(result.title).toBe('Unknown')
    })

    it('uses 0 for id when id is undefined', () => {
      const result = movieResourceToDetail(makeMovie({ id: undefined }), [])
      expect(result.id).toBe(0)
    })

    it('returns empty genres array when genres is undefined', () => {
      const result = movieResourceToDetail(makeMovie({ genres: undefined }), [])
      expect(result.genres).toEqual([])
    })
  })
})
