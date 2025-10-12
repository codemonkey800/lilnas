import { SchedulerRegistry } from '@nestjs/schedule'
import { Test, TestingModule } from '@nestjs/testing'

import { CONTEXT_TTL_MS } from 'src/constants/context'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { MovieDeleteContext, MovieSelectionContext } from 'src/schemas/movie'
import {
  TvShowDeleteContext,
  TvShowSelectionContext,
} from 'src/schemas/tv-show'

// Context type constants to prevent typos and ensure consistency
const CONTEXT_TYPES = {
  MOVIE_DOWNLOAD: 'movieDownload',
  TV_DOWNLOAD: 'tvDownload',
  MOVIE_DELETE: 'movieDelete',
  TV_DELETE: 'tvDelete',
} as const

describe('ContextManagementService', () => {
  let service: ContextManagementService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ContextManagementService,
        {
          provide: SchedulerRegistry,
          useValue: {
            addCronJob: jest.fn(),
            deleteCronJob: jest.fn(),
            getCronJob: jest.fn(),
          },
        },
      ],
    }).compile()

    service = module.get<ContextManagementService>(ContextManagementService)
  })

  describe('setContext', () => {
    it('should set a context for a user', async () => {
      const userId = 'user123'
      const context: MovieSelectionContext = {
        searchResults: [],
        query: 'test movie',
        timestamp: Date.now(),
        isActive: true,
      }

      await service.setContext(userId, CONTEXT_TYPES.MOVIE_DOWNLOAD, context)

      const retrievedContext =
        await service.getContext<MovieSelectionContext>(userId)
      expect(retrievedContext).toEqual(context)
    })

    it('should replace existing context for a user', async () => {
      const userId = 'user123'
      const firstContext: MovieSelectionContext = {
        searchResults: [],
        query: 'first movie',
        timestamp: Date.now(),
        isActive: true,
      }
      const secondContext: TvShowSelectionContext = {
        searchResults: [],
        query: 'tv show',
        timestamp: Date.now(),
        isActive: true,
        originalSearchSelection: undefined,
        originalTvSelection: undefined,
      }

      await service.setContext(
        userId,
        CONTEXT_TYPES.MOVIE_DOWNLOAD,
        firstContext,
      )
      await service.setContext(userId, CONTEXT_TYPES.TV_DOWNLOAD, secondContext)

      const retrievedContext =
        await service.getContext<TvShowSelectionContext>(userId)
      const contextType = await service.getContextType(userId)

      expect(retrievedContext).toEqual(secondContext)
      expect(contextType).toBe(CONTEXT_TYPES.TV_DOWNLOAD)
    })
  })

  describe('getContext', () => {
    it('should return null for non-existent user', async () => {
      const context = await service.getContext('nonexistent')
      expect(context).toBeNull()
    })

    it('should return null for expired context', async () => {
      const userId = 'user123'
      const context: MovieSelectionContext = {
        searchResults: [],
        query: 'test movie',
        timestamp: Date.now(),
        isActive: true,
      }

      await service.setContext(userId, CONTEXT_TYPES.MOVIE_DOWNLOAD, context)

      // Mock time to simulate expiration
      const originalDateNow = Date.now
      Date.now = jest.fn(() => originalDateNow() + CONTEXT_TTL_MS + 1000)

      try {
        const retrievedContext = await service.getContext(userId)
        expect(retrievedContext).toBeNull()

        // Verify context was removed
        const hasContext = await service.hasContext(userId)
        expect(hasContext).toBe(false)
      } finally {
        Date.now = originalDateNow
      }
    })
  })

  describe('clearContext', () => {
    it('should clear existing context', async () => {
      const userId = 'user123'
      const context: MovieSelectionContext = {
        searchResults: [],
        query: 'test movie',
        timestamp: Date.now(),
        isActive: true,
      }

      await service.setContext(userId, CONTEXT_TYPES.MOVIE_DOWNLOAD, context)
      const cleared = await service.clearContext(userId)

      expect(cleared).toBe(true)

      const retrievedContext = await service.getContext(userId)
      expect(retrievedContext).toBeNull()
    })
  })

  describe('hasContext', () => {
    it('should return true for existing context', async () => {
      const userId = 'user123'
      const context: MovieSelectionContext = {
        searchResults: [],
        query: 'test movie',
        timestamp: Date.now(),
        isActive: true,
      }

      await service.setContext(userId, CONTEXT_TYPES.MOVIE_DOWNLOAD, context)

      const hasContext = await service.hasContext(userId)
      expect(hasContext).toBe(true)
    })

    it('should return false for expired context and remove it', async () => {
      const userId = 'user123'
      const context: MovieSelectionContext = {
        searchResults: [],
        query: 'test movie',
        timestamp: Date.now(),
        isActive: true,
      }

      await service.setContext(userId, CONTEXT_TYPES.MOVIE_DOWNLOAD, context)

      // Mock time to simulate expiration
      const originalDateNow = Date.now
      Date.now = jest.fn(() => originalDateNow() + CONTEXT_TTL_MS + 1000)

      try {
        const hasContext = await service.hasContext(userId)
        expect(hasContext).toBe(false)

        // Verify context was removed
        const retrievedContext = await service.getContext(userId)
        expect(retrievedContext).toBeNull()
      } finally {
        Date.now = originalDateNow
      }
    })
  })

  describe('getContextType', () => {
    it('should return context type for existing context', async () => {
      const userId = 'user123'
      const context: MovieSelectionContext = {
        searchResults: [],
        query: 'test movie',
        timestamp: Date.now(),
        isActive: true,
      }

      await service.setContext(userId, CONTEXT_TYPES.MOVIE_DOWNLOAD, context)

      const contextType = await service.getContextType(userId)
      expect(contextType).toBe(CONTEXT_TYPES.MOVIE_DOWNLOAD)
    })
  })

  describe('concurrent operations', () => {
    it('should handle concurrent setContext operations safely', async () => {
      const userId = 'user123'
      const contexts: MovieSelectionContext[] = Array.from(
        { length: 10 },
        (_, i) => ({
          searchResults: [],
          query: `movie ${i}`,
          timestamp: Date.now(),
          isActive: true,
        }),
      )

      // Perform concurrent set operations
      const setPromises = contexts.map(context =>
        service.setContext(userId, CONTEXT_TYPES.MOVIE_DOWNLOAD, context),
      )

      await Promise.all(setPromises)

      // Should have exactly one context (the last one set)
      const finalContext =
        await service.getContext<MovieSelectionContext>(userId)
      const hasContext = await service.hasContext(userId)
      const contextType = await service.getContextType(userId)

      expect(finalContext).toBeTruthy()
      expect(hasContext).toBe(true)
      expect(contextType).toBe(CONTEXT_TYPES.MOVIE_DOWNLOAD)
      expect(finalContext?.query).toMatch(/movie \d/)
    })

    it('should handle concurrent read/write operations safely', async () => {
      const userId = 'user123'
      const context: MovieSelectionContext = {
        searchResults: [],
        query: 'test movie',
        timestamp: Date.now(),
        isActive: true,
      }

      await service.setContext(userId, CONTEXT_TYPES.MOVIE_DOWNLOAD, context)

      // Perform concurrent read operations
      const readPromises = Array.from({ length: 10 }, () =>
        Promise.all([
          service.getContext(userId),
          service.hasContext(userId),
          service.getContextType(userId),
        ]),
      )

      const results = await Promise.all(readPromises)

      // All reads should return consistent results
      results.forEach(([ctx, hasCtx, ctxType]) => {
        expect(ctx).toEqual(context)
        expect(hasCtx).toBe(true)
        expect(ctxType).toBe(CONTEXT_TYPES.MOVIE_DOWNLOAD)
      })
    })
  })

  describe('edge cases and error handling', () => {
    it('should handle all 4 context types correctly', async () => {
      const userId = 'user123'

      // Define all 4 context types
      const movieDownloadContext: MovieSelectionContext = {
        searchResults: [],
        query: 'test movie download',
        timestamp: Date.now(),
        isActive: true,
      }

      const tvDownloadContext: TvShowSelectionContext = {
        searchResults: [],
        query: 'test tv download',
        timestamp: Date.now(),
        isActive: true,
        originalSearchSelection: undefined,
        originalTvSelection: undefined,
      }

      const movieDeleteContext: MovieDeleteContext = {
        searchResults: [],
        query: 'test movie delete',
        timestamp: Date.now(),
        isActive: true,
      }

      const tvDeleteContext: TvShowDeleteContext = {
        searchResults: [],
        query: 'test tv delete',
        timestamp: Date.now(),
        isActive: true,
        originalSearchSelection: undefined,
        originalTvSelection: undefined,
      }

      // Test movie download context
      await service.setContext(
        userId,
        CONTEXT_TYPES.MOVIE_DOWNLOAD,
        movieDownloadContext,
      )
      expect(await service.getContextType(userId)).toBe(
        CONTEXT_TYPES.MOVIE_DOWNLOAD,
      )
      expect(await service.getContext<MovieSelectionContext>(userId)).toEqual(
        movieDownloadContext,
      )

      // Test TV download context
      await service.setContext(
        userId,
        CONTEXT_TYPES.TV_DOWNLOAD,
        tvDownloadContext,
      )
      expect(await service.getContextType(userId)).toBe(
        CONTEXT_TYPES.TV_DOWNLOAD,
      )
      expect(await service.getContext<TvShowSelectionContext>(userId)).toEqual(
        tvDownloadContext,
      )

      // Test movie delete context
      await service.setContext(
        userId,
        CONTEXT_TYPES.MOVIE_DELETE,
        movieDeleteContext,
      )
      expect(await service.getContextType(userId)).toBe(
        CONTEXT_TYPES.MOVIE_DELETE,
      )
      expect(await service.getContext<MovieDeleteContext>(userId)).toEqual(
        movieDeleteContext,
      )

      // Test TV delete context
      await service.setContext(userId, CONTEXT_TYPES.TV_DELETE, tvDeleteContext)
      expect(await service.getContextType(userId)).toBe(CONTEXT_TYPES.TV_DELETE)
      expect(await service.getContext<TvShowDeleteContext>(userId)).toEqual(
        tvDeleteContext,
      )
    })

    it('should handle multiple users with different context types independently', async () => {
      const user1 = 'user1'
      const user2 = 'user2'
      const user3 = 'user3'
      const user4 = 'user4'

      const movieDownloadContext: MovieSelectionContext = {
        searchResults: [],
        query: 'user1 movie download',
        timestamp: Date.now(),
        isActive: true,
      }

      const tvDownloadContext: TvShowSelectionContext = {
        searchResults: [],
        query: 'user2 tv download',
        timestamp: Date.now(),
        isActive: true,
        originalSearchSelection: undefined,
        originalTvSelection: undefined,
      }

      const movieDeleteContext: MovieDeleteContext = {
        searchResults: [],
        query: 'user3 movie delete',
        timestamp: Date.now(),
        isActive: true,
      }

      const tvDeleteContext: TvShowDeleteContext = {
        searchResults: [],
        query: 'user4 tv delete',
        timestamp: Date.now(),
        isActive: true,
        originalSearchSelection: undefined,
        originalTvSelection: undefined,
      }

      // Set different context types for different users
      await service.setContext(
        user1,
        CONTEXT_TYPES.MOVIE_DOWNLOAD,
        movieDownloadContext,
      )
      await service.setContext(
        user2,
        CONTEXT_TYPES.TV_DOWNLOAD,
        tvDownloadContext,
      )
      await service.setContext(
        user3,
        CONTEXT_TYPES.MOVIE_DELETE,
        movieDeleteContext,
      )
      await service.setContext(user4, CONTEXT_TYPES.TV_DELETE, tvDeleteContext)

      // Verify each user has their own independent context
      expect(await service.getContext<MovieSelectionContext>(user1)).toEqual(
        movieDownloadContext,
      )
      expect(await service.getContext<TvShowSelectionContext>(user2)).toEqual(
        tvDownloadContext,
      )
      expect(await service.getContext<MovieDeleteContext>(user3)).toEqual(
        movieDeleteContext,
      )
      expect(await service.getContext<TvShowDeleteContext>(user4)).toEqual(
        tvDeleteContext,
      )

      // Verify context types
      expect(await service.getContextType(user1)).toBe(
        CONTEXT_TYPES.MOVIE_DOWNLOAD,
      )
      expect(await service.getContextType(user2)).toBe(
        CONTEXT_TYPES.TV_DOWNLOAD,
      )
      expect(await service.getContextType(user3)).toBe(
        CONTEXT_TYPES.MOVIE_DELETE,
      )
      expect(await service.getContextType(user4)).toBe(CONTEXT_TYPES.TV_DELETE)

      // Clearing one shouldn't affect the others
      await service.clearContext(user1)
      expect(await service.hasContext(user1)).toBe(false)
      expect(await service.hasContext(user2)).toBe(true)
      expect(await service.hasContext(user3)).toBe(true)
      expect(await service.hasContext(user4)).toBe(true)
    })

    it('should handle empty and special string user IDs', async () => {
      const specialUserIds = [
        '',
        '   ',
        'user-with-dashes',
        'user.with.dots',
        'user@with@symbols',
      ]
      const context: MovieSelectionContext = {
        searchResults: [],
        query: 'test movie',
        timestamp: Date.now(),
        isActive: true,
      }

      for (const userId of specialUserIds) {
        await service.setContext(userId, CONTEXT_TYPES.MOVIE_DOWNLOAD, context)
        expect(await service.hasContext(userId)).toBe(true)
        expect(await service.getContext<MovieSelectionContext>(userId)).toEqual(
          context,
        )
        await service.clearContext(userId)
        expect(await service.hasContext(userId)).toBe(false)
      }
    })

    it('should preserve context data integrity during expiration checks', async () => {
      const userId = 'user123'
      const originalContext: MovieSelectionContext = {
        searchResults: [{ title: 'Test Movie', year: 2023 }],
        query: 'test movie',
        timestamp: Date.now(),
        isActive: true,
      }

      await service.setContext(
        userId,
        CONTEXT_TYPES.MOVIE_DOWNLOAD,
        originalContext,
      )

      // Multiple reads should return identical data
      const read1 = await service.getContext<MovieSelectionContext>(userId)
      const read2 = await service.getContext<MovieSelectionContext>(userId)
      const read3 = await service.getContext<MovieSelectionContext>(userId)

      expect(read1).toEqual(originalContext)
      expect(read2).toEqual(originalContext)
      expect(read3).toEqual(originalContext)
      expect(read1).toEqual(read2)
      expect(read2).toEqual(read3)
    })

    it('should handle workflow context switching correctly', async () => {
      const userId = 'workflow-user'

      const movieDownloadContext: MovieSelectionContext = {
        searchResults: [{ title: 'Download Movie', year: 2023 }],
        query: 'download movie test',
        timestamp: Date.now(),
        isActive: true,
      }

      const movieDeleteContext: MovieDeleteContext = {
        searchResults: [{ title: 'Delete Movie', year: 2023 }],
        query: 'delete movie test',
        timestamp: Date.now(),
        isActive: true,
      }

      // Start with download workflow
      await service.setContext(
        userId,
        CONTEXT_TYPES.MOVIE_DOWNLOAD,
        movieDownloadContext,
      )
      expect(await service.getContextType(userId)).toBe(
        CONTEXT_TYPES.MOVIE_DOWNLOAD,
      )
      expect(await service.getContext<MovieSelectionContext>(userId)).toEqual(
        movieDownloadContext,
      )

      // Switch to delete workflow (should replace download context)
      await service.setContext(
        userId,
        CONTEXT_TYPES.MOVIE_DELETE,
        movieDeleteContext,
      )
      expect(await service.getContextType(userId)).toBe(
        CONTEXT_TYPES.MOVIE_DELETE,
      )
      expect(await service.getContext<MovieDeleteContext>(userId)).toEqual(
        movieDeleteContext,
      )

      // Verify download context was replaced
      const downloadContext =
        await service.getContext<MovieSelectionContext>(userId)
      expect(downloadContext).not.toEqual(movieDownloadContext)
    })

    it('should handle expiration for all context types', async () => {
      const userId = 'expiration-user'

      const contexts = {
        movieDownload: {
          searchResults: [],
          query: 'movie download',
          timestamp: Date.now(),
          isActive: true,
        },
        tvDownload: {
          searchResults: [],
          query: 'tv download',
          timestamp: Date.now(),
          isActive: true,
          originalSearchSelection: undefined,
          originalTvSelection: undefined,
        },
        movieDelete: {
          searchResults: [],
          query: 'movie delete',
          timestamp: Date.now(),
          isActive: true,
        },
        tvDelete: {
          searchResults: [],
          query: 'tv delete',
          timestamp: Date.now(),
          isActive: true,
          originalSearchSelection: undefined,
          originalTvSelection: undefined,
        },
      }

      // Test expiration for each context type
      const contextTests = [
        { type: CONTEXT_TYPES.MOVIE_DOWNLOAD, context: contexts.movieDownload },
        { type: CONTEXT_TYPES.TV_DOWNLOAD, context: contexts.tvDownload },
        { type: CONTEXT_TYPES.MOVIE_DELETE, context: contexts.movieDelete },
        { type: CONTEXT_TYPES.TV_DELETE, context: contexts.tvDelete },
      ]

      for (const { type, context } of contextTests) {
        await service.setContext(userId, type, context)
        expect(await service.hasContext(userId)).toBe(true)

        // Mock time to simulate expiration
        const originalDateNow = Date.now
        Date.now = jest.fn(() => originalDateNow() + CONTEXT_TTL_MS + 1000)

        try {
          expect(await service.getContext(userId)).toBeNull()
          expect(await service.hasContext(userId)).toBe(false)
          expect(await service.getContextType(userId)).toBeNull()
        } finally {
          Date.now = originalDateNow
        }
      }
    })
  })
})
