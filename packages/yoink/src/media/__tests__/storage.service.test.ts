jest.mock('@lilnas/media/radarr-next', () => ({
  getApiV3Diskspace: jest.fn(),
  getApiV3Movie: jest.fn(),
}))

jest.mock('@lilnas/media/sonarr', () => ({
  getApiV3Diskspace: jest.fn(),
  getApiV3Series: jest.fn(),
}))

jest.mock('src/media/clients', () => ({
  getRadarrClient: jest.fn(() => ({})),
  getSonarrClient: jest.fn(() => ({})),
}))

import {
  getApiV3Diskspace as getRadarrDiskspace,
  getApiV3Movie,
} from '@lilnas/media/radarr-next'
import {
  getApiV3Diskspace as getSonarrDiskspace,
  getApiV3Series,
} from '@lilnas/media/sonarr'

import { StorageService } from 'src/media/storage.service'

const makeMovie = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  tmdbId: 100,
  title: 'Test Movie',
  path: '/media/movies/Test Movie (2023)',
  sizeOnDisk: 5_000_000_000,
  hasFile: true,
  movieFile: {
    quality: { quality: { name: 'Bluray-1080p' } },
  },
  ...overrides,
})

const makeSeries = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  tvdbId: 200,
  title: 'Test Show',
  path: '/media/shows/Test Show',
  statistics: { sizeOnDisk: 10_000_000_000, episodeFileCount: 5 },
  ...overrides,
})

const makeRadarrDisk = (overrides: Record<string, unknown> = {}) => ({
  path: '/media/movies',
  freeSpace: 500_000_000_000,
  totalSpace: 1_000_000_000_000,
  ...overrides,
})

const makeSonarrDisk = (overrides: Record<string, unknown> = {}) => ({
  path: '/media/shows',
  freeSpace: 200_000_000_000,
  totalSpace: 1_000_000_000_000,
  ...overrides,
})

describe('StorageService', () => {
  let service: StorageService

  beforeEach(() => {
    service = new StorageService()
    ;(getRadarrDiskspace as jest.Mock).mockResolvedValue({
      data: [makeRadarrDisk()],
    })
    ;(getSonarrDiskspace as jest.Mock).mockResolvedValue({
      data: [makeSonarrDisk()],
    })
    ;(getApiV3Movie as jest.Mock).mockResolvedValue({ data: [makeMovie()] })
    ;(getApiV3Series as jest.Mock).mockResolvedValue({ data: [makeSeries()] })
  })

  // ---------------------------------------------------------------------------
  // getStorageOverview – root folders
  // ---------------------------------------------------------------------------

  describe('getStorageOverview – rootFolders', () => {
    it('returns one entry per unique disk path', async () => {
      const result = await service.getStorageOverview()
      expect(result.rootFolders).toHaveLength(2)
      const paths = result.rootFolders.map(f => f.path)
      expect(paths).toContain('/media/movies')
      expect(paths).toContain('/media/shows')
    })

    it('deduplicates when Radarr and Sonarr report the same disk path', async () => {
      const sharedDisk = {
        path: '/media',
        freeSpace: 300_000_000_000,
        totalSpace: 2_000_000_000_000,
      }
      ;(getRadarrDiskspace as jest.Mock).mockResolvedValue({
        data: [sharedDisk],
      })
      ;(getSonarrDiskspace as jest.Mock).mockResolvedValue({
        data: [sharedDisk],
      })

      const result = await service.getStorageOverview()
      expect(result.rootFolders).toHaveLength(1)
      expect(result.rootFolders[0]!.path).toBe('/media')
    })

    it('keeps the entry with the larger totalSpace when paths duplicate', async () => {
      const radarrDisk = {
        path: '/media',
        freeSpace: 300_000_000_000,
        totalSpace: 2_000_000_000_000,
      }
      const sonarrDisk = {
        path: '/media',
        freeSpace: 300_000_000_000,
        totalSpace: 1_500_000_000_000,
      }
      ;(getRadarrDiskspace as jest.Mock).mockResolvedValue({
        data: [radarrDisk],
      })
      ;(getSonarrDiskspace as jest.Mock).mockResolvedValue({
        data: [sonarrDisk],
      })

      const result = await service.getStorageOverview()
      expect(result.rootFolders[0]!.totalSpace).toBe(2_000_000_000_000)
    })

    it('includes freeSpace and totalSpace from the disk entry', async () => {
      const result = await service.getStorageOverview()
      const moviesDisk = result.rootFolders.find(
        f => f.path === '/media/movies',
      )!
      expect(moviesDisk.freeSpace).toBe(500_000_000_000)
      expect(moviesDisk.totalSpace).toBe(1_000_000_000_000)
    })

    it('returns empty rootFolders when both APIs return no disk data', async () => {
      ;(getRadarrDiskspace as jest.Mock).mockResolvedValue({ data: [] })
      ;(getSonarrDiskspace as jest.Mock).mockResolvedValue({ data: [] })

      const result = await service.getStorageOverview()
      expect(result.rootFolders).toEqual([])
    })

    it('skips disk entries with a null or missing path', async () => {
      ;(getRadarrDiskspace as jest.Mock).mockResolvedValue({
        data: [{ path: null, freeSpace: 100, totalSpace: 200 }],
      })
      ;(getSonarrDiskspace as jest.Mock).mockResolvedValue({ data: [] })

      const result = await service.getStorageOverview()
      expect(result.rootFolders).toHaveLength(0)
    })
  })

  // ---------------------------------------------------------------------------
  // getStorageOverview – byte attribution
  // ---------------------------------------------------------------------------

  describe('getStorageOverview – byte attribution', () => {
    it('attributes movie sizeOnDisk to the matching root folder', async () => {
      const result = await service.getStorageOverview()
      const moviesDisk = result.rootFolders.find(
        f => f.path === '/media/movies',
      )!
      expect(moviesDisk.moviesBytes).toBe(5_000_000_000)
    })

    it('attributes series sizeOnDisk to the matching root folder', async () => {
      const result = await service.getStorageOverview()
      const showsDisk = result.rootFolders.find(f => f.path === '/media/shows')!
      expect(showsDisk.showsBytes).toBe(10_000_000_000)
    })

    it('sums multiple movies on the same disk', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({
        data: [
          makeMovie({
            path: '/media/movies/Movie A (2022)',
            sizeOnDisk: 3_000_000_000,
          }),
          makeMovie({
            path: '/media/movies/Movie B (2023)',
            sizeOnDisk: 4_000_000_000,
          }),
        ],
      })

      const result = await service.getStorageOverview()
      const disk = result.rootFolders.find(f => f.path === '/media/movies')!
      expect(disk.moviesBytes).toBe(7_000_000_000)
    })

    it('sums multiple series on the same disk', async () => {
      ;(getApiV3Series as jest.Mock).mockResolvedValue({
        data: [
          makeSeries({
            path: '/media/shows/Show A',
            statistics: { sizeOnDisk: 5_000_000_000 },
          }),
          makeSeries({
            path: '/media/shows/Show B',
            statistics: { sizeOnDisk: 8_000_000_000 },
          }),
        ],
      })

      const result = await service.getStorageOverview()
      const disk = result.rootFolders.find(f => f.path === '/media/shows')!
      expect(disk.showsBytes).toBe(13_000_000_000)
    })

    it('uses longest prefix match when multiple root folder paths overlap', async () => {
      ;(getRadarrDiskspace as jest.Mock).mockResolvedValue({
        data: [
          { path: '/media', freeSpace: 100, totalSpace: 1000 },
          { path: '/media/movies', freeSpace: 50, totalSpace: 500 },
        ],
      })
      ;(getSonarrDiskspace as jest.Mock).mockResolvedValue({ data: [] })
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({
        data: [
          makeMovie({
            path: '/media/movies/Test (2023)',
            sizeOnDisk: 2_000_000_000,
          }),
        ],
      })

      const result = await service.getStorageOverview()
      const specificDisk = result.rootFolders.find(
        f => f.path === '/media/movies',
      )!
      const genericDisk = result.rootFolders.find(f => f.path === '/media')!
      expect(specificDisk.moviesBytes).toBe(2_000_000_000)
      expect(genericDisk.moviesBytes).toBe(0)
    })

    it('attributes moviesBytes 0 when no movies match the disk path', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({
        data: [
          makeMovie({
            path: '/other/movies/Test (2023)',
            sizeOnDisk: 5_000_000_000,
          }),
        ],
      })

      const result = await service.getStorageOverview()
      const disk = result.rootFolders.find(f => f.path === '/media/movies')!
      expect(disk.moviesBytes).toBe(0)
    })

    it('ignores movies with null or zero sizeOnDisk', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({
        data: [makeMovie({ sizeOnDisk: null }), makeMovie({ sizeOnDisk: 0 })],
      })

      const result = await service.getStorageOverview()
      const disk = result.rootFolders.find(f => f.path === '/media/movies')!
      expect(disk.moviesBytes).toBe(0)
    })

    it('ignores series with missing statistics', async () => {
      ;(getApiV3Series as jest.Mock).mockResolvedValue({
        data: [makeSeries({ statistics: null })],
      })

      const result = await service.getStorageOverview()
      const disk = result.rootFolders.find(f => f.path === '/media/shows')!
      expect(disk.showsBytes).toBe(0)
    })
  })

  // ---------------------------------------------------------------------------
  // getStorageOverview – largest items
  // ---------------------------------------------------------------------------

  describe('getStorageOverview – largestItems', () => {
    it('returns items sorted by sizeOnDisk descending', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({
        data: [
          makeMovie({ title: 'Small Movie', sizeOnDisk: 1_000_000_000 }),
          makeMovie({ title: 'Big Movie', sizeOnDisk: 10_000_000_000 }),
        ],
      })
      ;(getApiV3Series as jest.Mock).mockResolvedValue({ data: [] })

      const result = await service.getStorageOverview()
      expect(result.largestItems[0]!.title).toBe('Big Movie')
      expect(result.largestItems[1]!.title).toBe('Small Movie')
    })

    it('caps the list at 20 items', async () => {
      const movies = Array.from({ length: 25 }, (_, i) =>
        makeMovie({
          tmdbId: i + 1,
          title: `Movie ${i}`,
          sizeOnDisk: (i + 1) * 1_000_000_000,
        }),
      )
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({ data: movies })
      ;(getApiV3Series as jest.Mock).mockResolvedValue({ data: [] })

      const result = await service.getStorageOverview()
      expect(result.largestItems).toHaveLength(20)
    })

    it('mixes movies and shows in the sorted list', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({
        data: [makeMovie({ title: 'A Movie', sizeOnDisk: 5_000_000_000 })],
      })
      ;(getApiV3Series as jest.Mock).mockResolvedValue({
        data: [
          makeSeries({
            title: 'A Show',
            statistics: { sizeOnDisk: 8_000_000_000 },
          }),
        ],
      })

      const result = await service.getStorageOverview()
      expect(result.largestItems[0]!.title).toBe('A Show')
      expect(result.largestItems[0]!.mediaType).toBe('show')
      expect(result.largestItems[1]!.title).toBe('A Movie')
      expect(result.largestItems[1]!.mediaType).toBe('movie')
    })

    it('includes quality for movies from movieFile.quality.quality.name', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({
        data: [
          makeMovie({
            movieFile: { quality: { quality: { name: 'Bluray-1080p' } } },
          }),
        ],
      })
      ;(getApiV3Series as jest.Mock).mockResolvedValue({ data: [] })

      const result = await service.getStorageOverview()
      expect(result.largestItems[0]!.quality).toBe('Bluray-1080p')
    })

    it('sets quality to null for movies without movieFile', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({
        data: [makeMovie({ movieFile: undefined })],
      })
      ;(getApiV3Series as jest.Mock).mockResolvedValue({ data: [] })

      const result = await service.getStorageOverview()
      expect(result.largestItems[0]!.quality).toBeNull()
    })

    it('always sets quality to null for shows', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({ data: [] })

      const result = await service.getStorageOverview()
      expect(result.largestItems[0]!.mediaType).toBe('show')
      expect(result.largestItems[0]!.quality).toBeNull()
    })

    it('builds the correct href for movies', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({
        data: [makeMovie({ tmdbId: 42 })],
      })
      ;(getApiV3Series as jest.Mock).mockResolvedValue({ data: [] })

      const result = await service.getStorageOverview()
      expect(result.largestItems[0]!.href).toBe('/movie/42')
    })

    it('builds the correct href for shows', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({ data: [] })
      ;(getApiV3Series as jest.Mock).mockResolvedValue({
        data: [makeSeries({ tvdbId: 99 })],
      })

      const result = await service.getStorageOverview()
      expect(result.largestItems[0]!.href).toBe('/show/99')
    })

    it('excludes items with sizeOnDisk of 0 or null', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({
        data: [makeMovie({ sizeOnDisk: 0 })],
      })
      ;(getApiV3Series as jest.Mock).mockResolvedValue({
        data: [makeSeries({ statistics: { sizeOnDisk: 0 } })],
      })

      const result = await service.getStorageOverview()
      expect(result.largestItems).toHaveLength(0)
    })

    it('returns empty largestItems when both APIs return no data', async () => {
      ;(getApiV3Movie as jest.Mock).mockResolvedValue({ data: [] })
      ;(getApiV3Series as jest.Mock).mockResolvedValue({ data: [] })

      const result = await service.getStorageOverview()
      expect(result.largestItems).toEqual([])
    })
  })

  // ---------------------------------------------------------------------------
  // getStorageOverview – API error propagation
  // ---------------------------------------------------------------------------

  describe('getStorageOverview – error handling', () => {
    it('propagates Radarr disk space API errors', async () => {
      ;(getRadarrDiskspace as jest.Mock).mockRejectedValue(
        new Error('Radarr connection refused'),
      )
      await expect(service.getStorageOverview()).rejects.toThrow(
        'Radarr connection refused',
      )
    })

    it('propagates Sonarr disk space API errors', async () => {
      ;(getSonarrDiskspace as jest.Mock).mockRejectedValue(
        new Error('Sonarr timeout'),
      )
      await expect(service.getStorageOverview()).rejects.toThrow(
        'Sonarr timeout',
      )
    })

    it('propagates Radarr movie listing API errors', async () => {
      ;(getApiV3Movie as jest.Mock).mockRejectedValue(
        new Error('Radarr movie fetch failed'),
      )
      await expect(service.getStorageOverview()).rejects.toThrow(
        'Radarr movie fetch failed',
      )
    })

    it('propagates Sonarr series listing API errors', async () => {
      ;(getApiV3Series as jest.Mock).mockRejectedValue(
        new Error('Sonarr series fetch failed'),
      )
      await expect(service.getStorageOverview()).rejects.toThrow(
        'Sonarr series fetch failed',
      )
    })
  })
})
