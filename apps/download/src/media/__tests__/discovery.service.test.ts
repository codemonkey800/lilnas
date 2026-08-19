import { DownloadType } from '@lilnas/utils/download/types'
import {
  BadGatewayException,
  BadRequestException,
  Logger,
} from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { DiscoveryService } from 'src/media/discovery.service'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

describe('DiscoveryService', () => {
  let service: DiscoveryService
  let radarrService: jest.Mocked<RadarrService>
  let sonarrService: jest.Mocked<SonarrService>

  beforeEach(async () => {
    const mockRadarrService = { searchDetailed: jest.fn() }
    const mockSonarrService = { searchDetailed: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscoveryService,
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: SonarrService, useValue: mockSonarrService },
      ],
    }).compile()

    service = module.get(DiscoveryService)
    radarrService = module.get(RadarrService)
    sonarrService = module.get(SonarrService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  const movieA = {
    genres: ['Action'],
    releaseYear: 2020,
    title: 'Movie A',
    tmdbId: 1,
    type: DownloadType.Movie as const,
  }
  const showA = {
    genres: ['Drama'],
    releaseYear: 2019,
    title: 'Show A',
    tvdbId: 2,
    type: DownloadType.Show as const,
  }

  it('merges both sources when both succeed, with no degraded sources', async () => {
    radarrService.searchDetailed.mockResolvedValue([movieA])
    sonarrService.searchDetailed.mockResolvedValue([showA])

    const page = await service.search({
      limit: 24,
      query: 'x',
      sort: 'relevance',
    })

    expect(page.degradedSources).toEqual([])
    expect(page.items.map(i => i.title).sort()).toEqual(['Movie A', 'Show A'])
    expect(page.total).toBe(2)
  })

  it('returns movie-only results with degradedSources: ["shows"] when Sonarr rejects', async () => {
    radarrService.searchDetailed.mockResolvedValue([movieA])
    sonarrService.searchDetailed.mockRejectedValue(new Error('sonarr down'))

    const page = await service.search({
      limit: 24,
      query: 'x',
      sort: 'relevance',
    })

    expect(page.degradedSources).toEqual(['shows'])
    expect(page.items.map(i => i.title)).toEqual(['Movie A'])
  })

  it('returns show-only results with degradedSources: ["movies"] when Radarr rejects', async () => {
    radarrService.searchDetailed.mockRejectedValue(new Error('radarr down'))
    sonarrService.searchDetailed.mockResolvedValue([showA])

    const page = await service.search({
      limit: 24,
      query: 'x',
      sort: 'relevance',
    })

    expect(page.degradedSources).toEqual(['movies'])
    expect(page.items.map(i => i.title)).toEqual(['Show A'])
  })

  it('throws BadGatewayException when both sources reject', async () => {
    radarrService.searchDetailed.mockRejectedValue(new Error('radarr down'))
    sonarrService.searchDetailed.mockRejectedValue(new Error('sonarr down'))

    await expect(
      service.search({ limit: 24, query: 'x', sort: 'relevance' }),
    ).rejects.toThrow(BadGatewayException)
  })

  it('returns an empty page (not an error) when both sources return no results', async () => {
    radarrService.searchDetailed.mockResolvedValue([])
    sonarrService.searchDetailed.mockResolvedValue([])

    const page = await service.search({
      limit: 24,
      query: 'x',
      sort: 'relevance',
    })

    expect(page).toMatchObject({ items: [], nextCursor: null, total: 0 })
  })

  it('never leaks the internal sourceRank field onto returned items', async () => {
    radarrService.searchDetailed.mockResolvedValue([movieA])
    sonarrService.searchDetailed.mockResolvedValue([])

    const page = await service.search({
      limit: 24,
      query: 'x',
      sort: 'relevance',
    })

    expect(page.items[0]).not.toHaveProperty('sourceRank')
  })

  it('filters by genre and year, and reports facets from the year-filtered (not genre-filtered) set', async () => {
    radarrService.searchDetailed.mockResolvedValue([
      movieA,
      { ...movieA, genres: ['Comedy'], title: 'Movie B', tmdbId: 3 },
    ])
    sonarrService.searchDetailed.mockResolvedValue([])

    const page = await service.search({
      genres: ['Action'],
      limit: 24,
      query: 'x',
      sort: 'relevance',
      yearFrom: 2020,
    })

    expect(page.items.map(i => i.title)).toEqual(['Movie A'])
    expect(page.facets.genres.map(f => f.genre).sort()).toEqual([
      'Action',
      'Comedy',
    ])
  })

  it('sorts by title when requested', async () => {
    radarrService.searchDetailed.mockResolvedValue([
      { ...movieA, title: 'Zebra' },
      { ...movieA, title: 'Apple', tmdbId: 9 },
    ])
    sonarrService.searchDetailed.mockResolvedValue([])

    const page = await service.search({ limit: 24, query: 'x', sort: 'title' })

    expect(page.items.map(i => i.title)).toEqual(['Apple', 'Zebra'])
  })

  it('paginates via cursor and round-trips into the correct page 2', async () => {
    radarrService.searchDetailed.mockResolvedValue([
      { ...movieA, title: 'One', tmdbId: 1 },
      { ...movieA, title: 'Two', tmdbId: 2 },
      { ...movieA, title: 'Three', tmdbId: 3 },
    ])
    sonarrService.searchDetailed.mockResolvedValue([])

    const page1 = await service.search({
      limit: 2,
      query: 'x',
      sort: 'title',
    })
    expect(page1.items.map(i => i.title)).toEqual(['One', 'Three'])
    expect(page1.nextCursor).not.toBeNull()

    const page2 = await service.search({
      cursor: page1.nextCursor ?? undefined,
      limit: 2,
      query: 'x',
      sort: 'title',
    })
    expect(page2.items.map(i => i.title)).toEqual(['Two'])
    expect(page2.nextCursor).toBeNull()
  })

  it('throws BadRequestException for a malformed cursor', async () => {
    radarrService.searchDetailed.mockResolvedValue([movieA])
    sonarrService.searchDetailed.mockResolvedValue([])

    await expect(
      service.search({
        cursor: 'not-a-real-cursor',
        limit: 24,
        query: 'x',
        sort: 'relevance',
      }),
    ).rejects.toThrow(BadRequestException)
  })

  it('throws BadRequestException for a cursor minted under a different query', async () => {
    radarrService.searchDetailed.mockResolvedValue([movieA])
    sonarrService.searchDetailed.mockResolvedValue([])

    radarrService.searchDetailed.mockResolvedValue([
      { ...movieA, title: 'One', tmdbId: 1 },
      { ...movieA, title: 'Two', tmdbId: 2 },
    ])

    const page1 = await service.search({
      limit: 1,
      query: 'first',
      sort: 'title',
    })
    expect(page1.nextCursor).not.toBeNull()

    await expect(
      service.search({
        cursor: page1.nextCursor ?? undefined,
        limit: 1,
        query: 'different-query',
        sort: 'title',
      }),
    ).rejects.toThrow(BadRequestException)
  })
})
