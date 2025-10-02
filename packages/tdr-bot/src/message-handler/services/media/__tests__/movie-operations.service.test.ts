import { HumanMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { Test, TestingModule } from '@nestjs/testing'
import { nanoid } from 'nanoid'

// Mock ChatOpenAI to prevent actual LLM calls
const mockChatOpenAI = jest.fn().mockImplementation(() => ({
  invoke: jest.fn().mockImplementation(messages => {
    try {
      // Check if this is a search selection parsing request
      const systemMessage = typeof messages?.[0]?.content === 'string' ? messages[0].content : ''
      const content = messages?.[1]?.content !== undefined ? messages[1].content : (messages?.[0]?.content || '')

      // If content is a number, return ordinal selection for selection parsing
      if (/^\d+$/.test(String(content))) {
        return Promise.resolve({
          content: {
            toString: () => JSON.stringify({
              selectionType: 'ordinal',
              value: String(content),
            }),
          },
        })
      }

      // For search query extraction, extract the movie name
      if (String(systemMessage).toLowerCase().includes('extract the movie search query')) {
        // Extract search term from common patterns, removing only action words
        const cleanedContent = String(content)
          .replace(/\b(download|add|get|find|search for|look for|want|need|delete|remove)\s+/gi, '')
          .trim()
        // Return the cleaned content (may be empty string)
        return Promise.resolve({
          content: {
            toString: () => cleanedContent,
          },
        })
      }

      // Default response for other cases
      return Promise.resolve({
        content: {
          toString: () => 'test movie',
        },
      })
    } catch (error) {
      // Fallback in case of any errors
      return Promise.resolve({
        content: {
          toString: () => '',
        },
      })
    }
  }),
}))

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: mockChatOpenAI,
}))

import { RadarrService } from 'src/media/services/radarr.service'
import {
  MovieLibrarySearchResult,
  MovieSearchResult,
  RadarrMinimumAvailability,
  RadarrMovieStatus,
} from 'src/media/types/radarr.types'
import { ContextManagementService } from 'src/message-handler/context/context-management.service'
import { MovieOperationsService } from 'src/message-handler/services/media/movie-operations.service'
import { PromptGenerationService } from 'src/message-handler/services/prompts/prompt-generation.service'
import { MovieDeleteContext, MovieSelectionContext } from 'src/schemas/movie'
import { StateService } from 'src/state/state.service'
import { RetryService } from 'src/utils/retry.service'

// Type definitions for testing
interface MockRadarrService {
  searchMovies: jest.MockedFunction<RadarrService['searchMovies']>
  monitorAndDownloadMovie: jest.MockedFunction<
    RadarrService['monitorAndDownloadMovie']
  >
  getLibraryMovies: jest.MockedFunction<RadarrService['getLibraryMovies']>
  unmonitorAndDeleteMovie: jest.MockedFunction<
    RadarrService['unmonitorAndDeleteMovie']
  >
}

interface MockContextManagementService {
  setContext: jest.MockedFunction<ContextManagementService['setContext']>
  getContext: jest.MockedFunction<ContextManagementService['getContext']>
  clearContext: jest.MockedFunction<ContextManagementService['clearContext']>
  hasContext: jest.MockedFunction<ContextManagementService['hasContext']>
  getContextType: jest.MockedFunction<
    ContextManagementService['getContextType']
  >
}

interface MockPromptGenerationService {
  generateMoviePrompt: jest.MockedFunction<
    PromptGenerationService['generateMoviePrompt']
  >
  generateMovieDeletePrompt: jest.MockedFunction<
    PromptGenerationService['generateMovieDeletePrompt']
  >
}

describe('MovieOperationsService', () => {
  let service: MovieOperationsService
  let radarrService: MockRadarrService
  let contextService: MockContextManagementService
  let promptService: MockPromptGenerationService

  const mockMovieSearchResults: MovieSearchResult[] = [
    {
      tmdbId: 123,
      title: 'Test Movie 1',
      year: 2020,
      overview: 'A test movie',
      rating: 8.5,
      genres: ['Action', 'Drama'],
      status: RadarrMovieStatus.RELEASED,
    },
    {
      tmdbId: 456,
      title: 'Test Movie 2',
      year: 2021,
      overview: 'Another test movie',
      rating: 7.2,
      genres: ['Comedy'],
      status: RadarrMovieStatus.RELEASED,
    },
  ]

  const mockLibrarySearchResults: MovieLibrarySearchResult[] = [
    {
      tmdbId: 789,
      title: 'Library Movie 1',
      year: 2019,
      rating: 6.8,
      hasFile: true,
      genres: ['Horror'],
      status: RadarrMovieStatus.RELEASED,
      id: 1,
      monitored: true,
      path: '/movies/library-movie-1',
      added: '2019-01-01T00:00:00Z',
      qualityProfileId: 1,
      rootFolderPath: '/movies',
      minimumAvailability: RadarrMinimumAvailability.RELEASED,
      isAvailable: true,
    },
    {
      tmdbId: 101112,
      title: 'Library Movie 2',
      year: 2022,
      rating: 9.1,
      hasFile: false,
      genres: ['Sci-Fi'],
      status: RadarrMovieStatus.RELEASED,
      id: 2,
      monitored: true,
      path: '/movies/library-movie-2',
      added: '2022-01-01T00:00:00Z',
      qualityProfileId: 1,
      rootFolderPath: '/movies',
      minimumAvailability: RadarrMinimumAvailability.RELEASED,
      isAvailable: true,
    },
  ]

  const mockHumanMessage = new HumanMessage({
    id: nanoid(),
    content: 'search for test movie',
  })

  const mockMessages = [mockHumanMessage]
  const mockUserId = 'test-user-123'

  beforeEach(async () => {
    const mockRadarrService = {
      searchMovies: jest.fn(),
      monitorAndDownloadMovie: jest.fn(),
      getLibraryMovies: jest.fn(),
      unmonitorAndDeleteMovie: jest.fn(),
    }

    const mockContextService = {
      setContext: jest.fn(),
      getContext: jest.fn(),
      clearContext: jest.fn(),
      hasContext: jest.fn(),
      getContextType: jest.fn(),
    }

    const mockPromptService = {
      generateMoviePrompt: jest.fn(),
      generateMovieDeletePrompt: jest.fn(),
    }

    const mockRetryService = {
      executeWithRetry: jest.fn().mockImplementation((fn) => fn()),
    }

    const mockStateService = {
      getState: jest.fn().mockReturnValue({
        reasoningModel: 'gpt-4-turbo-preview',
        chatModel: 'gpt-4-turbo-preview',
        temperature: 0,
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MovieOperationsService,
        { provide: RadarrService, useValue: mockRadarrService },
        { provide: ContextManagementService, useValue: mockContextService },
        { provide: PromptGenerationService, useValue: mockPromptService },
        { provide: RetryService, useValue: mockRetryService },
        { provide: StateService, useValue: mockStateService },
      ],
    }).compile()

    service = module.get<MovieOperationsService>(MovieOperationsService)
    radarrService = module.get(RadarrService) as MockRadarrService
    contextService = module.get(
      ContextManagementService,
    ) as MockContextManagementService
    promptService = module.get(
      PromptGenerationService,
    ) as MockPromptGenerationService

    // Setup common mock implementations
    promptService.generateMoviePrompt.mockResolvedValue(
      new HumanMessage({ id: nanoid(), content: 'Mock movie response' }),
    )
    promptService.generateMovieDeletePrompt.mockResolvedValue(
      new HumanMessage({ id: nanoid(), content: 'Mock delete response' }),
    )
  })

  describe('handleSearch', () => {
    it('should return clarification when search query is empty', async () => {
      const emptyMessage = new HumanMessage({
        id: nanoid(),
        content: '',
      })

      const _result = await service.handleSearch(
        emptyMessage,
        [emptyMessage],
        mockUserId,
      )

      expect(_result).toEqual({
        images: [],
        messages: [emptyMessage].concat(expect.any(HumanMessage)),
      })
      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        [emptyMessage],
        expect.anything(),
        'clarification',
        undefined,
      )
    })

    it('should return no results when search finds nothing', async () => {
      radarrService.searchMovies.mockResolvedValue([])

      const _result = await service.handleSearch(
        mockHumanMessage,
        mockMessages,
        mockUserId,
      )

      expect(_result).toEqual({
        images: [],
        messages: mockMessages.concat(expect.any(HumanMessage)),
      })
      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        mockMessages,
        expect.anything(),
        'no_results',
        { searchQuery: 'test movie' },
      )
    })

    it('should auto-download single result', async () => {
      radarrService.searchMovies.mockResolvedValue([mockMovieSearchResults[0]])
      radarrService.monitorAndDownloadMovie.mockResolvedValue({
        success: true,
        movieAdded: true,
        searchTriggered: true,
      })

      const _result = await service.handleSearch(
        mockHumanMessage,
        mockMessages,
        mockUserId,
      )

      expect(radarrService.monitorAndDownloadMovie).toHaveBeenCalledWith(123)
      expect(_result).toEqual({
        images: [],
        messages: mockMessages.concat(expect.any(HumanMessage)),
      })
    })

    it('should store context and ask for selection with multiple results', async () => {
      radarrService.searchMovies.mockResolvedValue(mockMovieSearchResults)

      await service.handleSearch(mockHumanMessage, mockMessages, mockUserId)

      expect(contextService.setContext).toHaveBeenCalledWith(
        mockUserId,
        'movie_selection',
        expect.objectContaining({
          searchResults: mockMovieSearchResults,
          query: 'test movie',
          isActive: true,
        }),
      )
      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        mockMessages,
        expect.anything(),
        'multiple_results',
        {
          searchQuery: 'test movie',
          movies: mockMovieSearchResults,
        },
      )
    })

    it('should handle download failure gracefully', async () => {
      radarrService.searchMovies.mockResolvedValue([mockMovieSearchResults[0]])
      radarrService.monitorAndDownloadMovie.mockResolvedValue({
        success: false,
        movieAdded: false,
        searchTriggered: false,
        error: 'Download failed',
      })

      const result = await service.handleSearch(
        mockHumanMessage,
        mockMessages,
        mockUserId,
      )

      expect(result).toEqual({
        images: [],
        messages: mockMessages.concat(expect.any(HumanMessage)),
      })
      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        mockMessages,
        expect.anything(),
        'error',
        expect.objectContaining({
          errorMessage: expect.stringContaining('Failed to download'),
        }),
      )
    })

    it('should handle search error gracefully', async () => {
      const error = new Error('Radarr service unavailable')
      radarrService.searchMovies.mockRejectedValue(error)

      const result = await service.handleSearch(
        mockHumanMessage,
        mockMessages,
        mockUserId,
      )

      expect(result).toEqual({
        images: [],
        messages: mockMessages.concat(expect.any(HumanMessage)),
      })
      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        mockMessages,
        expect.anything(),
        'error',
        expect.objectContaining({
          errorMessage: expect.stringContaining("Had trouble search for"),
        }),
      )
    })
  })

  describe('handleSelection', () => {
    const mockMovieContext: MovieSelectionContext = {
      searchResults: mockMovieSearchResults,
      query: 'test movie',
      timestamp: Date.now(),
      isActive: true,
    }

    beforeEach(() => {
      radarrService.monitorAndDownloadMovie.mockResolvedValue({
        success: true,
        movieAdded: true,
        searchTriggered: true,
      })
    })

    it('should process valid selection and download movie', async () => {
      const selectionMessage = new HumanMessage({
        id: nanoid(),
        content: '1',
      })

      const result = await service.handleSelection(
        selectionMessage,
        [selectionMessage],
        mockMovieContext,
        mockUserId,
      )

      expect(contextService.clearContext).toHaveBeenCalledWith(mockUserId)
      expect(result).toEqual({
        images: [],
        messages: [selectionMessage].concat(expect.any(HumanMessage)),
      })
    })

    it('should ask for clarification when selection is invalid', async () => {
      const invalidSelectionMessage = new HumanMessage({
        id: nanoid(),
        content: 'invalid selection',
      })

      await service.handleSelection(
        invalidSelectionMessage,
        [invalidSelectionMessage],
        mockMovieContext,
        mockUserId,
      )

      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        [invalidSelectionMessage],
        expect.anything(),
        expect.stringMatching(/(multiple_results|clarification)/),
        expect.objectContaining({
          searchQuery: mockMovieContext.query,
        }),
      )
    })

    it('should ask for clarification when movie not found', async () => {
      const invalidIndexMessage = new HumanMessage({
        id: nanoid(),
        content: '999', // Invalid index
      })

      await service.handleSelection(
        invalidIndexMessage,
        [invalidIndexMessage],
        mockMovieContext,
        mockUserId,
      )

      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        [invalidIndexMessage],
        expect.anything(),
        expect.stringMatching(/(multiple_results|clarification)/),
        expect.objectContaining({
          searchQuery: mockMovieContext.query,
        }),
      )
    })
  })

  describe('handleDelete', () => {
    it('should return clarification when search query is empty', async () => {
      const emptyMessage = new HumanMessage({
        id: nanoid(),
        content: '',
      })

      await service.handleDelete(emptyMessage, [emptyMessage], mockUserId)

      expect(promptService.generateMovieDeletePrompt).toHaveBeenCalledWith(
        [emptyMessage],
        expect.anything(),
        'clarification_delete',
        undefined,
      )
    })

    it('should return no results when library search finds nothing', async () => {
      radarrService.getLibraryMovies.mockResolvedValue([])

      const result = await service.handleDelete(
        mockHumanMessage,
        mockMessages,
        mockUserId,
      )

      expect(result).toEqual({
        images: [],
        messages: mockMessages.concat(expect.any(HumanMessage)),
      })
      expect(promptService.generateMovieDeletePrompt).toHaveBeenCalledWith(
        mockMessages,
        expect.anything(),
        'no_results_delete',
        expect.objectContaining({
          searchQuery: expect.any(String),
        }),
      )
    })

    it('should auto-delete single result', async () => {
      radarrService.getLibraryMovies.mockResolvedValue([
        mockLibrarySearchResults[0],
      ])
      radarrService.unmonitorAndDeleteMovie.mockResolvedValue({
        success: true,
        movieDeleted: true,
        filesDeleted: true,
      })

      const _result = await service.handleDelete(
        mockHumanMessage,
        mockMessages,
        mockUserId,
      )

      expect(radarrService.unmonitorAndDeleteMovie).toHaveBeenCalledWith(789, {
        deleteFiles: true,
      })
      expect(_result).toEqual({
        images: [],
        messages: mockMessages.concat(expect.any(HumanMessage)),
      })
    })

    it('should handle delete failure gracefully', async () => {
      radarrService.getLibraryMovies.mockResolvedValue([
        mockLibrarySearchResults[0],
      ])
      radarrService.unmonitorAndDeleteMovie.mockResolvedValue({
        success: false,
        movieDeleted: false,
        filesDeleted: false,
        error: 'Delete failed',
      })

      const result = await service.handleDelete(
        mockHumanMessage,
        mockMessages,
        mockUserId,
      )

      expect(result).toEqual({
        images: [],
        messages: mockMessages.concat(expect.any(HumanMessage)),
      })
      expect(promptService.generateMovieDeletePrompt).toHaveBeenCalledWith(
        mockMessages,
        expect.anything(),
        'error_delete',
        expect.objectContaining({
          errorMessage: expect.stringContaining('Failed to delete'),
        }),
      )
    })

    it('should store delete context with multiple results', async () => {
      radarrService.getLibraryMovies.mockResolvedValue(mockLibrarySearchResults)

      await service.handleDelete(mockHumanMessage, mockMessages, mockUserId)

      expect(contextService.setContext).toHaveBeenCalledWith(
        mockUserId,
        'movie_delete',
        expect.objectContaining({
          searchResults: mockLibrarySearchResults,
          query: 'test movie',
          isActive: true,
        }),
      )
      expect(promptService.generateMovieDeletePrompt).toHaveBeenCalledWith(
        mockMessages,
        expect.anything(),
        'multiple_results_delete',
        {
          searchQuery: 'test movie',
          movies: mockLibrarySearchResults,
        },
      )
    })

    it('should handle library search error gracefully', async () => {
      const error = new Error('Radarr service unavailable')
      radarrService.getLibraryMovies.mockRejectedValue(error)

      const result = await service.handleDelete(
        mockHumanMessage,
        mockMessages,
        mockUserId,
      )

      expect(result).toEqual({
        images: [],
        messages: mockMessages.concat(expect.any(HumanMessage)),
      })
      expect(promptService.generateMovieDeletePrompt).toHaveBeenCalledWith(
        mockMessages,
        expect.anything(),
        'error_delete',
        expect.objectContaining({
          errorMessage: expect.stringContaining("Couldn't search library for"),
        }),
      )
    })
  })

  describe('handleDeleteSelection', () => {
    const mockDeleteContext: MovieDeleteContext = {
      searchResults: mockLibrarySearchResults,
      query: 'library movie',
      timestamp: Date.now(),
      isActive: true,
    }

    beforeEach(() => {
      radarrService.unmonitorAndDeleteMovie.mockResolvedValue({
        success: true,
        movieDeleted: true,
        filesDeleted: true,
      })
    })

    it('should process valid selection and delete movie', async () => {
      const selectionMessage = new HumanMessage({
        id: nanoid(),
        content: '1',
      })

      const result = await service.handleDeleteSelection(
        selectionMessage,
        [selectionMessage],
        mockDeleteContext,
        mockUserId,
      )

      expect(contextService.clearContext).toHaveBeenCalledWith(mockUserId)
      expect(result).toEqual({
        images: [],
        messages: [selectionMessage].concat(expect.any(HumanMessage)),
      })
    })

    it('should ask for clarification when selection is invalid', async () => {
      const invalidSelectionMessage = new HumanMessage({
        id: nanoid(),
        content: 'invalid selection',
      })

      await service.handleDeleteSelection(
        invalidSelectionMessage,
        [invalidSelectionMessage],
        mockDeleteContext,
        mockUserId,
      )

      expect(promptService.generateMovieDeletePrompt).toHaveBeenCalledWith(
        [invalidSelectionMessage],
        expect.anything(),
        expect.stringMatching(/(multiple_results_delete|clarification)/),
        expect.objectContaining({
          searchQuery: mockDeleteContext.query,
        }),
      )
    })
  })

  describe('context lifecycle integration', () => {
    it('should properly manage context during search to selection flow', async () => {
      radarrService.searchMovies.mockResolvedValue(mockMovieSearchResults)

      await service.handleSearch(mockHumanMessage, mockMessages, mockUserId)

      expect(contextService.setContext).toHaveBeenCalledWith(
        mockUserId,
        'movie_selection',
        expect.objectContaining({
          searchResults: mockMovieSearchResults,
          isActive: true,
        }),
      )

      const selectionMessage = new HumanMessage({
        id: nanoid(),
        content: '1',
      })
      const movieContext: MovieSelectionContext = {
        searchResults: mockMovieSearchResults,
        query: 'test movie',
        timestamp: Date.now(),
        isActive: true,
      }

      await service.handleSelection(
        selectionMessage,
        [selectionMessage],
        movieContext,
        mockUserId,
      )

      expect(contextService.clearContext).toHaveBeenCalledWith(mockUserId)
    })

    it('should properly manage delete context lifecycle', async () => {
      radarrService.getLibraryMovies.mockResolvedValue(mockLibrarySearchResults)

      await service.handleDelete(mockHumanMessage, mockMessages, mockUserId)

      expect(contextService.setContext).toHaveBeenCalledWith(
        mockUserId,
        'movie_delete',
        expect.objectContaining({
          searchResults: mockLibrarySearchResults,
          isActive: true,
        }),
      )

      const selectionMessage = new HumanMessage({
        id: nanoid(),
        content: '1',
      })
      const deleteContext: MovieDeleteContext = {
        searchResults: mockLibrarySearchResults,
        query: 'library movie',
        timestamp: Date.now(),
        isActive: true,
      }

      await service.handleDeleteSelection(
        selectionMessage,
        [selectionMessage],
        deleteContext,
        mockUserId,
      )

      expect(contextService.clearContext).toHaveBeenCalledWith(mockUserId)
    })

    it('should clear context when operations fail', async () => {
      const movieContext: MovieSelectionContext = {
        searchResults: mockMovieSearchResults,
        query: 'test movie',
        timestamp: Date.now(),
        isActive: true,
      }

      const selectionMessage = new HumanMessage({
        id: nanoid(),
        content: '1',
      })

      radarrService.monitorAndDownloadMovie.mockRejectedValue(
        new Error('Service error'),
      )

      await service.handleSelection(
        selectionMessage,
        [selectionMessage],
        movieContext,
        mockUserId,
      )

      expect(contextService.clearContext).toHaveBeenCalledWith(mockUserId)
    })
  })

  describe('integration workflows', () => {
    it('should handle complete search-to-download workflow', async () => {
      radarrService.searchMovies.mockResolvedValue([mockMovieSearchResults[0]])
      radarrService.monitorAndDownloadMovie.mockResolvedValue({
        success: true,
        movieAdded: true,
        searchTriggered: true,
      })

      const result = await service.handleSearch(
        mockHumanMessage,
        mockMessages,
        mockUserId,
      )

      expect(radarrService.searchMovies).toHaveBeenCalled()
      expect(radarrService.monitorAndDownloadMovie).toHaveBeenCalledWith(123)
      expect(result).toEqual({
        images: [],
        messages: mockMessages.concat(expect.any(HumanMessage)),
      })
      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        mockMessages,
        expect.anything(),
        'success',
        expect.objectContaining({
          selectedMovie: mockMovieSearchResults[0],
        }),
      )
    })

    it('should handle complete library-search-to-delete workflow', async () => {
      radarrService.getLibraryMovies.mockResolvedValue([
        mockLibrarySearchResults[0],
      ])
      radarrService.unmonitorAndDeleteMovie.mockResolvedValue({
        success: true,
        movieDeleted: true,
        filesDeleted: true,
      })

      const result = await service.handleDelete(
        mockHumanMessage,
        mockMessages,
        mockUserId,
      )

      expect(radarrService.getLibraryMovies).toHaveBeenCalled()
      expect(radarrService.unmonitorAndDeleteMovie).toHaveBeenCalledWith(789, {
        deleteFiles: true,
      })
      expect(result).toEqual({
        images: [],
        messages: mockMessages.concat(expect.any(HumanMessage)),
      })
      expect(promptService.generateMovieDeletePrompt).toHaveBeenCalledWith(
        mockMessages,
        expect.anything(),
        'success_delete',
        expect.objectContaining({
          selectedMovie: mockLibrarySearchResults[0],
        }),
      )
    })

    it('should maintain state consistency across multiple user interactions', async () => {
      const user1 = 'user-1'
      const user2 = 'user-2'

      radarrService.searchMovies.mockResolvedValue(mockMovieSearchResults)

      await service.handleSearch(mockHumanMessage, mockMessages, user1)
      await service.handleSearch(mockHumanMessage, mockMessages, user2)

      expect(contextService.setContext).toHaveBeenCalledWith(
        user1,
        'movie_selection',
        expect.any(Object),
      )
      expect(contextService.setContext).toHaveBeenCalledWith(
        user2,
        'movie_selection',
        expect.any(Object),
      )
      expect(contextService.setContext).toHaveBeenCalledTimes(2)
    })
  })

  describe('edge cases and resilience', () => {
    it('should handle malformed search results gracefully', async () => {
      const malformedResults = [
        {
          tmdbId: 123,
          title: 'Valid Movie',
          year: 2020,
          genres: ['Action'],
          status: RadarrMovieStatus.RELEASED,
        },
        {
          tmdbId: 0,
          title: '',
          genres: [],
          status: RadarrMovieStatus.TBA,
        },
      ]

      radarrService.searchMovies.mockResolvedValue(malformedResults)

      const result = await service.handleSearch(
        mockHumanMessage,
        mockMessages,
        mockUserId,
      )

      expect(result).toEqual({
        images: [],
        messages: mockMessages.concat(expect.any(HumanMessage)),
      })
    })

    it('should handle service recovery after temporary failures', async () => {
      radarrService.searchMovies
        .mockRejectedValueOnce(new Error('Temporary failure'))
        .mockResolvedValueOnce(mockMovieSearchResults)

      await service.handleSearch(mockHumanMessage, mockMessages, mockUserId)
      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        mockMessages,
        expect.anything(),
        'error',
        expect.any(Object),
      )

      jest.clearAllMocks()
      promptService.generateMoviePrompt.mockResolvedValue(
        new HumanMessage({ id: nanoid(), content: 'Mock movie response' }),
      )

      await service.handleSearch(mockHumanMessage, mockMessages, mockUserId)
      expect(promptService.generateMoviePrompt).toHaveBeenCalledWith(
        mockMessages,
        expect.anything(),
        'multiple_results',
        expect.any(Object),
      )
    })

    it('should prevent context pollution between different operation types', async () => {
      radarrService.searchMovies.mockResolvedValue(mockMovieSearchResults)
      radarrService.getLibraryMovies.mockResolvedValue(mockLibrarySearchResults)

      await service.handleSearch(mockHumanMessage, mockMessages, mockUserId)
      await service.handleDelete(mockHumanMessage, mockMessages, mockUserId)

      const setContextCalls = contextService.setContext.mock.calls
      expect(setContextCalls).toHaveLength(2)
      expect(setContextCalls[0][1]).toBe('movie_selection')
      expect(setContextCalls[1][1]).toBe('movie_delete')
    })
  })
})
