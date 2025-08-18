import {
  MediaItem,
  MediaRequest,
  MediaStatus,
  MovieItem,
  QualityProfile,
  SearchResult,
  SeriesItem,
  StorageMetrics,
} from 'src/media/interfaces/media.types'
import {
  ComponentType,
  DiscordErrorCodes,
  MediaStatusType,
  MediaType,
  QueueStatusType,
  TrackedDownloadStateType,
  TrackedDownloadStatusType,
} from 'src/types/enums'

describe('Media Types and Enums', () => {
  describe('MediaType Enum', () => {
    it('should define movie and series types', () => {
      expect(MediaType.MOVIE).toBe('movie')
      expect(MediaType.SERIES).toBe('series')
    })

    it('should be usable in type guards', () => {
      function isMovie(type: MediaType): boolean {
        return type === MediaType.MOVIE
      }

      function isSeries(type: MediaType): boolean {
        return type === MediaType.SERIES
      }

      expect(isMovie(MediaType.MOVIE)).toBe(true)
      expect(isMovie(MediaType.SERIES)).toBe(false)
      expect(isSeries(MediaType.SERIES)).toBe(true)
      expect(isSeries(MediaType.MOVIE)).toBe(false)
    })

    it('should work in switch statements', () => {
      function getMediaTypeLabel(type: MediaType): string {
        switch (type) {
          case MediaType.MOVIE:
            return 'Movie'
          case MediaType.SERIES:
            return 'TV Series'
          default:
            return 'Unknown'
        }
      }

      expect(getMediaTypeLabel(MediaType.MOVIE)).toBe('Movie')
      expect(getMediaTypeLabel(MediaType.SERIES)).toBe('TV Series')
    })
  })

  describe('MediaStatusType Enum', () => {
    it('should define all media status values', () => {
      expect(MediaStatusType.ANNOUNCED).toBe('announced')
      expect(MediaStatusType.IN_CINEMAS).toBe('inCinemas')
      expect(MediaStatusType.RELEASED).toBe('released')
      expect(MediaStatusType.DELETED).toBe('deleted')
      expect(MediaStatusType.CONTINUING).toBe('continuing')
      expect(MediaStatusType.ENDED).toBe('ended')
      expect(MediaStatusType.UPCOMING).toBe('upcoming')
      expect(MediaStatusType.MONITORED).toBe('monitored')
      expect(MediaStatusType.UNMONITORED).toBe('unmonitored')
    })

    it('should distinguish between movie and series statuses', () => {
      const movieStatuses = [
        MediaStatusType.ANNOUNCED,
        MediaStatusType.IN_CINEMAS,
        MediaStatusType.RELEASED,
      ]

      const seriesStatuses = [
        MediaStatusType.CONTINUING,
        MediaStatusType.ENDED,
        MediaStatusType.UPCOMING,
      ]

      const commonStatuses = [
        MediaStatusType.MONITORED,
        MediaStatusType.UNMONITORED,
        MediaStatusType.DELETED,
      ]

      expect(
        movieStatuses.length + seriesStatuses.length + commonStatuses.length,
      ).toBe(Object.values(MediaStatusType).length)
    })
  })

  describe('QueueStatusType Enum', () => {
    it('should define all queue status values', () => {
      expect(QueueStatusType.QUEUED).toBe('queued')
      expect(QueueStatusType.PAUSED).toBe('paused')
      expect(QueueStatusType.DOWNLOADING).toBe('downloading')
      expect(QueueStatusType.DOWNLOAD_CLIENT_UNAVAILABLE).toBe(
        'downloadClientUnavailable',
      )
      expect(QueueStatusType.COMPLETED).toBe('completed')
      expect(QueueStatusType.FAILED).toBe('failed')
    })

    it('should represent logical download progression', () => {
      function isActiveStatus(status: QueueStatusType): boolean {
        return (
          status === QueueStatusType.QUEUED ||
          status === QueueStatusType.DOWNLOADING
        )
      }

      function isFinalStatus(status: QueueStatusType): boolean {
        return (
          status === QueueStatusType.COMPLETED ||
          status === QueueStatusType.FAILED
        )
      }

      expect(isActiveStatus(QueueStatusType.QUEUED)).toBe(true)
      expect(isActiveStatus(QueueStatusType.DOWNLOADING)).toBe(true)
      expect(isActiveStatus(QueueStatusType.COMPLETED)).toBe(false)

      expect(isFinalStatus(QueueStatusType.COMPLETED)).toBe(true)
      expect(isFinalStatus(QueueStatusType.FAILED)).toBe(true)
      expect(isFinalStatus(QueueStatusType.DOWNLOADING)).toBe(false)
    })
  })

  describe('DiscordErrorCodes Enum', () => {
    it('should define common Discord API error codes', () => {
      expect(DiscordErrorCodes.UNKNOWN_INTERACTION).toBe('10062')
      expect(DiscordErrorCodes.INTERACTION_HAS_ALREADY_BEEN_ACKNOWLEDGED).toBe(
        '40060',
      )
      expect(DiscordErrorCodes.MISSING_PERMISSIONS).toBe('50013')
      expect(DiscordErrorCodes.RATE_LIMITED).toBe('429')
      expect(DiscordErrorCodes.INTERNAL_SERVER_ERROR).toBe('500')
    })

    it('should be usable for error classification', () => {
      function isRetryableError(code: DiscordErrorCodes): boolean {
        return [
          DiscordErrorCodes.RATE_LIMITED,
          DiscordErrorCodes.INTERNAL_SERVER_ERROR,
          DiscordErrorCodes.SERVICE_UNAVAILABLE,
        ].includes(code)
      }

      function isClientError(code: DiscordErrorCodes): boolean {
        return [
          DiscordErrorCodes.MISSING_PERMISSIONS,
          DiscordErrorCodes.UNKNOWN_INTERACTION,
          DiscordErrorCodes.CANNOT_SEND_EMPTY_MESSAGE,
        ].includes(code)
      }

      expect(isRetryableError(DiscordErrorCodes.RATE_LIMITED)).toBe(true)
      expect(isRetryableError(DiscordErrorCodes.MISSING_PERMISSIONS)).toBe(
        false,
      )

      expect(isClientError(DiscordErrorCodes.MISSING_PERMISSIONS)).toBe(true)
      expect(isClientError(DiscordErrorCodes.INTERNAL_SERVER_ERROR)).toBe(false)
    })
  })

  describe('ComponentType Enum', () => {
    it('should define Discord component types', () => {
      expect(ComponentType.ACTION_ROW).toBe(1)
      expect(ComponentType.BUTTON).toBe(2)
      expect(ComponentType.STRING_SELECT).toBe(3)
      expect(ComponentType.TEXT_INPUT).toBe(4)
      expect(ComponentType.USER_SELECT).toBe(5)
    })

    it('should use correct numeric values matching Discord API', () => {
      // These values must match Discord's API specification
      expect(typeof ComponentType.ACTION_ROW).toBe('number')
      expect(ComponentType.ACTION_ROW).toBe(1)
      expect(ComponentType.BUTTON).toBe(2)
      expect(ComponentType.STRING_SELECT).toBe(3)
      expect(ComponentType.TEXT_INPUT).toBe(4)
      expect(ComponentType.USER_SELECT).toBe(5)
    })
  })

  describe('MediaItem Interface', () => {
    it('should define base media item structure', () => {
      const mediaItem: MediaItem = {
        id: 'test-123',
        title: 'Test Media',
        overview: 'A test media item',
        year: 2023,
        status: MediaStatusType.RELEASED,
        monitored: true,
        added: new Date('2023-01-01'),
        sortTitle: 'test media',
        qualityProfileId: 1,
        tags: [1, 2, 3],
      }

      expect(mediaItem.id).toBe('test-123')
      expect(mediaItem.title).toBe('Test Media')
      expect(mediaItem.status).toBe(MediaStatusType.RELEASED)
      expect(mediaItem.monitored).toBe(true)
      expect(mediaItem.tags).toEqual([1, 2, 3])
    })

    it('should support both string and number IDs', () => {
      const stringIdItem: MediaItem = {
        id: 'string-id-123',
        title: 'String ID Item',
        status: MediaStatusType.ANNOUNCED,
        monitored: false,
        added: new Date(),
        sortTitle: 'string id item',
        qualityProfileId: 1,
        tags: [],
      }

      const numberIdItem: MediaItem = {
        id: 12345,
        title: 'Number ID Item',
        status: MediaStatusType.RELEASED,
        monitored: true,
        added: new Date(),
        sortTitle: 'number id item',
        qualityProfileId: 2,
        tags: [],
      }

      expect(typeof stringIdItem.id).toBe('string')
      expect(typeof numberIdItem.id).toBe('number')
    })
  })

  describe('MovieItem Interface', () => {
    it('should extend MediaItem with movie-specific properties', () => {
      const movie: MovieItem = {
        id: 1,
        title: 'Test Movie',
        overview: 'A test movie',
        year: 2023,
        status: MediaStatusType.RELEASED,
        monitored: true,
        added: new Date('2023-01-01'),
        sortTitle: 'test movie',
        qualityProfileId: 1,
        tags: [],
        type: MediaType.MOVIE,
        runtime: 120,
        certification: 'PG-13',
        genres: ['Action', 'Adventure'],
        studio: 'Test Studio',
        minimumAvailability: 'released',
        hasFile: true,
        inCinemas: new Date('2023-06-01'),
        digitalRelease: new Date('2023-08-01'),
      }

      expect(movie.type).toBe(MediaType.MOVIE)
      expect(movie.runtime).toBe(120)
      expect(movie.genres).toContain('Action')
      expect(movie.hasFile).toBe(true)
    })

    it('should validate minimum availability values', () => {
      const validAvailabilities: MovieItem['minimumAvailability'][] = [
        'announced',
        'inCinemas',
        'released',
        'preDB',
      ]

      validAvailabilities.forEach(availability => {
        const movie: MovieItem = {
          id: 1,
          title: 'Test Movie',
          status: MediaStatusType.RELEASED,
          monitored: true,
          added: new Date(),
          sortTitle: 'test movie',
          qualityProfileId: 1,
          tags: [],
          type: MediaType.MOVIE,
          genres: [],
          minimumAvailability: availability,
          hasFile: false,
        }

        expect(movie.minimumAvailability).toBe(availability)
      })
    })
  })

  describe('SeriesItem Interface', () => {
    it('should extend MediaItem with series-specific properties', () => {
      const series: SeriesItem = {
        id: 1,
        title: 'Test Series',
        overview: 'A test TV series',
        year: 2023,
        status: MediaStatusType.CONTINUING,
        monitored: true,
        added: new Date('2023-01-01'),
        sortTitle: 'test series',
        qualityProfileId: 1,
        languageProfileId: 1,
        tags: [],
        type: MediaType.SERIES,
        network: 'Test Network',
        seriesType: 'standard',
        seasonCount: 3,
        totalEpisodeCount: 36,
        episodeCount: 24,
        episodeFileCount: 20,
        ended: false,
        firstAired: new Date('2023-01-15'),
        seasons: [
          { seasonNumber: 1, monitored: true },
          { seasonNumber: 2, monitored: true },
          { seasonNumber: 3, monitored: false },
        ],
        useSeasonFolders: true,
      }

      expect(series.type).toBe(MediaType.SERIES)
      expect(series.seriesType).toBe('standard')
      expect(series.seasonCount).toBe(3)
      expect(series.seasons).toHaveLength(3)
      expect(series.ended).toBe(false)
    })

    it('should validate series type values', () => {
      const validSeriesTypes: SeriesItem['seriesType'][] = [
        'standard',
        'daily',
        'anime',
      ]

      validSeriesTypes.forEach(seriesType => {
        const series: SeriesItem = {
          id: 1,
          title: 'Test Series',
          status: MediaStatusType.CONTINUING,
          monitored: true,
          added: new Date(),
          sortTitle: 'test series',
          qualityProfileId: 1,
          languageProfileId: 1,
          tags: [],
          type: MediaType.SERIES,
          seriesType,
          seasonCount: 1,
          totalEpisodeCount: 10,
          episodeCount: 10,
          episodeFileCount: 5,
          ended: false,
          seasons: [],
          useSeasonFolders: true,
        }

        expect(series.seriesType).toBe(seriesType)
      })
    })
  })

  describe('MediaRequest Interface', () => {
    it('should define media request structure', () => {
      const request: MediaRequest = {
        type: MediaType.MOVIE,
        searchTerm: 'Test Movie',
        tmdbId: 12345,
        qualityProfileId: 1,
        rootFolderPath: '/media/movies',
        monitored: true,
        correlationId: 'request-123',
        userId: 'user-456',
        guildId: 'guild-789',
        channelId: 'channel-101',
        requestedAt: new Date('2023-01-01T10:00:00Z'),
        tags: [1, 2],
        addOptions: {
          searchForMovie: true,
        },
      }

      expect(request.type).toBe(MediaType.MOVIE)
      expect(request.searchTerm).toBe('Test Movie')
      expect(request.correlationId).toBe('request-123')
      expect(request.monitored).toBe(true)
      expect(request.addOptions?.searchForMovie).toBe(true)
    })

    it('should support both movie and series requests', () => {
      const movieRequest: MediaRequest = {
        type: MediaType.MOVIE,
        searchTerm: 'Test Movie',
        qualityProfileId: 1,
        rootFolderPath: '/media/movies',
        monitored: true,
        correlationId: 'movie-request',
        userId: 'user-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedAt: new Date(),
        addOptions: {
          searchForMovie: true,
        },
      }

      const seriesRequest: MediaRequest = {
        type: MediaType.SERIES,
        searchTerm: 'Test Series',
        qualityProfileId: 2,
        rootFolderPath: '/media/tv',
        monitored: true,
        correlationId: 'series-request',
        userId: 'user-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
        requestedAt: new Date(),
        seasonFolder: true,
        addOptions: {
          monitor: 'all',
          searchForCutoffUnmetEpisodes: true,
        },
        episodeSpecification: {
          seasons: [1, 2],
          specificationString: 'S01-S02',
          episodes: [],
        },
      }

      expect(movieRequest.type).toBe(MediaType.MOVIE)
      expect(seriesRequest.type).toBe(MediaType.SERIES)
      expect(seriesRequest.seasonFolder).toBe(true)
      expect(seriesRequest.episodeSpecification?.seasons).toEqual([1, 2])
    })
  })

  describe('SearchResult Interface', () => {
    it('should define generic search result structure', () => {
      const searchResult: SearchResult = {
        title: 'Test Result',
        overview: 'A test search result',
        year: 2023,
        tmdbId: 12345,
        posterPath: '/poster.jpg',
        monitored: false,
        hasFile: false,
        inLibrary: false,
        data: {
          // Movie-specific data
          title: 'Test Result',
          originalTitle: 'Test Result Original',
          originalLanguage: 'en',
          overview: 'A test search result',
          status: 'released' as const,
          runtime: 120,
          qualityProfileId: 1,
          tmdbId: 12345,
          year: 2023,
          genres: ['Action'],
          tags: [],
          images: [],
        },
      }

      expect(searchResult.title).toBe('Test Result')
      expect(searchResult.tmdbId).toBe(12345)
      expect(searchResult.monitored).toBe(false)
      expect(searchResult.data).toBeDefined()
    })
  })

  describe('QualityProfile Interface', () => {
    it('should define quality profile structure', () => {
      const qualityProfile: QualityProfile = {
        id: 1,
        name: 'HD - 1080p',
        upgradeAllowed: true,
        cutoff: 7,
        items: [
          {
            quality: {
              id: 7,
              name: 'Bluray-1080p',
              source: 'bluray',
              resolution: 1080,
            },
            allowed: true,
          },
        ],
        minFormatScore: 0,
        cutoffFormatScore: 100,
        formatItems: [
          {
            format: 1,
            name: 'REMUX',
            score: 100,
          },
        ],
      }

      expect(qualityProfile.id).toBe(1)
      expect(qualityProfile.name).toBe('HD - 1080p')
      expect(qualityProfile.upgradeAllowed).toBe(true)
      expect(qualityProfile.items).toHaveLength(1)
      expect(qualityProfile.formatItems).toHaveLength(1)
    })
  })

  describe('MediaStatus Interface', () => {
    it('should define media status structure', () => {
      const mediaStatus: MediaStatus = {
        id: 1,
        downloadId: 'download-123',
        title: 'Test Download',
        status: QueueStatusType.DOWNLOADING,
        trackedDownloadStatus: TrackedDownloadStatusType.OK,
        trackedDownloadState: TrackedDownloadStateType.DOWNLOADING,
        size: 1073741824, // 1GB
        sizeleft: 536870912, // 512MB
        percentage: 50,
        timeleft: '00:30:00',
        eta: new Date(Date.now() + 30 * 60 * 1000),
        added: new Date('2023-01-01T10:00:00Z'),
        statusMessages: [
          {
            title: 'Download Progress',
            messages: ['50% completed'],
          },
        ],
        downloadClient: 'qBittorrent',
        indexer: 'Test Indexer',
        outputPath: '/downloads/complete',
      }

      expect(mediaStatus.id).toBe(1)
      expect(mediaStatus.status).toBe(QueueStatusType.DOWNLOADING)
      expect(mediaStatus.percentage).toBe(50)
      expect(mediaStatus.statusMessages).toHaveLength(1)
    })

    it('should be readonly to prevent accidental modification', () => {
      const mediaStatus: MediaStatus = {
        id: 1,
        title: 'Test',
        status: QueueStatusType.COMPLETED,
        trackedDownloadStatus: TrackedDownloadStatusType.OK,
        trackedDownloadState: TrackedDownloadStateType.IMPORTING,
        size: 1000,
        sizeleft: 0,
        percentage: 100,
        timeleft: '00:00:00',
        statusMessages: [],
      }

      // TypeScript should prevent modification of readonly properties
      // mediaStatus.id = 2; // This should cause a TypeScript error
      // mediaStatus.size = 2000; // This should cause a TypeScript error

      expect(mediaStatus.id).toBe(1)
      expect(mediaStatus.size).toBe(1000)
    })
  })

  describe('StorageMetrics Interface', () => {
    it('should define storage metrics structure', () => {
      const storageMetrics: StorageMetrics = {
        path: '/media',
        label: 'Media Storage',
        freeSpace: 536870912000, // 500GB
        totalSpace: 1073741824000, // 1TB
        usedSpace: 536870912000, // 500GB
        percentUsed: 50,
        accessible: true,
      }

      expect(storageMetrics.path).toBe('/media')
      expect(storageMetrics.totalSpace).toBe(1073741824000)
      expect(storageMetrics.percentUsed).toBe(50)
      expect(storageMetrics.accessible).toBe(true)
    })

    it('should calculate used space correctly', () => {
      const metrics: StorageMetrics = {
        path: '/test',
        label: 'Test Storage',
        freeSpace: 250000000000, // 250GB free
        totalSpace: 1000000000000, // 1TB total
        usedSpace: 750000000000, // 750GB used
        percentUsed: 75,
        accessible: true,
      }

      // Verify the math
      expect(metrics.usedSpace + metrics.freeSpace).toBe(metrics.totalSpace)
      expect(metrics.percentUsed).toBe(75)
      expect((metrics.usedSpace / metrics.totalSpace) * 100).toBe(
        metrics.percentUsed,
      )
    })
  })

  describe('Type Relationships and Validation', () => {
    it('should maintain type safety across related interfaces', () => {
      const movie: MovieItem = {
        id: 1,
        title: 'Test Movie',
        status: MediaStatusType.RELEASED,
        monitored: true,
        added: new Date(),
        sortTitle: 'test movie',
        qualityProfileId: 1,
        tags: [],
        type: MediaType.MOVIE,
        genres: [],
        minimumAvailability: 'released',
        hasFile: true,
      }

      const request: MediaRequest = {
        type: movie.type, // Should be type-compatible
        searchTerm: movie.title,
        qualityProfileId: movie.qualityProfileId,
        rootFolderPath: '/media/movies',
        monitored: movie.monitored,
        correlationId: 'test-correlation',
        userId: 'test-user',
        guildId: 'test-guild',
        channelId: 'test-channel',
        requestedAt: new Date(),
      }

      expect(request.type).toBe(MediaType.MOVIE)
      expect(request.monitored).toBe(movie.monitored)
    })

    it('should enforce enum constraints in interfaces', () => {
      // This function should only accept valid enum values
      function createMediaStatus(status: QueueStatusType): MediaStatus {
        return {
          id: 1,
          title: 'Test',
          status,
          trackedDownloadStatus: TrackedDownloadStatusType.OK,
          trackedDownloadState: TrackedDownloadStateType.DOWNLOADING,
          size: 1000,
          sizeleft: 500,
          percentage: 50,
          timeleft: '00:30:00',
          statusMessages: [],
        }
      }

      const downloadingStatus = createMediaStatus(QueueStatusType.DOWNLOADING)
      const completedStatus = createMediaStatus(QueueStatusType.COMPLETED)

      expect(downloadingStatus.status).toBe(QueueStatusType.DOWNLOADING)
      expect(completedStatus.status).toBe(QueueStatusType.COMPLETED)
    })
  })
})
