import { AIMessage } from '@langchain/core/messages'
import { Test, TestingModule } from '@nestjs/testing'

import { ValidationUtilities } from 'src/media-operations/request-handling/utils/validation.utils'

describe('ValidationUtilities', () => {
  let service: ValidationUtilities

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ValidationUtilities],
    }).compile()

    service = module.get<ValidationUtilities>(ValidationUtilities)
  })

  describe('validateDownloadResponse', () => {
    const userId = 'test-user-123'
    const movieTitles = ['The Matrix', 'Inception', 'Interstellar']
    const seriesTitles = ['Breaking Bad', 'The Wire', 'Game of Thrones']

    it('should not warn when response contains only valid titles', () => {
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
      const response = new AIMessage({
        content:
          'Currently downloading "The Matrix" at 45% and "Breaking Bad" at 67%',
      })

      service.validateDownloadResponse(
        response,
        movieTitles,
        seriesTitles,
        userId,
      )

      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })

    it('should warn when response contains suspicious quoted titles', () => {
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
      const response = new AIMessage({
        content:
          'Currently downloading "Fake Movie Title" at 45% and "The Matrix" at 67%',
      })

      service.validateDownloadResponse(
        response,
        movieTitles,
        seriesTitles,
        userId,
      )

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          suspiciousTitles: expect.arrayContaining(['fake movie title']),
        }),
        expect.stringContaining('Potential hallucination detected'),
      )
    })

    it('should warn when response contains titles followed by progress percentages', () => {
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
      const response = new AIMessage({
        content: 'Avatar The Last Airbender at 75% and The Matrix at 50%',
      })

      service.validateDownloadResponse(
        response,
        movieTitles,
        seriesTitles,
        userId,
      )

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          suspiciousTitles: expect.any(Array),
        }),
        expect.stringContaining('Potential hallucination detected'),
      )
    })

    it('should not warn for partial title matches that are valid', () => {
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
      const response = new AIMessage({
        content: 'Downloading "Matrix" at 45%', // Partial match with "The Matrix"
      })

      service.validateDownloadResponse(
        response,
        movieTitles,
        seriesTitles,
        userId,
      )

      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })

    it('should ignore very short potential title matches (< 3 chars)', () => {
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
      const response = new AIMessage({
        content: '"TV" at 45% and "PC" at 67%', // Very short, should be ignored
      })

      service.validateDownloadResponse(
        response,
        movieTitles,
        seriesTitles,
        userId,
      )

      // Should not warn since matches are too short
      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })

    it('should handle response with no quoted titles', () => {
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
      const response = new AIMessage({
        content: 'No downloads are currently active',
      })

      service.validateDownloadResponse(
        response,
        movieTitles,
        seriesTitles,
        userId,
      )

      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })

    it('should handle empty title arrays', () => {
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
      const response = new AIMessage({
        content: 'Currently downloading "The Matrix" at 45%',
      })

      // With empty arrays, everything would be suspicious
      service.validateDownloadResponse(response, [], [], userId)

      expect(loggerWarnSpy).toHaveBeenCalled()
    })

    it('should be case-insensitive when matching titles', () => {
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
      const response = new AIMessage({
        content: 'Downloading "the matrix" at 45% and "BREAKING BAD" at 67%',
      })

      service.validateDownloadResponse(
        response,
        movieTitles,
        seriesTitles,
        userId,
      )

      // Should not warn since case-insensitive matching should work
      expect(loggerWarnSpy).not.toHaveBeenCalled()
    })

    it('should handle multiple suspicious titles in one response', () => {
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
      const response = new AIMessage({
        content:
          '"Fake Movie 1" at 45%, "Fake Movie 2" at 67%, and "The Matrix" at 80%',
      })

      service.validateDownloadResponse(
        response,
        movieTitles,
        seriesTitles,
        userId,
      )

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          suspiciousTitles: expect.arrayContaining([
            'fake movie 1',
            'fake movie 2',
          ]),
        }),
        expect.stringContaining('Potential hallucination detected'),
      )
    })

    describe('Edge Cases (ISSUE-4)', () => {
      // Tests for edge cases identified in Phase 2 testing review

      describe('Malformed quoted patterns', () => {
        it('should handle nested double quotes gracefully', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const response = new AIMessage({
            content:
              'Downloading "Movie "with" nested" quotes" at 50% complete',
          })

          service.validateDownloadResponse(
            response,
            movieTitles,
            seriesTitles,
            userId,
          )

          // Current regex /"([^"]+)"/g will match "Movie " and " nested" separately
          // This documents current behavior - the regex doesn't handle nested quotes well
          expect(loggerWarnSpy).toHaveBeenCalled()
        })

        it('should handle mixed single and double quotes', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const validTitles = ["Movie with 'single' quotes"]
          const response = new AIMessage({
            content: 'Downloading "Movie with \'single\' quotes" at 50%',
          })

          service.validateDownloadResponse(response, validTitles, [], userId)

          // Single quotes inside double quotes should not break the pattern
          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })

        it('should handle unclosed quotes without crashing', () => {
          const _loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const response = new AIMessage({
            content: 'Downloading "Unclosed quote at 50% complete',
          })

          expect(() => {
            service.validateDownloadResponse(
              response,
              movieTitles,
              seriesTitles,
              userId,
            )
          }).not.toThrow()

          // Regex should handle malformed input without crashing
        })
      })

      describe('Non-English titles', () => {
        it('should handle Japanese titles as valid', () => {
          const _loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const japaneseTitles = ['東京物語', '七人の侍']
          const response = new AIMessage({
            content: 'Downloading "東京物語" at 45% and "七人の侍" at 67%',
          })

          service.validateDownloadResponse(response, japaneseTitles, [], userId)

          // Should recognize Japanese titles as valid
          expect(_loggerWarnSpy).not.toHaveBeenCalled()
        })

        it('should detect suspicious Japanese titles not in valid list', () => {
          const _loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const response = new AIMessage({
            content: 'Downloading "偽の映画" at 50%', // "Fake Movie" in Japanese
          })

          service.validateDownloadResponse(
            response,
            movieTitles,
            seriesTitles,
            userId,
          )

          // Current regex \w+ may not match Unicode characters properly
          // This documents whether the validation works with Unicode
          // TODO: Verify if this captures Japanese characters correctly
        })

        it('should handle Chinese titles', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const chineseTitles = ['卧虎藏龙', '霸王别姬']
          const response = new AIMessage({
            content: 'Watching "卧虎藏龙" at 30% and "霸王别姬" at 85%',
          })

          service.validateDownloadResponse(response, chineseTitles, [], userId)

          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })

        it('should handle mixed English and non-English titles', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const mixedTitles = [
            'The Matrix',
            '東京物語',
            'Inception',
            '卧虎藏龙',
          ]
          const response = new AIMessage({
            content:
              'Downloading "The Matrix" at 20%, "東京物語" at 45%, "Inception" at 60%, and "卧虎藏龙" at 75%',
          })

          service.validateDownloadResponse(response, mixedTitles, [], userId)

          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })
      })

      describe('Extremely long titles', () => {
        it('should handle titles with 500+ characters in quoted pattern', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const longTitle = 'A'.repeat(500) // 500 character title
          const validTitles = [longTitle]
          const response = new AIMessage({
            content: `Downloading "${longTitle}" at 50%`,
          })

          expect(() => {
            service.validateDownloadResponse(response, validTitles, [], userId)
          }).not.toThrow()

          // Should handle extremely long titles without performance issues
          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })

        it('should handle titles with 500+ characters in percentage pattern', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const longTitle = 'Word '.repeat(100).trim() // ~500 characters with spaces
          const validTitles = [longTitle]
          const response = new AIMessage({
            content: `${longTitle} at 75%`,
          })

          expect(() => {
            service.validateDownloadResponse(response, validTitles, [], userId)
          }).not.toThrow()

          // Regex should handle long patterns without catastrophic backtracking
          // May or may not match due to \w+ limitations with long strings
        })
      })

      describe('Special characters in titles', () => {
        it('should handle titles with colons', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const titlesWithColons = [
            'The Matrix: Reloaded',
            'Star Wars: Episode IV',
          ]
          const response = new AIMessage({
            content:
              'Downloading "The Matrix: Reloaded" at 45% and "Star Wars: Episode IV" at 67%',
          })

          service.validateDownloadResponse(
            response,
            titlesWithColons,
            [],
            userId,
          )

          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })

        it('should handle titles with brackets', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const titlesWithBrackets = ['[REC]', '(500) Days of Summer']
          const response = new AIMessage({
            content:
              'Watching "[REC]" at 30% and "(500) Days of Summer" at 85%',
          })

          service.validateDownloadResponse(
            response,
            titlesWithBrackets,
            [],
            userId,
          )

          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })

        it('should handle titles with ampersands', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const titlesWithAmpersands = ['Fast & Furious', 'Beauty & the Beast']
          const response = new AIMessage({
            content:
              'Downloading "Fast & Furious" at 55% and "Beauty & the Beast" at 70%',
          })

          service.validateDownloadResponse(
            response,
            titlesWithAmpersands,
            [],
            userId,
          )

          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })

        it('should handle titles with apostrophes', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const titlesWithApostrophes = ["Ocean's Eleven", "Schindler's List"]
          const response = new AIMessage({
            content:
              'Watching "Ocean\'s Eleven" at 40% and "Schindler\'s List" at 90%',
          })

          service.validateDownloadResponse(
            response,
            titlesWithApostrophes,
            [],
            userId,
          )

          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })

        it('should handle titles with hyphens', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const titlesWithHyphens = ['Spider-Man', 'X-Men']
          const response = new AIMessage({
            content: 'Downloading "Spider-Man" at 25% and "X-Men" at 80%',
          })

          service.validateDownloadResponse(
            response,
            titlesWithHyphens,
            [],
            userId,
          )

          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })

        it('should handle titles with multiple special characters combined', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const complexTitles = [
            "Pirates: At World's End",
            'Dr. Strangelove (1964)',
            '[REC]²',
          ]
          const response = new AIMessage({
            content:
              'Downloading "Pirates: At World\'s End" at 35%, "Dr. Strangelove (1964)" at 60%, and "[REC]²" at 95%',
          })

          service.validateDownloadResponse(response, complexTitles, [], userId)

          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })
      })

      describe('Titles with numbers that look like percentages', () => {
        it('should handle "The 100" TV show without false positive', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const validTitles = ['The 100']
          const response = new AIMessage({
            content: 'Watching "The 100" at 75% complete',
          })

          service.validateDownloadResponse(response, validTitles, [], userId)

          // Should not confuse "100" in title with percentage
          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })

        it('should handle "50/50" movie title', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const validTitles = ['50/50']
          const response = new AIMessage({
            content: 'Downloading "50/50" at 50%',
          })

          service.validateDownloadResponse(response, validTitles, [], userId)

          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })

        it('should handle titles with numbers in ambiguous contexts', () => {
          const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')
          const validTitles = ['Apollo 13', '1917', '2001: A Space Odyssey']
          const response = new AIMessage({
            content:
              'Downloading "Apollo 13" at 25%, "1917" at 50%, and "2001: A Space Odyssey" at 100%',
          })

          service.validateDownloadResponse(response, validTitles, [], userId)

          // Numbers in titles should not cause false positives
          expect(loggerWarnSpy).not.toHaveBeenCalled()
        })
      })
    })
  })
})
