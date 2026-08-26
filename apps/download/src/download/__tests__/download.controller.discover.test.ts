// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> DownloadService) must mock it first (see
// media/__tests__/download.controller.media.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import { BadGatewayException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AuditLogService } from 'src/audit/audit-log.service'
import { AdminCheckService } from 'src/auth/admin-check.service'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadMetricsService } from 'src/download/download-metrics.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { DiscoveryService } from 'src/media/discovery.service'
import { MediaDownloadService } from 'src/media/media-download.service'
import { MediaFileService } from 'src/media/media-file.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { ReleaseService } from 'src/media/release.service'
import { ShowService } from 'src/media/show.service'

describe('DownloadController - discover', () => {
  let controller: DownloadController
  let discoveryService: jest.Mocked<DiscoveryService>

  const emptyDiscoveryPage = {
    degradedSources: [],
    facets: { genres: [] },
    items: [],
    nextCursor: null,
    total: 0,
  }

  beforeEach(async () => {
    const mockDiscoveryService = {
      search: jest.fn().mockResolvedValue(emptyDiscoveryPage),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        { provide: AdminCheckService, useValue: {} },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
        { provide: DiscoveryService, useValue: mockDiscoveryService },
        { provide: DownloadMetricsService, useValue: {} },
        { provide: DownloadService, useValue: {} },
        { provide: DownloadStateService, useValue: { jobs: new Map() } },
        { provide: JobQueryService, useValue: {} },
        { provide: MediaDownloadService, useValue: {} },
        { provide: MediaFileService, useValue: {} },
        { provide: MediaResolverService, useValue: { resolve: jest.fn() } },
        // Phase 3/4: DownloadController injects ReleaseService for the
        // release and bad-file routes and ShowService for the seasons and
        // file-delete routes. Unused by this file's routes, but DI still has
        // to satisfy the constructor.
        { provide: ReleaseService, useValue: {} },
        { provide: ShowService, useValue: {} },
      ],
    }).compile()

    controller = module.get(DownloadController)
    discoveryService = module.get(DiscoveryService)
  })

  it('maps the query params through to DiscoveryService.search()', async () => {
    await controller.discover({
      cursor: 'abc',
      genre: ['Action', 'Comedy'],
      limit: 10,
      query: 'the office',
      sort: 'title',
      yearFrom: 2000,
      yearTo: 2010,
    })

    expect(discoveryService.search).toHaveBeenCalledWith({
      cursor: 'abc',
      genres: ['Action', 'Comedy'],
      limit: 10,
      query: 'the office',
      sort: 'title',
      yearFrom: 2000,
      yearTo: 2010,
    })
  })

  it('returns the facets and degradedSources fields from the service verbatim', async () => {
    const page = {
      degradedSources: ['shows'],
      facets: { genres: [{ count: 1, genre: 'Action' }] },
      items: [],
      nextCursor: null,
      total: 0,
    }
    discoveryService.search.mockResolvedValue(page as never)

    const result = await controller.discover({
      limit: 24,
      query: 'ab',
      sort: 'relevance',
    })

    expect(result).toBe(page)
  })

  it('propagates a BadGatewayException when both upstream sources fail', async () => {
    discoveryService.search.mockRejectedValue(
      new BadGatewayException('both failed'),
    )

    await expect(
      controller.discover({ limit: 24, query: 'ab', sort: 'relevance' }),
    ).rejects.toThrow(BadGatewayException)
  })
})
