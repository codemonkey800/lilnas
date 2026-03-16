import { errorMessage, generateTitleSlug } from 'src/media/utils/media.utils'

describe('media.utils', () => {
  describe('errorMessage', () => {
    it('should return the error message when given an Error instance', () => {
      const error = new Error('Something went wrong')

      expect(errorMessage(error)).toBe('Something went wrong')
    })

    it('should return the default fallback when given a non-Error value', () => {
      expect(errorMessage('a string')).toBe('Unknown error')
      expect(errorMessage(42)).toBe('Unknown error')
      expect(errorMessage(null)).toBe('Unknown error')
      expect(errorMessage(undefined)).toBe('Unknown error')
      expect(errorMessage({ message: 'object error' })).toBe('Unknown error')
    })

    it('should use a custom fallback message when provided', () => {
      expect(errorMessage('not an error', 'Custom fallback')).toBe(
        'Custom fallback',
      )
      expect(errorMessage(null, 'API unavailable')).toBe('API unavailable')
    })

    it('should return empty string message when Error has an empty message', () => {
      const error = new Error('')

      expect(errorMessage(error)).toBe('')
    })

    it('should handle subclasses of Error (TypeError, RangeError, etc.)', () => {
      const typeError = new TypeError('wrong type')
      const rangeError = new RangeError('out of range')
      const syntaxError = new SyntaxError('bad syntax')

      expect(errorMessage(typeError)).toBe('wrong type')
      expect(errorMessage(rangeError)).toBe('out of range')
      expect(errorMessage(syntaxError)).toBe('bad syntax')
    })
  })

  describe('generateTitleSlug', () => {
    it('should convert a simple title to a lowercase hyphenated slug', () => {
      expect(generateTitleSlug('Breaking Bad')).toBe('breaking-bad')
    })

    it('should convert a single-word title', () => {
      expect(generateTitleSlug('Inception')).toBe('inception')
    })

    it('should remove special characters from the slug', () => {
      expect(generateTitleSlug("It's Always Sunny!")).toBe('its-always-sunny')
    })

    it('should replace multiple spaces with a single hyphen', () => {
      expect(generateTitleSlug('The  Dark   Knight')).toBe('the-dark-knight')
    })

    it('should remove leading hyphens from slug', () => {
      expect(generateTitleSlug('  Leading Spaces')).toBe('leading-spaces')
    })

    it('should remove trailing hyphens from slug', () => {
      expect(generateTitleSlug('Trailing Spaces  ')).toBe('trailing-spaces')
    })

    it('should collapse multiple hyphens into one', () => {
      expect(generateTitleSlug('Fight---Club')).toBe('fight-club')
    })

    it('should handle titles with numbers', () => {
      expect(generateTitleSlug('2001: A Space Odyssey')).toBe(
        '2001-a-space-odyssey',
      )
    })

    it('should handle a title that is entirely special characters', () => {
      expect(generateTitleSlug('!!!???')).toBe('')
    })

    it('should handle an empty string', () => {
      expect(generateTitleSlug('')).toBe('')
    })

    it('should handle titles with parentheses', () => {
      expect(generateTitleSlug('Avatar (2009)')).toBe('avatar-2009')
    })

    it('should handle titles with colons and em-dashes', () => {
      // em-dash (–) is a special char removed by the regex, leaving a single hyphen
      expect(generateTitleSlug('Mission: Impossible – Fallout')).toBe(
        'mission-impossible-fallout',
      )
    })

    it('should produce a consistent slug for the same input', () => {
      const title = 'The Grand Budapest Hotel'

      expect(generateTitleSlug(title)).toBe(generateTitleSlug(title))
    })

    it('should lowercase the entire slug', () => {
      expect(generateTitleSlug('BREAKING BAD')).toBe('breaking-bad')
    })
  })
})
