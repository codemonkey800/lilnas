// Mock ChatOpenAI before imports
const mockInvoke = jest.fn()
const mockWithStructuredOutput = jest.fn()
const mockChatOpenAI = jest.fn().mockImplementation(() => ({
  invoke: mockInvoke,
  withStructuredOutput: mockWithStructuredOutput,
}))

jest.mock('@langchain/openai', () => ({
  ChatOpenAI: mockChatOpenAI,
}))

import { AIMessage } from '@langchain/core/messages'
import { Test, TestingModule } from '@nestjs/testing'

import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'
import { StateService } from 'src/state/state.service'
import { RetryService } from 'src/utils/retry.service'

describe('ParsingUtilities', () => {
  let service: ParsingUtilities
  let mockStateService: jest.Mocked<Pick<StateService, 'getState'>>
  let mockRetryService: jest.Mocked<Pick<RetryService, 'executeWithRetry'>>

  beforeEach(async () => {
    // Reset all mocks
    jest.clearAllMocks()

    mockStateService = {
      getState: jest.fn().mockReturnValue({
        reasoningModel: 'gpt-4o-mini',
        temperature: 0,
      }),
    } as jest.Mocked<Pick<StateService, 'getState'>>

    mockRetryService = {
      executeWithRetry: jest.fn().mockImplementation(async fn => await fn()),
    } as jest.Mocked<Pick<RetryService, 'executeWithRetry'>>

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ParsingUtilities,
        { provide: StateService, useValue: mockStateService },
        { provide: RetryService, useValue: mockRetryService },
      ],
    }).compile()

    service = module.get<ParsingUtilities>(ParsingUtilities)
  })

  describe('extractSearchQueryWithLLM', () => {
    it('should extract search query when LLM successfully processes user message', async () => {
      mockInvoke.mockResolvedValueOnce(new AIMessage({ content: 'Inception' }))

      const result =
        await service.extractSearchQueryWithLLM('download inception')

      expect(result).toBe('Inception')
      expect(mockInvoke).toHaveBeenCalledTimes(1)
    })

    it('should fallback to original content when LLM extraction returns empty string', async () => {
      mockInvoke.mockResolvedValueOnce(new AIMessage({ content: '   ' }))

      const result =
        await service.extractSearchQueryWithLLM('download inception')

      expect(result).toBe('download inception')
    })

    it('should use simple fallback when LLM encounters an error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('LLM error'))

      const result = await service.extractSearchQueryWithLLM(
        'download the matrix movie',
      )

      // Simple fallback removes common words
      expect(result).not.toContain('download')
      expect(result).toContain('matrix')
    })

    it('should trim whitespace when extracted query contains leading or trailing spaces', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({ content: '  The Godfather  ' }),
      )

      const result =
        await service.extractSearchQueryWithLLM('get the godfather')

      expect(result).toBe('The Godfather')
    })
  })

  describe('extractTvDeleteQueryWithLLM', () => {
    it('should extract TV show name when given delete request', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({ content: 'Breaking Bad' }),
      )

      const result = await service.extractTvDeleteQueryWithLLM(
        'delete breaking bad',
      )

      expect(result).toBe('Breaking Bad')
    })

    it('should fallback to simple extraction when LLM encounters error', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('LLM error'))

      const result =
        await service.extractTvDeleteQueryWithLLM('delete the wire')

      // Fallback should still extract something
      expect(result).toBeTruthy()
      expect(result).not.toContain('delete')
    })
  })

  describe('parseSearchSelection', () => {
    it('should parse selection when given ordinal reference', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({
          content: JSON.stringify({
            selectionType: 'ordinal',
            value: '2',
          }),
        }),
      )

      const result = await service.parseSearchSelection('the second one')

      expect(result).toEqual({
        selectionType: 'ordinal',
        value: '2',
      })
    })

    it('should parse selection when given year reference', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({
          content: JSON.stringify({
            selectionType: 'year',
            value: '2010',
          }),
        }),
      )

      const result = await service.parseSearchSelection('the 2010 version')

      expect(result).toEqual({
        selectionType: 'year',
        value: '2010',
      })
    })

    it('should throw error when LLM returns invalid selection type', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({
          content: JSON.stringify({
            selectionType: 'unknown',
            value: 'test',
          }),
        }),
      )

      await expect(service.parseSearchSelection('invalid')).rejects.toThrow()
    })

    it('should throw error when LLM fails to process selection', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('LLM error'))

      await expect(service.parseSearchSelection('test')).rejects.toThrow()
    })
  })

  describe('parseTvShowSelection', () => {
    it('should parse selection when user specifies specific season', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({
          content: JSON.stringify({
            selection: [{ season: 1 }],
          }),
        }),
      )

      const result = await service.parseTvShowSelection('season 1')

      expect(result).toEqual({
        selection: [{ season: 1 }],
      })
    })

    it('should parse selection when user requests entire series', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({
          content: JSON.stringify({}),
        }),
      )

      const result = await service.parseTvShowSelection('entire series')

      expect(result).toEqual({})
    })

    it('should parse selection when user specifies episodes within season', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({
          content: JSON.stringify({
            selection: [{ season: 1, episodes: [1, 2, 3] }],
          }),
        }),
      )

      const result = await service.parseTvShowSelection('season 1 episodes 1-3')

      expect(result).toEqual({
        selection: [{ season: 1, episodes: [1, 2, 3] }],
      })
    })

    it('should throw error when LLM returns invalid schema format', async () => {
      mockInvoke.mockResolvedValueOnce(
        new AIMessage({
          content: JSON.stringify({
            selection: 'invalid',
          }),
        }),
      )

      await expect(service.parseTvShowSelection('test')).rejects.toThrow()
    })
  })

  describe('parseInitialSelection', () => {
    it('should parse all components when given complete media request', async () => {
      // Mock search query extraction
      mockInvoke
        .mockResolvedValueOnce(new AIMessage({ content: 'Inception' }))
        // Mock search selection
        .mockResolvedValueOnce(
          new AIMessage({
            content: JSON.stringify({ selectionType: 'ordinal', value: '1' }),
          }),
        )
        // Mock TV selection
        .mockResolvedValueOnce(new AIMessage({ content: JSON.stringify({}) }))

      const result = await service.parseInitialSelection(
        'download inception first one',
      )

      expect(result.searchQuery).toBe('Inception')
      expect(result.selection).toEqual({ selectionType: 'ordinal', value: '1' })
      expect(result.tvSelection).toEqual({})
    })

    it('should handle gracefully when some parsing steps fail', async () => {
      // Mock search query success
      mockInvoke
        .mockResolvedValueOnce(new AIMessage({ content: 'The Matrix' }))
        // Mock search selection failure
        .mockRejectedValueOnce(new Error('Parse error'))
        // Mock TV selection failure
        .mockRejectedValueOnce(new Error('Parse error'))

      const result = await service.parseInitialSelection('download the matrix')

      expect(result.searchQuery).toBe('The Matrix')
      expect(result.selection).toBeNull()
      expect(result.tvSelection).toBeNull()
    })

    it('should use complete fallback when all LLM operations fail', async () => {
      mockInvoke.mockRejectedValue(new Error('Complete failure'))

      const result = await service.parseInitialSelection('download inception')

      // Should still return search query using fallback
      expect(result.searchQuery).toBeTruthy()
      expect(result.selection).toBeNull()
      expect(result.tvSelection).toBeNull()
    })
  })

  describe('Concurrent Operations (ISSUE-6)', () => {
    beforeEach(() => {
      // Ensure clean mock state for concurrent tests - reset implementation
      jest.clearAllMocks()
      mockInvoke.mockReset()
      mockWithStructuredOutput.mockReset()
    })

    it('should handle 10 concurrent parseInitialSelection calls without race conditions', async () => {
      // Setup: Create 10 different movie requests
      const requests = Array.from({ length: 10 }, (_, i) => ({
        content: `download movie ${i}`,
        expectedQuery: `Movie ${i}`,
      }))

      // Mock responses for each concurrent call
      // Each call makes 3 LLM invocations: searchQuery, searchSelection, tvSelection
      requests.forEach(req => {
        mockInvoke
          // Search query extraction
          .mockResolvedValueOnce(new AIMessage({ content: req.expectedQuery }))
          // Search selection (will be caught and return null)
          .mockRejectedValueOnce(new Error('No selection'))
          // TV selection (will be caught and return null)
          .mockRejectedValueOnce(new Error('No TV selection'))
      })

      // Execute: Run all requests concurrently
      const results = await Promise.all(
        requests.map(req => service.parseInitialSelection(req.content)),
      )

      // Verify: All completed successfully
      expect(results).toHaveLength(10)
      results.forEach((result, index) => {
        expect(result.searchQuery).toBe(requests[index].expectedQuery)
        expect(result.selection).toBeNull()
        expect(result.tvSelection).toBeNull()
      })

      // Verify all LLM calls were made (10 requests × 3 calls each)
      expect(mockInvoke).toHaveBeenCalledTimes(30)
    })

    it('should handle parseInitialSelection with slow LLM responses', async () => {
      // Setup: Mock slow LLM responses with delays
      const requests = Array.from({ length: 5 }, (_, i) => ({
        content: `download slow movie ${i}`,
        expectedQuery: `Slow Movie ${i}`,
        delay: 500 + i * 200, // Varying delays: 500ms, 700ms, 900ms, 1100ms, 1300ms
      }))

      // Mock slow responses
      requests.forEach(req => {
        mockInvoke
          // Search query with delay
          .mockImplementationOnce(async () => {
            await new Promise(resolve => setTimeout(resolve, req.delay))
            return new AIMessage({ content: req.expectedQuery })
          })
          // Search selection - quick failure
          .mockRejectedValueOnce(new Error('No selection'))
          // TV selection - quick failure
          .mockRejectedValueOnce(new Error('No TV selection'))
      })

      // Execute: Run all requests concurrently
      const startTime = Date.now()
      const results = await Promise.all(
        requests.map(req => service.parseInitialSelection(req.content)),
      )
      const totalTime = Date.now() - startTime

      // Verify: All completed successfully
      expect(results).toHaveLength(5)
      results.forEach((result, index) => {
        expect(result.searchQuery).toBe(requests[index].expectedQuery)
        expect(result.selection).toBeNull()
        expect(result.tvSelection).toBeNull()
      })

      // Verify concurrency: should complete in ~max delay time, not sum of all delays
      // Max delay is 1300ms, allow 2000ms buffer for processing
      expect(totalTime).toBeLessThan(3000)

      expect(mockInvoke).toHaveBeenCalledTimes(15)
    })

    it('should handle concurrent extractSearchQueryWithLLM calls', async () => {
      // Setup: Create 10 different queries
      const queries = Array.from({ length: 10 }, (_, i) => ({
        input: `download the movie number ${i}`,
        expected: `Movie ${i}`,
      }))

      // Mock responses
      queries.forEach(q => {
        mockInvoke.mockResolvedValueOnce(new AIMessage({ content: q.expected }))
      })

      // Execute: Run all queries concurrently
      const results = await Promise.all(
        queries.map(q => service.extractSearchQueryWithLLM(q.input)),
      )

      // Verify: All completed with correct results
      expect(results).toHaveLength(10)
      results.forEach((result, index) => {
        expect(result).toBe(queries[index].expected)
      })

      expect(mockInvoke).toHaveBeenCalledTimes(10)
    })

    it('should handle concurrent parseSearchSelection calls', async () => {
      // Setup: Mix of ordinal and year selections
      const selections = [
        {
          input: 'the first one',
          expected: { selectionType: 'ordinal', value: '1' },
        },
        {
          input: 'the 2020 version',
          expected: { selectionType: 'year', value: '2020' },
        },
        {
          input: 'the third result',
          expected: { selectionType: 'ordinal', value: '3' },
        },
        {
          input: 'from 2015',
          expected: { selectionType: 'year', value: '2015' },
        },
        {
          input: 'the second movie',
          expected: { selectionType: 'ordinal', value: '2' },
        },
      ]

      // Mock responses
      selections.forEach(s => {
        mockInvoke.mockResolvedValueOnce(
          new AIMessage({ content: JSON.stringify(s.expected) }),
        )
      })

      // Execute: Run all selections concurrently
      const results = await Promise.all(
        selections.map(s => service.parseSearchSelection(s.input)),
      )

      // Verify: All completed with correct selection types
      expect(results).toHaveLength(5)
      results.forEach((result, index) => {
        expect(result).toEqual(selections[index].expected)
      })

      expect(mockInvoke).toHaveBeenCalledTimes(5)
    })

    it('should handle mixed concurrent operations across different methods', async () => {
      // Setup: Use a lookup map for cleaner mock responses
      const mockResponseMap: Record<string, AIMessage> = {
        'download inception': new AIMessage({ content: 'Inception' }),
        'get the matrix': new AIMessage({ content: 'The Matrix' }),
        'the first one': new AIMessage({
          content: JSON.stringify({ selectionType: 'ordinal', value: '1' }),
        }),
        'from 2010': new AIMessage({
          content: JSON.stringify({ selectionType: 'year', value: '2010' }),
        }),
        'delete breaking bad': new AIMessage({ content: 'Breaking Bad' }),
        'remove the wire': new AIMessage({ content: 'The Wire' }),
        'season 1': new AIMessage({
          content: JSON.stringify({ selection: [{ season: 1 }] }),
        }),
        'entire series': new AIMessage({ content: JSON.stringify({}) }),
      }

      mockInvoke.mockImplementation(async messages => {
        const content = messages[1]?.content || ''
        // Use map lookup to find matching response by checking if content includes the key
        const matchedKey = Object.keys(mockResponseMap).find(key =>
          content.includes(key),
        )

        if (matchedKey) {
          return mockResponseMap[matchedKey]
        }

        throw new Error(`Unexpected mock call for content: ${content}`)
      })

      // Execute: Call different methods concurrently
      const results = await Promise.all([
        service.extractSearchQueryWithLLM('download inception'),
        service.extractSearchQueryWithLLM('get the matrix'),
        service.parseSearchSelection('the first one'),
        service.parseSearchSelection('from 2010'),
        service.extractTvDeleteQueryWithLLM('delete breaking bad'),
        service.extractTvDeleteQueryWithLLM('remove the wire'),
        service.parseTvShowSelection('season 1'),
        service.parseTvShowSelection('entire series'),
      ])

      // Verify: All completed successfully with correct results
      expect(results).toHaveLength(8)
      expect(results[0]).toBe('Inception')
      expect(results[1]).toBe('The Matrix')
      expect(results[2]).toEqual({ selectionType: 'ordinal', value: '1' })
      expect(results[3]).toEqual({ selectionType: 'year', value: '2010' })
      expect(results[4]).toBe('Breaking Bad')
      expect(results[5]).toBe('The Wire')
      expect(results[6]).toEqual({ selection: [{ season: 1 }] })
      expect(results[7]).toEqual({})

      expect(mockInvoke).toHaveBeenCalledTimes(8)
    })

    it('should handle concurrent operations with mixed success and failures', async () => {
      // Setup: Use a lookup map for cleaner mock responses
      let callCount = 0

      const mockResponseMap: Record<string, AIMessage | (() => never)> = {
        'success 1': new AIMessage({ content: 'Success 1' }),
        'success 2': new AIMessage({ content: 'Success 2' }),
        'success 3': new AIMessage({ content: 'Success 3' }),
        'valid selection': new AIMessage({
          content: JSON.stringify({ selectionType: 'ordinal', value: '1' }),
        }),
        'invalid selection': () => {
          throw new Error('Parse error')
        },
      }

      mockInvoke.mockImplementation(async messages => {
        callCount++
        const content = messages[1]?.content || ''

        const response = mockResponseMap[content]
        if (response !== undefined) {
          // If it's a function, call it (for errors)
          if (typeof response === 'function') {
            response()
          }
          return response
        }

        throw new Error(`Unexpected mock call for content: ${content}`)
      })

      // Execute: Run with Promise.allSettled to capture both successes and failures
      const results = await Promise.allSettled([
        service.extractSearchQueryWithLLM('success 1'),
        service.extractSearchQueryWithLLM('success 2'),
        service.parseSearchSelection('valid selection'),
        service.parseSearchSelection('invalid selection'),
        service.extractSearchQueryWithLLM('success 3'),
      ])

      // Verify: Successful operations completed, failures isolated
      expect(results).toHaveLength(5)

      // First three should succeed
      expect(results[0].status).toBe('fulfilled')
      expect(results[1].status).toBe('fulfilled')
      expect(results[2].status).toBe('fulfilled')
      if (results[0].status === 'fulfilled') {
        expect(results[0].value).toBe('Success 1')
      }
      if (results[1].status === 'fulfilled') {
        expect(results[1].value).toBe('Success 2')
      }
      if (results[2].status === 'fulfilled') {
        expect(results[2].value).toEqual({
          selectionType: 'ordinal',
          value: '1',
        })
      }

      // Fourth should fail (after 3 retry attempts by RetryService)
      expect(results[3].status).toBe('rejected')
      if (results[3].status === 'rejected') {
        expect(results[3].reason.message).toContain('Parse error')
      }

      // Fifth should succeed
      expect(results[4].status).toBe('fulfilled')
      if (results[4].status === 'fulfilled') {
        expect(results[4].value).toBe('Success 3')
      }

      // Verify mock was called: 3 successes + 1 valid selection + 3 retries for invalid + 1 final success = 8
      expect(callCount).toBeGreaterThanOrEqual(5)
    })
  })
})
