jest.mock('@lilnas/media/radarr-next', () => ({
  getApiV3Movie: jest.fn(),
  getApiV3MovieLookup: jest.fn(),
}))

jest.mock('@lilnas/media/sonarr', () => ({
  getApiV3Series: jest.fn(),
  getApiV3SeriesLookup: jest.fn(),
}))

import { getApiV3Movie, getApiV3MovieLookup } from '@lilnas/media/radarr-next'
import { getApiV3Series, getApiV3SeriesLookup } from '@lilnas/media/sonarr'

import { LibraryService } from 'src/media/library.service'

const baseMovie = {
  id: 10,
  tmdbId: 456,
  title: 'Test Movie',
  year: 2023,
  hasFile: true,
  added: '2023-06-01T00:00:00Z',
  releaseDate: '2023-05-01',
  images: [],
  movieFile: undefined,
  sizeOnDisk: 0,
  digitalRelease: null,
  inCinemas: null,
}

const baseSeries = {
  id: 20,
  tvdbId: 789,
  title: 'Test Show',
  year: 2022,
  added: '2022-01-01T00:00:00Z',
  firstAired: '2022-01-15',
  images: [],
  statistics: { episodeFileCount: 5, totalEpisodeCount: 10, sizeOnDisk: 0 },
}

describe('LibraryService', () => {
  let service: LibraryService

  beforeEach(() => {
    service = new LibraryService()
    ;(getApiV3Movie as jest.Mock).mockResolvedValue({ data: [baseMovie] })
    ;(getApiV3Series as jest.Mock).mockResolvedValue({ data: [baseSeries] })
    ;(getApiV3MovieLookup as jest.Mock).mockResolvedValue({ data: [] })
    ;(getApiV3SeriesLookup as jest.Mock).mockResolvedValue({ data: [] })
  })

  // ---------------------------------------------------------------------------
  // getLibrary
  // ---------------------------------------------------------------------------

  describe('getLibrary', () => {
    it('returns combined list of movies and series with files', async () => {
      const result = await service.getLibrary()
      expect(result).toHaveLength(2)
      expect(result.map(i => i.title)).toContain('Test Movie')
      expect(result.map(i => i.title)).toContain('Test Show')
    })

    it('filters out movies without files', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({
        data: [{ ...baseMovie, hasFile: false }],
      })
      const result = await service.getLibrary()
      expect(result.map(i => i.title)).not.toContain('Test Movie')
    })

    it('filters out series with episodeFileCount of 0', async () => {
      ;(getApiV3Series as jest.Mock).mockResolvedValue({
        data: [{ ...baseSeries, statistics: { episodeFileCount: 0 } }],
      })
      const result = await service.getLibrary()
      expect(result.map(i => i.title)).not.toContain('Test Show')
    })

    it('filters out series with no statistics', async () => {
      ;(getApiV3Series as jest.Mock).mockResolvedValue({
        data: [{ ...baseSeries, statistics: null }],
      })
      const result = await service.getLibrary()
      expect(result.map(i => i.title)).not.toContain('Test Show')
    })

    it('returns empty array when both Radarr and Sonarr return empty', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({ data: [] })
      ;(getApiV3Series as jest.Mock).mockResolvedValue({ data: [] })
      const result = await service.getLibrary()
      expect(result).toEqual([])
    })

    it('propagates error when Radarr API fails', async () => {
      ;(getApiV3Movie as jest.Mock).mockRejectedValue(
        new Error('Radarr connection refused'),
      )
      await expect(service.getLibrary()).rejects.toThrow(
        'Radarr connection refused',
      )
    })

    it('propagates error when Sonarr API fails', async () => {
      ;(getApiV3Series as jest.Mock).mockRejectedValue(
        new Error('Sonarr timeout'),
      )
      await expect(service.getLibrary()).rejects.toThrow('Sonarr timeout')
    })
  })

  // ---------------------------------------------------------------------------
  // search – filter='movies'
  // ---------------------------------------------------------------------------

  describe('search with filter=movies', () => {
    it('returns only movie lookup results', async () => {
      ;(getApiV3MovieLookup as jest.Mock).mockResolvedValue({
        data: [baseMovie],
      })
      const result = await service.search('test', 'movies')
      expect(result.every(i => i.mediaType === 'movie')).toBe(true)
      expect(getApiV3SeriesLookup).not.toHaveBeenCalled()
    })

    it('prefers library movie entry over lookup entry', async () => {
      const lookupMovie = {
        ...baseMovie,
        id: undefined,
        title: 'Lookup Version',
      }
      ;(getApiV3MovieLookup as jest.Mock).mockResolvedValue({
        data: [lookupMovie],
      })
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({ data: [baseMovie] })

      const result = await service.search('test', 'movies')
      // The library entry (id=10) should be used for matching tmdbId
      expect(result[0]!.id).toBe(10)
    })
  })

  // ---------------------------------------------------------------------------
  // search – filter='shows'
  // ---------------------------------------------------------------------------

  describe('search with filter=shows', () => {
    it('returns only series lookup results', async () => {
      ;(getApiV3SeriesLookup as jest.Mock).mockResolvedValue({
        data: [baseSeries],
      })
      const result = await service.search('test', 'shows')
      expect(result.every(i => i.mediaType === 'show')).toBe(true)
      expect(getApiV3MovieLookup).not.toHaveBeenCalled()
    })

    it('prefers library series entry over lookup entry', async () => {
      const lookupSeries = {
        ...baseSeries,
        id: undefined,
        title: 'Lookup Version',
      }
      ;(getApiV3SeriesLookup as jest.Mock).mockResolvedValue({
        data: [lookupSeries],
      })
      ;(getApiV3Series as jest.Mock).mockResolvedValue({ data: [baseSeries] })

      const result = await service.search('test', 'shows')
      expect(result[0]!.id).toBe(20)
    })
  })

  // ---------------------------------------------------------------------------
  // search – filter='all' (default)
  // ---------------------------------------------------------------------------

  describe('search with filter=all', () => {
    it('searches both movies and series in parallel', async () => {
      ;(getApiV3MovieLookup as jest.Mock).mockResolvedValue({
        data: [baseMovie],
      })
      ;(getApiV3SeriesLookup as jest.Mock).mockResolvedValue({
        data: [baseSeries],
      })

      const result = await service.search('test')
      expect(getApiV3MovieLookup).toHaveBeenCalled()
      expect(getApiV3SeriesLookup).toHaveBeenCalled()
      expect(result.map(i => i.title)).toContain('Test Movie')
      expect(result.map(i => i.title)).toContain('Test Show')
    })

    it('interleaves movie and series results', async () => {
      ;(getApiV3MovieLookup as jest.Mock).mockResolvedValue({
        data: [
          { ...baseMovie, id: 1, tmdbId: 1, title: 'Movie 1' },
          { ...baseMovie, id: 2, tmdbId: 2, title: 'Movie 2' },
        ],
      })
      ;(getApiV3SeriesLookup as jest.Mock).mockResolvedValue({
        data: [{ ...baseSeries, id: 3, tvdbId: 3, title: 'Show 1' }],
      })

      const result = await service.search('test', 'all')
      // interleave: [movie1, show1, movie2]
      expect(result[0]!.mediaType).toBe('movie')
      expect(result[1]!.mediaType).toBe('show')
      expect(result[2]!.mediaType).toBe('movie')
    })

    it('returns empty array when both searches return no results', async () => {
      ;(getApiV3MovieLookup as jest.Mock).mockResolvedValue({ data: [] })
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({ data: [] })
      ;(getApiV3SeriesLookup as jest.Mock).mockResolvedValue({ data: [] })
      ;(getApiV3Series as jest.Mock).mockResolvedValue({ data: [] })

      const result = await service.search('nonexistent')
      expect(result).toEqual([])
    })
  })
})
