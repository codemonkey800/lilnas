import { Test, TestingModule } from '@nestjs/testing'

import { LlmCall } from 'src/llm/client/llm-call.types'
import { LlmClient } from 'src/llm/client/llm-client'
import { FakeLlmClient } from 'src/llm/testing/fake-llm-client'
import { createFakeLlmClient } from 'src/media-operations/request-handling/__test-helpers__/mock-services'
import { ParsingUtilities } from 'src/media-operations/request-handling/utils/parsing.utils'

describe('ParsingUtilities', () => {
  let service: ParsingUtilities
  let llm: FakeLlmClient

  /** The text of the user message an LLM call was made for. */
  const inputOf = (messages: { content: unknown }[]): string =>
    String(messages[1]?.content ?? '')

  beforeEach(async () => {
    llm = createFakeLlmClient()

    const module: TestingModule = await Test.createTestingModule({
      providers: [ParsingUtilities, { provide: LlmClient, useValue: llm }],
    }).compile()

    service = module.get<ParsingUtilities>(ParsingUtilities)
  })

  describe('extractSearchQueryWithLLM', () => {
    it('should extract search query when LLM successfully processes user message', async () => {
      llm.script('media.extractQuery', 'Inception')

      const result =
        await service.extractSearchQueryWithLLM('download inception')

      expect(result).toBe('Inception')
      expect(llm.calls).toHaveLength(1)
    })

    it('returns an empty query, not the raw message, when the message names no title', async () => {
      llm.script('media.extractQuery', '   ')

      const result = await service.extractSearchQueryWithLLM(
        'download some horror movies',
      )

      expect(result).toBe('')
    })

    it('should use simple fallback when LLM encounters an error', async () => {
      llm.script('media.extractQuery', new Error('LLM error'))

      const result = await service.extractSearchQueryWithLLM(
        'download the matrix movie',
      )

      // Simple fallback removes common words
      expect(result).not.toContain('download')
      expect(result).toContain('matrix')
    })

    it('should trim whitespace when extracted query contains leading or trailing spaces', async () => {
      llm.script('media.extractQuery', '  The Godfather  ')

      const result =
        await service.extractSearchQueryWithLLM('get the godfather')

      expect(result).toBe('The Godfather')
    })
  })

  describe('extractTvDeleteQueryWithLLM', () => {
    it('should extract TV show name when given delete request', async () => {
      llm.script('media.extractTvQuery', 'Breaking Bad')

      const result = await service.extractTvDeleteQueryWithLLM(
        'delete breaking bad',
      )

      expect(result).toBe('Breaking Bad')
    })

    it('should fallback to simple extraction when LLM encounters error', async () => {
      llm.script('media.extractTvQuery', new Error('LLM error'))

      const result =
        await service.extractTvDeleteQueryWithLLM('delete the wire')

      // Fallback should still extract something
      expect(result).toBeTruthy()
      expect(result).not.toContain('delete')
    })
  })

  describe('parseSearchSelection', () => {
    it('should parse selection when given ordinal reference', async () => {
      llm.script('media.parseSelection', {
        selectionType: 'ordinal',
        value: '2',
      })

      const result = await service.parseSearchSelection('the second one')

      expect(result).toEqual({
        selectionType: 'ordinal',
        value: '2',
      })
    })

    it('should parse selection when given year reference', async () => {
      llm.script('media.parseSelection', {
        selectionType: 'year',
        value: '2010',
      })

      const result = await service.parseSearchSelection('the 2010 version')

      expect(result).toEqual({
        selectionType: 'year',
        value: '2010',
      })
    })

    it('should throw error when LLM returns invalid selection type', async () => {
      llm.script('media.parseSelection', {
        selectionType: 'unknown',
        value: 'test',
      })

      await expect(service.parseSearchSelection('invalid')).rejects.toThrow()
    })

    it('should throw error when LLM fails to process selection', async () => {
      llm.script('media.parseSelection', new Error('LLM error'))

      await expect(service.parseSearchSelection('test')).rejects.toThrow()
    })
  })

  describe('parseTvShowSelection', () => {
    it('should parse selection when user specifies specific season', async () => {
      llm.script('media.parseTvSelection', {
        selection: [{ season: 1 }],
      })

      const result = await service.parseTvShowSelection('season 1')

      expect(result).toEqual({
        selection: [{ season: 1 }],
      })
    })

    it('should parse selection when user requests entire series', async () => {
      llm.script('media.parseTvSelection', {})

      const result = await service.parseTvShowSelection('entire series')

      expect(result).toEqual({})
    })

    it('should parse selection when user specifies episodes within season', async () => {
      llm.script('media.parseTvSelection', {
        selection: [{ season: 1, episodes: [1, 2, 3] }],
      })

      const result = await service.parseTvShowSelection('season 1 episodes 1-3')

      expect(result).toEqual({
        selection: [{ season: 1, episodes: [1, 2, 3] }],
      })
    })

    it('should throw error when LLM returns invalid schema format', async () => {
      llm.script('media.parseTvSelection', {
        selection: 'invalid',
      })

      await expect(service.parseTvShowSelection('test')).rejects.toThrow()
    })
  })

  describe('parseInitialSelection', () => {
    it('should parse all components when given complete media request', async () => {
      llm
        .script('media.extractQuery', 'Inception')
        .script('media.parseSelection', {
          selectionType: 'ordinal',
          value: '1',
        })
        .script('media.parseTvSelection', {})

      const result = await service.parseInitialSelection(
        'download inception first one',
      )

      expect(result.searchQuery).toBe('Inception')
      expect(result.selection).toEqual({ selectionType: 'ordinal', value: '1' })
      expect(result.tvSelection).toEqual({})
    })

    it('should handle gracefully when some parsing steps fail', async () => {
      llm
        .script('media.extractQuery', 'The Matrix')
        .script('media.parseSelection', new Error('Parse error'))
        .script('media.parseTvSelection', new Error('Parse error'))

      const result = await service.parseInitialSelection('download the matrix')

      expect(result.searchQuery).toBe('The Matrix')
      expect(result.selection).toBeNull()
      expect(result.tvSelection).toBeNull()
    })

    it('hands the strategies an empty search query when the message names no title', async () => {
      llm
        .script('media.extractQuery', '')
        .script('media.parseSelection', { error: 'no_selection_found' })
        .script('media.parseTvSelection', { error: 'no_tv_selection_found' })

      const result = await service.parseInitialSelection(
        'get me that movie with Ryan Gosling',
      )

      expect(result.searchQuery).toBe('')
    })

    it('should use complete fallback when all LLM operations fail', async () => {
      const failure = new Error('Complete failure')
      llm
        .script('media.extractQuery', failure)
        .script('media.parseSelection', failure)
        .script('media.parseTvSelection', failure)

      const result = await service.parseInitialSelection('download inception')

      // Should still return search query using fallback
      expect(result.searchQuery).toBeTruthy()
      expect(result.selection).toBeNull()
      expect(result.tvSelection).toBeNull()
    })
  })

  describe('Concurrent Operations (ISSUE-6)', () => {
    it('should handle 10 concurrent parseInitialSelection calls without race conditions', async () => {
      // Setup: Create 10 different movie requests
      const requests = Array.from({ length: 10 }, (_, i) => ({
        content: `download movie ${i}`,
        expectedQuery: `Movie ${i}`,
      }))

      // Each call makes 3 LLM invocations: searchQuery, searchSelection, tvSelection
      llm
        .script('media.extractQuery', call => {
          const input = inputOf(call.messages)
          return requests.find(r => r.content === input)?.expectedQuery ?? ''
        })
        // Search and TV selection fail and are caught as null
        .script('media.parseSelection', new Error('No selection'))
        .script('media.parseTvSelection', new Error('No TV selection'))

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
      expect(llm.calls).toHaveLength(30)
    })

    it('should handle parseInitialSelection with slow LLM responses', async () => {
      // Setup: Mock slow LLM responses with delays
      const requests = Array.from({ length: 5 }, (_, i) => ({
        content: `download slow movie ${i}`,
        expectedQuery: `Slow Movie ${i}`,
        delay: 500 + i * 200, // Varying delays: 500ms, 700ms, 900ms, 1100ms, 1300ms
      }))

      llm
        .script('media.extractQuery', call => {
          const input = inputOf(call.messages)
          return requests.find(r => r.content === input)?.expectedQuery ?? ''
        })
        .script('media.parseSelection', new Error('No selection'))
        .script('media.parseTvSelection', new Error('No TV selection'))

      // Delay the search query extraction like a slow model would
      const respond = llm.call.bind(llm)
      const callSpy = jest.spyOn(llm, 'call').mockImplementation(async call => {
        if (call.operation === 'media.extractQuery') {
          const delay = requests.find(
            r => r.content === inputOf(call.messages),
          )?.delay
          await new Promise(resolve => setTimeout(resolve, delay))
        }
        return respond(call)
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

      expect(callSpy).toHaveBeenCalledTimes(15)
    })

    it('should handle concurrent extractSearchQueryWithLLM calls', async () => {
      // Setup: Create 10 different queries
      const queries = Array.from({ length: 10 }, (_, i) => ({
        input: `download the movie number ${i}`,
        expected: `Movie ${i}`,
      }))

      llm.script('media.extractQuery', call => {
        const input = inputOf(call.messages)
        return queries.find(q => q.input === input)?.expected ?? ''
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

      expect(llm.calls).toHaveLength(10)
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

      llm.script('media.parseSelection', call => {
        const input = inputOf(call.messages)
        return selections.find(s => s.input === input)?.expected ?? {}
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

      expect(llm.calls).toHaveLength(5)
    })

    it('should handle mixed concurrent operations across different methods', async () => {
      // Setup: one scripted answer per operation, looked up by user input
      const answers =
        (map: Record<string, string | object>) =>
        (call: LlmCall<unknown>): string | object => {
          const input = inputOf(call.messages)
          if (input in map) return map[input]
          throw new Error(`Unexpected mock call for content: ${input}`)
        }

      llm
        .script(
          'media.extractQuery',
          answers({
            'download inception': 'Inception',
            'get the matrix': 'The Matrix',
          }),
        )
        .script(
          'media.parseSelection',
          answers({
            'the first one': { selectionType: 'ordinal', value: '1' },
            'from 2010': { selectionType: 'year', value: '2010' },
          }),
        )
        .script(
          'media.extractTvQuery',
          answers({
            'delete breaking bad': 'Breaking Bad',
            'remove the wire': 'The Wire',
          }),
        )
        .script(
          'media.parseTvSelection',
          answers({
            'season 1': { selection: [{ season: 1 }] },
            'entire series': {},
          }),
        )

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

      expect(llm.calls).toHaveLength(8)
    })

    it('should handle concurrent operations with mixed success and failures', async () => {
      // Setup: one scripted answer per operation, looked up by user input
      llm
        .script('media.extractQuery', call => {
          const input = inputOf(call.messages)
          const answers: Record<string, string> = {
            'success 1': 'Success 1',
            'success 2': 'Success 2',
            'success 3': 'Success 3',
          }
          if (input in answers) return answers[input]
          throw new Error(`Unexpected mock call for content: ${input}`)
        })
        .script('media.parseSelection', call => {
          const input = inputOf(call.messages)
          if (input === 'valid selection') {
            return { selectionType: 'ordinal', value: '1' }
          }
          throw new Error('Parse error')
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

      // Fourth should fail with the model's error
      expect(results[3].status).toBe('rejected')
      if (results[3].status === 'rejected') {
        expect(results[3].reason.message).toContain('Parse error')
      }

      // Fifth should succeed
      expect(results[4].status).toBe('fulfilled')
      if (results[4].status === 'fulfilled') {
        expect(results[4].value).toBe('Success 3')
      }

      // Every method attempted its LLM call
      expect(llm.calls.length).toBeGreaterThanOrEqual(5)
    })
  })
})
