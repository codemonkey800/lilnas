import { Test, TestingModule } from '@nestjs/testing'
import axios, { AxiosError } from 'axios'
import { v4 as uuid } from 'uuid'

import {
  createMockAxiosInstance,
  createMockAxiosResponse,
  createMockErrorClassificationService,
  createMockMediaConfigValidationService,
  createMockMediaLoggingService,
  createMockRetryService,
  createMockSonarrConfig,
  type MockAxiosInstance,
} from 'src/media/__tests__/types/test-mocks.types'
import { SonarrClient } from 'src/media/clients/sonarr.client'
import { MediaConfigValidationService } from 'src/media/config/media-config.validation'
import {
  MediaAuthenticationError,
  MediaNotFoundApiError,
} from 'src/media/errors/media-errors'
import { MediaLoggingService } from 'src/media/services/media-logging.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

// Mock axios
jest.mock('axios')
const mockedAxios = axios as jest.Mocked<typeof axios>

describe('SonarrClient', () => {
  let client: SonarrClient
  let mockAxiosInstance: MockAxiosInstance
  const testConfig = createMockSonarrConfig()

  beforeEach(async () => {
    mockAxiosInstance = createMockAxiosInstance()
    mockedAxios.create.mockReturnValue(mockAxiosInstance)

    // Create mock config service that returns our test config
    const mockConfigService = createMockMediaConfigValidationService()
    mockConfigService.getServiceConfig.mockReturnValue(testConfig)

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SonarrClient,
        { provide: RetryService, useValue: createMockRetryService() },
        {
          provide: ErrorClassificationService,
          useValue: createMockErrorClassificationService(),
        },
        {
          provide: MediaLoggingService,
          useValue: createMockMediaLoggingService(),
        },
        { provide: MediaConfigValidationService, useValue: mockConfigService },
      ],
    }).compile()

    client = module.get<SonarrClient>(SonarrClient)
  })

  describe('Service Configuration', () => {
    describe('Service validation', () => {
      it('should validate service name configuration', () => {
        expect(client.getServiceInfo().serviceName).toBe('sonarr')
      })

      it('should validate base configuration', () => {
        expect(mockedAxios.create.mock.calls[0][0]).toEqual(
          expect.objectContaining({
            baseURL: testConfig.url,
            timeout: testConfig.timeout,
          }),
        )
      })
    })

    describe('Service capabilities', () => {
      it.each([
        ['canSearch', true],
        ['canRequest', true],
        ['canMonitor', true],
      ])(
        'should have %s capability set to %s',
        async (capability, expectedValue) => {
          const capabilities = await client.getCapabilities(uuid())
          expect(capabilities[capability as keyof typeof capabilities]).toBe(
            expectedValue,
          )
        },
      )
    })
  })

  describe('Series Management', () => {
    it('should search and add series to library', async () => {
      const mockSearchResponse = [
        {
          title: 'Breaking Bad',
          sortTitle: 'breaking bad',
          overview: 'A chemistry teacher turns to crime.',
          year: 2008,
          tvdbId: 81189,
          imdbId: 'tt0903747',
          status: 'ended',
          firstAired: '2008-01-20T00:00:00Z',
          network: 'AMC',
          runtime: 47,
          genres: ['Crime', 'Drama', 'Thriller'],
          images: [{ coverType: 'poster', url: '/poster.jpg' }],
          seasons: [
            { seasonNumber: 0, monitored: false },
            { seasonNumber: 1, monitored: true },
            { seasonNumber: 2, monitored: true },
          ],
        },
      ]

      mockAxiosInstance.get.mockResolvedValue(
        createMockAxiosResponse(mockSearchResponse, 200),
      )

      const correlationId = uuid()
      const searchResults = await client.searchSeries(
        'Breaking Bad',
        correlationId,
      )

      expect(searchResults).toHaveLength(1)
      expect(searchResults[0]).toMatchObject({
        title: 'Breaking Bad',
        year: 2008,
        tvdbId: 81189,
        status: 'ended',
      })

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v3/series/lookup?term=Breaking%20Bad',
        expect.objectContaining({
          method: 'GET',
        }),
      )
    })

    it('should add series to library with season monitoring', async () => {
      const seriesData = {
        title: 'Test Series',
        year: 2023,
        tvdbId: 12345,
        qualityProfileId: 1,
        languageProfileId: 1,
        rootFolderPath: '/tv',
        monitored: true,
        seasons: [
          { seasonNumber: 1, monitored: true },
          { seasonNumber: 2, monitored: false },
        ],
        addOptions: {
          searchForMissingEpisodes: true,
          searchForCutoffUnmetEpisodes: false,
        },
      }

      const mockAddResponse = {
        id: 1,
        title: 'Test Series',
        year: 2023,
        tvdbId: 12345,
        status: 'continuing',
        monitored: true,
        seasonCount: 2,
      }

      mockAxiosInstance.post.mockResolvedValue(
        createMockAxiosResponse(mockAddResponse, 201),
      )

      const correlationId = uuid()
      const addedSeries = await client.addSeries(seriesData, correlationId)

      expect(addedSeries).toMatchObject({
        id: 1,
        title: 'Test Series',
        year: 2023,
        monitored: true,
      })

      expect(mockAxiosInstance.post).toHaveBeenCalledWith(
        '/api/v3/series',
        seriesData,
        expect.objectContaining({
          method: 'POST',
        }),
      )
    })
  })

  describe('Episode Management', () => {
    it('should retrieve episodes for series with monitoring controls', async () => {
      const mockEpisodesResponse = [
        {
          id: 1,
          episodeNumber: 1,
          seasonNumber: 1,
          title: 'Pilot',
          overview: 'The first episode',
          airDate: '2023-01-01',
          hasFile: true,
          monitored: true,
          episodeFile: {
            id: 1,
            relativePath: 'Season 1/Episode 1 - Pilot.mkv',
            size: 1073741824,
            quality: { quality: { name: '1080p' } },
          },
        },
        {
          id: 2,
          episodeNumber: 2,
          seasonNumber: 1,
          title: 'Second Episode',
          overview: 'The second episode',
          airDate: '2023-01-08',
          hasFile: false,
          monitored: true,
        },
      ]

      mockAxiosInstance.get.mockResolvedValue(
        createMockAxiosResponse(mockEpisodesResponse, 200),
      )

      const correlationId = uuid()
      const episodes = await client.getSeriesEpisodes(1, correlationId)

      expect(episodes).toHaveLength(2)
      expect(episodes[0]).toMatchObject({
        id: 1,
        title: 'Pilot',
        hasFile: true,
        monitored: true,
      })

      expect(mockAxiosInstance.get).toHaveBeenCalledWith(
        '/api/v3/episode?seriesId=1',
        expect.objectContaining({
          method: 'GET',
        }),
      )
    })

    it('should update episode monitoring settings', async () => {
      // Mock the getSeriesEpisodes call that updateEpisodeMonitoring makes internally
      const mockEpisodes = [
        {
          id: 1,
          seriesId: 1,
          seasonNumber: 1,
          episodeNumber: 1,
          title: 'Episode 1',
          overview: '',
          airDate: '2023-01-01',
          monitored: false,
          hasFile: true,
        },
        {
          id: 2,
          seriesId: 1,
          seasonNumber: 1,
          episodeNumber: 2,
          title: 'Episode 2',
          overview: '',
          airDate: '2023-01-08',
          monitored: true,
          hasFile: false,
        },
      ]

      const episodeUpdates = [
        { seasonNumber: 1, episodeNumber: 1, monitored: true },
        { seasonNumber: 1, episodeNumber: 2, monitored: false },
      ]

      mockAxiosInstance.request
        .mockResolvedValueOnce(createMockAxiosResponse(mockEpisodes, 200)) // GET call for episodes
        .mockResolvedValueOnce(
          createMockAxiosResponse({ ...mockEpisodes[0], monitored: true }, 200),
        ) // PUT episode 1
        .mockResolvedValueOnce(
          createMockAxiosResponse(
            { ...mockEpisodes[1], monitored: false },
            200,
          ),
        ) // PUT episode 2

      const correlationId = uuid()
      const updatedEpisodes = await client.updateEpisodeMonitoring(
        1, // seriesId
        episodeUpdates,
        correlationId,
      )

      expect(updatedEpisodes).toHaveLength(2) // Both episodes should be updated (episode 1: false->true, episode 2: true->false)
      expect(mockAxiosInstance.request).toHaveBeenCalledTimes(3) // 1 GET + 2 PUT
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          url: '/api/v3/episode/1',
          data: expect.objectContaining({
            monitored: true,
          }),
        }),
      )
      expect(mockAxiosInstance.request).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'PUT',
          url: '/api/v3/episode/2',
          data: expect.objectContaining({
            monitored: false,
          }),
        }),
      )
    })
  })

  describe('Quality and Language Profiles', () => {
    it('should retrieve quality profiles and language profiles', async () => {
      const mockQualityProfiles = [
        { id: 1, name: 'HD - 1080p', upgradeAllowed: true, cutoff: 7 },
        { id: 2, name: '4K - 2160p', upgradeAllowed: true, cutoff: 10 },
      ]

      const mockLanguageProfiles = [
        { id: 1, name: 'English', upgradeAllowed: true },
        { id: 2, name: 'Multi-Language', upgradeAllowed: true },
      ]

      mockAxiosInstance.get
        .mockResolvedValueOnce(
          createMockAxiosResponse(mockQualityProfiles, 200),
        )
        .mockResolvedValueOnce(
          createMockAxiosResponse(mockLanguageProfiles, 200),
        )

      const correlationId = uuid()
      const [qualityProfiles, languageProfiles] = await Promise.all([
        client.getQualityProfiles(correlationId),
        client.getLanguageProfiles(correlationId),
      ])

      expect(qualityProfiles).toHaveLength(2)
      expect(qualityProfiles[0]).toMatchObject({ id: 1, name: 'HD - 1080p' })

      expect(languageProfiles).toHaveLength(2)
      expect(languageProfiles[0]).toMatchObject({ id: 1, name: 'English' })
    })
  })

  describe('Download Queue Management', () => {
    it('should manage download queue and episode files', async () => {
      const mockQueue = [
        {
          id: 1,
          title: 'Test Series - S01E01 - Pilot',
          seriesId: 1,
          episodeId: 1,
          size: 1073741824,
          sizeleft: 536870912,
          status: 'downloading',
          trackedDownloadStatus: 'ok',
          progress: 50.0,
          downloadClient: 'qBittorrent',
        },
      ]

      const mockEpisodeFiles = [
        {
          id: 1,
          seriesId: 1,
          seasonNumber: 1,
          relativePath: 'Season 1/Episode 1 - Pilot.mkv',
          size: 1073741824,
          quality: { quality: { name: '1080p' }, revision: { version: 1 } },
          dateAdded: '2023-01-01T00:00:00Z',
        },
      ]

      mockAxiosInstance.get
        .mockResolvedValueOnce(
          createMockAxiosResponse({ records: mockQueue }, 200),
        )
        .mockResolvedValueOnce(createMockAxiosResponse(mockEpisodeFiles, 200))

      const correlationId = uuid()
      const queueItems = await client.getQueue(correlationId)

      expect(queueItems).toHaveLength(1)
      expect(queueItems[0]).toMatchObject({
        id: 1,
        seriesId: 1,
        status: 'downloading',
        progress: 50.0,
      })
    })
  })

  describe('System Status and Health', () => {
    it('should check system status and disk space', async () => {
      const mockSystemStatus = {
        version: '3.0.10.1567',
        buildTime: '2023-08-15T10:30:00Z',
        isDebug: false,
        isProduction: true,
        isAdmin: true,
        isUserInteractive: false,
        startupPath: '/app/sonarr',
        appData: '/config',
        osName: 'Ubuntu',
        osVersion: '20.04',
        isDocker: true,
      }

      const mockDiskSpace = [
        {
          path: '/tv',
          label: 'TV Shows',
          freeSpace: 500000000000,
          totalSpace: 1000000000000,
        },
      ]

      mockAxiosInstance.get
        .mockResolvedValueOnce(createMockAxiosResponse(mockSystemStatus, 200))
        .mockResolvedValueOnce(createMockAxiosResponse(mockDiskSpace, 200))

      const correlationId = uuid()
      const healthResult = await (
        client as unknown as {
          performHealthCheck: (id: string) => Promise<unknown>
        }
      ).performHealthCheck(correlationId)

      expect(healthResult).toMatchObject({
        isHealthy: true,
        status: 'healthy',
      })
    })
  })

  describe('Error Handling', () => {
    it('should handle Sonarr-specific errors correctly', async () => {
      const correlationId = uuid()

      // Test authentication error
      const authError = {
        response: { status: 401, data: { message: 'Unauthorized' } },
      } as AxiosError
      mockAxiosInstance.get.mockRejectedValue(authError)

      await expect(client.getQualityProfiles(correlationId)).rejects.toThrow(
        MediaAuthenticationError,
      )

      // Test not found error
      const notFoundError = {
        response: { status: 404, data: { message: 'Series not found' } },
      } as AxiosError
      mockAxiosInstance.get.mockRejectedValue(notFoundError)

      await expect(client.getSeries(999, correlationId)).rejects.toThrow(
        MediaNotFoundApiError,
      )
    })
  })

  describe('Episode Monitoring Business Logic', () => {
    describe('updateEpisodeMonitoring', () => {
      it('should handle concurrent episode monitoring updates to same series', async () => {
        // Business Impact: Prevents data corruption in episode monitoring state
        const correlationId = uuid()
        const seriesId = 123

        // Mock episodes response
        const mockEpisodes = [
          {
            id: 1,
            seriesId,
            seasonNumber: 1,
            episodeNumber: 1,
            title: 'Episode 1',
            overview: '',
            airDate: '2023-01-01',
            monitored: false,
            hasFile: true,
          },
          {
            id: 2,
            seriesId,
            seasonNumber: 1,
            episodeNumber: 2,
            title: 'Episode 2',
            overview: '',
            airDate: '2023-01-08',
            monitored: false,
            hasFile: false,
          },
        ]

        // First call returns episodes
        mockAxiosInstance.get.mockResolvedValueOnce(
          createMockAxiosResponse(mockEpisodes, 200),
        )

        // Second concurrent call returns same episodes
        mockAxiosInstance.get.mockResolvedValueOnce(
          createMockAxiosResponse(mockEpisodes, 200),
        )

        // Mock successful PUT responses for episode updates
        mockAxiosInstance.put.mockResolvedValue(
          createMockAxiosResponse({ monitored: true }, 200),
        )

        const episodeUpdates1 = [
          { seasonNumber: 1, episodeNumber: 1, monitored: true },
        ]

        const episodeUpdates2 = [
          { seasonNumber: 1, episodeNumber: 2, monitored: true },
        ]

        // Simulate concurrent requests to same series
        const [result1, result2] = await Promise.all([
          client.updateEpisodeMonitoring(
            seriesId,
            episodeUpdates1,
            correlationId,
          ),
          client.updateEpisodeMonitoring(
            seriesId,
            episodeUpdates2,
            `${correlationId}-2`,
          ),
        ])

        expect(result1).toHaveLength(1)
        expect(result2).toHaveLength(1)
        expect(mockAxiosInstance.get).toHaveBeenCalledTimes(2)
        expect(mockAxiosInstance.put).toHaveBeenCalledTimes(2)
      })

      it('should handle missing episodes gracefully', async () => {
        // Business Impact: Prevents API errors and user confusion
        const correlationId = uuid()
        const seriesId = 123

        // Mock episodes response with only one episode
        const mockEpisodes = [
          {
            id: 1,
            seriesId,
            seasonNumber: 1,
            episodeNumber: 1,
            title: 'Episode 1',
            overview: '',
            airDate: '2023-01-01',
            monitored: false,
            hasFile: true,
          },
        ]

        mockAxiosInstance.get.mockResolvedValue(
          createMockAxiosResponse(mockEpisodes, 200),
        )

        // Try to update non-existent episode
        const episodeUpdates = [
          { seasonNumber: 1, episodeNumber: 1, monitored: true }, // Exists
          { seasonNumber: 1, episodeNumber: 99, monitored: true }, // Doesn't exist
        ]

        mockAxiosInstance.put.mockResolvedValue(
          createMockAxiosResponse(
            {
              id: 1,
              seriesId,
              seasonNumber: 1,
              episodeNumber: 1,
              title: 'Episode 1',
              overview: '',
              airDate: '2023-01-01',
              monitored: true,
              hasFile: true,
            },
            200,
          ),
        )

        const result = await client.updateEpisodeMonitoring(
          seriesId,
          episodeUpdates,
          correlationId,
        )

        // Should only return the episode that was found and updated
        expect(result).toHaveLength(1)
        expect(result[0].episodeNumber).toBe(1)
        expect(mockAxiosInstance.put).toHaveBeenCalledTimes(1)
      })

      it('should validate episode existence before monitoring updates', async () => {
        // Business Impact: Prevents silent failures
        const correlationId = uuid()
        const seriesId = 123

        // Mock empty episodes response (series with no episodes)
        mockAxiosInstance.get.mockResolvedValue(
          createMockAxiosResponse([], 200),
        )

        const episodeUpdates = [
          { seasonNumber: 1, episodeNumber: 1, monitored: true },
        ]

        const result = await client.updateEpisodeMonitoring(
          seriesId,
          episodeUpdates,
          correlationId,
        )

        // Should return empty array when no episodes exist
        expect(result).toHaveLength(0)
        expect(mockAxiosInstance.put).not.toHaveBeenCalled()
      })
    })

    describe('setExclusiveEpisodeMonitoring', () => {
      it('should handle series with 1000+ episodes efficiently', async () => {
        // Business Impact: Prevents timeouts on large series
        const correlationId = uuid()
        const seriesId = 123

        // Generate mock episodes (simulate large anime series)
        const mockEpisodes = Array.from({ length: 1200 }, (_, i) => ({
          id: i + 1,
          seriesId,
          seasonNumber: Math.floor(i / 100) + 1,
          episodeNumber: (i % 100) + 1,
          title: `Episode ${i + 1}`,
          overview: '',
          airDate: '2023-01-01',
          monitored: false,
          hasFile: i % 3 === 0, // Some episodes have files
        }))

        mockAxiosInstance.get.mockResolvedValue(
          createMockAxiosResponse(mockEpisodes, 200),
        )

        mockAxiosInstance.put.mockResolvedValue(
          createMockAxiosResponse({ monitored: true }, 200),
        )

        // Target only 3 episodes from the large collection
        const targetEpisodes = [
          { seasonNumber: 1, episodeNumber: 1 },
          { seasonNumber: 5, episodeNumber: 50 },
          { seasonNumber: 12, episodeNumber: 1 },
        ]

        const startTime = Date.now()
        const result = await client.setExclusiveEpisodeMonitoring(
          seriesId,
          targetEpisodes,
          correlationId,
        )
        const duration = Date.now() - startTime

        expect(result.totalEpisodes).toBe(1200)
        expect(result.monitored).toBe(3)
        expect(result.unmonitored).toBe(1197)
        expect(result.targetEpisodes).toHaveLength(3)
        expect(result.targetEpisodes.every(ep => ep.found)).toBe(true)

        // Should complete reasonably quickly even with 1200 episodes
        expect(duration).toBeLessThan(5000)
      })

      it('should handle episodes missing from series database', async () => {
        // Business Impact: Graceful degradation instead of crashes
        const correlationId = uuid()
        const seriesId = 123

        // Mock episodes with gaps (episodes 1, 3, 5 exist but 2, 4 don't)
        const mockEpisodes = [
          {
            id: 1,
            seriesId,
            seasonNumber: 1,
            episodeNumber: 1,
            title: 'Episode 1',
            overview: '',
            airDate: '2023-01-01',
            monitored: false,
            hasFile: true,
          },
          {
            id: 3,
            seriesId,
            seasonNumber: 1,
            episodeNumber: 3,
            title: 'Episode 3',
            overview: '',
            airDate: '2023-01-15',
            monitored: false,
            hasFile: true,
          },
          {
            id: 5,
            seriesId,
            seasonNumber: 1,
            episodeNumber: 5,
            title: 'Episode 5',
            overview: '',
            airDate: '2023-01-29',
            monitored: false,
            hasFile: true,
          },
        ]

        mockAxiosInstance.get.mockResolvedValue(
          createMockAxiosResponse(mockEpisodes, 200),
        )

        mockAxiosInstance.put.mockResolvedValue(
          createMockAxiosResponse({ monitored: true }, 200),
        )

        // Try to monitor episodes including missing ones
        const targetEpisodes = [
          { seasonNumber: 1, episodeNumber: 1 }, // Exists
          { seasonNumber: 1, episodeNumber: 2 }, // Missing
          { seasonNumber: 1, episodeNumber: 3 }, // Exists
          { seasonNumber: 1, episodeNumber: 4 }, // Missing
          { seasonNumber: 1, episodeNumber: 5 }, // Exists
        ]

        const result = await client.setExclusiveEpisodeMonitoring(
          seriesId,
          targetEpisodes,
          correlationId,
        )

        expect(result.totalEpisodes).toBe(3) // Only existing episodes counted
        expect(result.monitored).toBe(3) // Only existing episodes monitored
        expect(result.targetEpisodes).toHaveLength(5)
        expect(result.targetEpisodes.filter(ep => ep.found)).toHaveLength(3)
        expect(result.targetEpisodes.filter(ep => !ep.found)).toHaveLength(2)

        // Verify missing episodes are identified correctly
        const missingEpisodes = result.targetEpisodes.filter(ep => !ep.found)
        expect(missingEpisodes.map(ep => ep.episodeNumber)).toEqual([2, 4])
      })
    })

    describe('validateEpisodeSpecification', () => {
      it('should handle series with missing seasons', async () => {
        // Business Impact: Prevents invalid monitoring configurations
        const correlationId = uuid()
        const seriesId = 123

        // Mock episodes missing season 2 entirely
        const mockEpisodes = [
          {
            id: 1,
            seriesId,
            seasonNumber: 1,
            episodeNumber: 1,
            title: 'S1E1',
            overview: '',
            airDate: '2023-01-01',
            monitored: false,
            hasFile: true,
          },
          {
            id: 2,
            seriesId,
            seasonNumber: 1,
            episodeNumber: 2,
            title: 'S1E2',
            overview: '',
            airDate: '2023-01-08',
            monitored: false,
            hasFile: true,
          },
          {
            id: 13,
            seriesId,
            seasonNumber: 3,
            episodeNumber: 1,
            title: 'S3E1',
            overview: '',
            airDate: '2023-03-01',
            monitored: false,
            hasFile: false,
          },
          {
            id: 14,
            seriesId,
            seasonNumber: 3,
            episodeNumber: 2,
            title: 'S3E2',
            overview: '',
            airDate: '2023-03-08',
            monitored: false,
            hasFile: false,
          },
        ]

        mockAxiosInstance.get.mockResolvedValue(
          createMockAxiosResponse(mockEpisodes, 200),
        )

        const episodeSpec = {
          seasons: [
            { seasonNumber: 1, episodes: [1, 2] },
            { seasonNumber: 2, episodes: [1, 2, 3] }, // Season 2 doesn't exist
            { seasonNumber: 3, episodes: [1] },
          ],
          totalEpisodes: 6,
        }

        const result = await client.validateEpisodeSpecification(
          seriesId,
          episodeSpec,
          correlationId,
        )

        expect(result.isValid).toBe(false)
        expect(result.warnings).toContain(
          'Season 2 has no available episodes in the database',
        )
        expect(result.missingEpisodes).toHaveLength(3) // All of season 2
        expect(
          result.availableEpisodes.filter(ep => ep.available),
        ).toHaveLength(3) // S1E1, S1E2, S3E1

        const missingSeason2Episodes = result.missingEpisodes.filter(
          ep => ep.seasonNumber === 2,
        )
        expect(missingSeason2Episodes).toHaveLength(3)
        expect(missingSeason2Episodes.map(ep => ep.episodeNumber)).toEqual([
          1, 2, 3,
        ])
      })

      it('should validate episode ranges against available episodes', async () => {
        // Business Impact: Prevents monitoring non-existent episodes
        const correlationId = uuid()
        const seriesId = 123

        // Mock 6-episode season
        const mockEpisodes = Array.from({ length: 6 }, (_, i) => ({
          id: i + 1,
          seriesId,
          seasonNumber: 1,
          episodeNumber: i + 1,
          title: `Episode ${i + 1}`,
          overview: '',
          airDate: '2023-01-01',
          monitored: false,
          hasFile: i < 3, // First 3 episodes have files
        }))

        mockAxiosInstance.get.mockResolvedValue(
          createMockAxiosResponse(mockEpisodes, 200),
        )

        const episodeSpec = {
          seasons: [
            {
              seasonNumber: 1,
              episodes: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], // Request 10 episodes but only 6 exist
            },
          ],
          totalEpisodes: 10,
        }

        const result = await client.validateEpisodeSpecification(
          seriesId,
          episodeSpec,
          correlationId,
        )

        expect(result.isValid).toBe(false)
        expect(result.availableEpisodes).toHaveLength(10) // All requested episodes checked
        expect(
          result.availableEpisodes.filter(ep => ep.available),
        ).toHaveLength(6) // Only 6 available
        expect(result.missingEpisodes).toHaveLength(4) // Episodes 7-10 missing

        const missingEpisodes = result.missingEpisodes
          .map(ep => ep.episodeNumber)
          .sort((a, b) => a - b)
        expect(missingEpisodes).toEqual([7, 8, 9, 10])

        expect(result.warnings).toContain(
          '4 requested episodes are not available in the database',
        )
      })
    })
  })
})
