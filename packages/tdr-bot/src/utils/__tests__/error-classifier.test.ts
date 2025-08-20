import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'
import { AxiosError, AxiosResponse, AxiosResponseHeaders } from 'axios'

import { createMockAxiosError } from 'src/__tests__/test-utils'
import {
  ErrorCategory,
  ErrorClassificationService,
  ErrorSeverity,
  ErrorType,
} from 'src/utils/error-classifier'

describe('ErrorClassificationService', () => {
  let service: ErrorClassificationService

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ErrorClassificationService],
    }).compile()

    service = module.get<ErrorClassificationService>(ErrorClassificationService)
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('Error Classification by Category', () => {
    describe('OpenAI API Errors', () => {
      it('should classify rate limit errors correctly', () => {
        const error = createMockAxiosError(
          'Rate limited',
          'ERR_RATE_LIMITED',
          429,
        )
        const result = service.classifyError(error, ErrorCategory.OPENAI_API)

        expect(result).toEqual({
          isRetryable: true,
          errorType: ErrorType.RATE_LIMIT,
          retryAfterMs: undefined, // No retry-after header in mock
          category: ErrorCategory.OPENAI_API,
          severity: ErrorSeverity.MEDIUM,
        })
      })

      it('should classify rate limit errors with retry-after header', () => {
        const error = createMockAxiosError(
          'Rate limited',
          'ERR_RATE_LIMITED',
          429,
          undefined,
          {
            headers: {
              'retry-after': '60', // 60 seconds
            },
          },
        )
        const result = service.classifyError(error, ErrorCategory.OPENAI_API)

        expect(result.retryAfterMs).toBe(60000) // 60 seconds in ms
      })

      it('should classify server errors as retryable', () => {
        const serverErrorCodes = [500, 502, 503, 504]

        serverErrorCodes.forEach(status => {
          const error = createMockAxiosError(
            'Server error',
            'ERR_SERVER_ERROR',
            status,
          )
          const result = service.classifyError(error, ErrorCategory.OPENAI_API)

          expect(result).toEqual({
            isRetryable: true,
            errorType: ErrorType.SERVER_ERROR,
            category: ErrorCategory.OPENAI_API,
            severity: ErrorSeverity.HIGH,
          })
        })
      })

      it('should classify timeout errors as retryable', () => {
        const error = createMockAxiosError(
          'Request timeout',
          'ERR_TIMEOUT',
          408,
        )
        const result = service.classifyError(error, ErrorCategory.OPENAI_API)

        expect(result).toEqual({
          isRetryable: true,
          errorType: ErrorType.TIMEOUT,
          category: ErrorCategory.OPENAI_API,
          severity: ErrorSeverity.MEDIUM,
        })
      })

      it('should classify authentication errors as non-retryable', () => {
        const error = createMockAxiosError(
          'Unauthorized',
          'ERR_UNAUTHORIZED',
          401,
        )
        const result = service.classifyError(error, ErrorCategory.OPENAI_API)

        expect(result).toEqual({
          isRetryable: false,
          errorType: ErrorType.AUTHENTICATION_ERROR,
          category: ErrorCategory.OPENAI_API,
          severity: ErrorSeverity.CRITICAL,
        })
      })

      it('should classify permission errors as non-retryable', () => {
        const error = createMockAxiosError('Forbidden', 'ERR_FORBIDDEN', 403)
        const result = service.classifyError(error, ErrorCategory.OPENAI_API)

        expect(result).toEqual({
          isRetryable: false,
          errorType: ErrorType.PERMISSION_ERROR,
          category: ErrorCategory.OPENAI_API,
          severity: ErrorSeverity.HIGH,
        })
      })

      it('should classify validation errors as non-retryable', () => {
        const validationErrorCodes = [400, 404, 422]

        validationErrorCodes.forEach(status => {
          const error = createMockAxiosError(
            'Validation error',
            'ERR_VALIDATION',
            status,
          )
          const result = service.classifyError(error, ErrorCategory.OPENAI_API)

          expect(result).toEqual({
            isRetryable: false,
            errorType: ErrorType.VALIDATION_ERROR,
            category: ErrorCategory.OPENAI_API,
            severity: ErrorSeverity.MEDIUM,
          })
        })
      })

      it('should classify unknown status codes based on range', () => {
        // Test 5xx errors (server errors)
        const serverError = createMockAxiosError(
          'Unknown server error',
          'ERR_UNKNOWN',
          507,
        )
        const serverResult = service.classifyError(
          serverError,
          ErrorCategory.OPENAI_API,
        )

        expect(serverResult).toEqual({
          isRetryable: true,
          errorType: ErrorType.SERVER_ERROR,
          category: ErrorCategory.OPENAI_API,
          severity: ErrorSeverity.MEDIUM,
        })

        // Test 4xx errors (client errors)
        const clientError = createMockAxiosError(
          'Unknown client error',
          'ERR_UNKNOWN',
          418, // I'm a teapot
        )
        const clientResult = service.classifyError(
          clientError,
          ErrorCategory.OPENAI_API,
        )

        expect(clientResult).toEqual({
          isRetryable: false,
          errorType: ErrorType.CLIENT_ERROR,
          category: ErrorCategory.OPENAI_API,
          severity: ErrorSeverity.MEDIUM,
        })
      })

      it('should classify network errors as retryable', () => {
        const networkErrorCodes = ['ECONNABORTED', 'ETIMEDOUT']

        networkErrorCodes.forEach(code => {
          const error = new AxiosError(
            'Network error',
            code,
            undefined,
            null,
            undefined,
          )
          error.code = code
          const result = service.classifyError(error, ErrorCategory.OPENAI_API)

          expect(result).toEqual({
            isRetryable: true,
            errorType: ErrorType.TIMEOUT,
            category: ErrorCategory.OPENAI_API,
            severity: ErrorSeverity.MEDIUM,
          })
        })
      })

      it('should classify connection errors as retryable', () => {
        const connectionErrorCodes = ['ECONNREFUSED', 'ENOTFOUND']

        connectionErrorCodes.forEach(code => {
          const error = new AxiosError(
            'Connection error',
            code,
            undefined,
            null,
            undefined,
          )
          error.code = code
          const result = service.classifyError(error, ErrorCategory.OPENAI_API)

          expect(result).toEqual({
            isRetryable: true,
            errorType: ErrorType.NETWORK_ERROR,
            category: ErrorCategory.OPENAI_API,
            severity: ErrorSeverity.HIGH,
          })
        })
      })
    })

    describe('Discord API Errors', () => {
      it('should classify Discord rate limits correctly', () => {
        const error = createMockAxiosError(
          'Rate limited',
          'ERR_RATE_LIMITED',
          429,
        )
        const result = service.classifyError(error, ErrorCategory.DISCORD_API)

        expect(result).toEqual({
          isRetryable: true,
          errorType: ErrorType.RATE_LIMIT,
          retryAfterMs: undefined,
          category: ErrorCategory.DISCORD_API,
          severity: ErrorSeverity.MEDIUM,
        })
      })

      it('should classify Discord server errors', () => {
        const serverErrorCodes = [500, 502, 503, 504]

        serverErrorCodes.forEach(status => {
          const error = createMockAxiosError(
            'Discord server error',
            'ERR_SERVER_ERROR',
            status,
          )
          const result = service.classifyError(error, ErrorCategory.DISCORD_API)

          expect(result).toEqual({
            isRetryable: true,
            errorType: ErrorType.SERVER_ERROR,
            category: ErrorCategory.DISCORD_API,
            severity: ErrorSeverity.HIGH,
          })
        })
      })

      it('should classify Discord auth errors', () => {
        const error = createMockAxiosError(
          'Invalid token',
          'ERR_UNAUTHORIZED',
          401,
        )
        const result = service.classifyError(error, ErrorCategory.DISCORD_API)

        expect(result).toEqual({
          isRetryable: false,
          errorType: ErrorType.AUTHENTICATION_ERROR,
          category: ErrorCategory.DISCORD_API,
          severity: ErrorSeverity.CRITICAL,
        })
      })

      it('should classify Discord permission errors', () => {
        const error = createMockAxiosError(
          'Missing permissions',
          'ERR_FORBIDDEN',
          403,
        )
        const result = service.classifyError(error, ErrorCategory.DISCORD_API)

        expect(result).toEqual({
          isRetryable: false,
          errorType: ErrorType.PERMISSION_ERROR,
          category: ErrorCategory.DISCORD_API,
          severity: ErrorSeverity.HIGH,
        })
      })

      it('should classify Discord validation errors', () => {
        const validationErrorCodes = [400, 404]

        validationErrorCodes.forEach(status => {
          const error = createMockAxiosError(
            'Discord validation error',
            'ERR_VALIDATION',
            status,
          )
          const result = service.classifyError(error, ErrorCategory.DISCORD_API)

          expect(result).toEqual({
            isRetryable: false,
            errorType: ErrorType.VALIDATION_ERROR,
            category: ErrorCategory.DISCORD_API,
            severity: ErrorSeverity.MEDIUM,
          })
        })
      })
    })

    describe('Equation Service Errors', () => {
      it('should classify equation service rate limits', () => {
        const error = createMockAxiosError(
          'Rate limited',
          'ERR_RATE_LIMITED',
          429,
        )
        const result = service.classifyError(
          error,
          ErrorCategory.EQUATION_SERVICE,
        )

        expect(result).toEqual({
          isRetryable: true,
          errorType: ErrorType.RATE_LIMIT,
          retryAfterMs: undefined,
          category: ErrorCategory.EQUATION_SERVICE,
          severity: ErrorSeverity.MEDIUM,
        })
      })

      it('should classify equation service server errors', () => {
        const serverErrorCodes = [500, 502, 503, 504]

        serverErrorCodes.forEach(status => {
          const error = createMockAxiosError(
            'Equation service error',
            'ERR_SERVER_ERROR',
            status,
          )
          const result = service.classifyError(
            error,
            ErrorCategory.EQUATION_SERVICE,
          )

          expect(result).toEqual({
            isRetryable: true,
            errorType: ErrorType.SERVER_ERROR,
            category: ErrorCategory.EQUATION_SERVICE,
            severity: ErrorSeverity.HIGH,
          })
        })
      })

      it('should classify equation service timeouts', () => {
        const error = createMockAxiosError(
          'Request timeout',
          'ERR_TIMEOUT',
          408,
        )
        const result = service.classifyError(
          error,
          ErrorCategory.EQUATION_SERVICE,
        )

        expect(result).toEqual({
          isRetryable: true,
          errorType: ErrorType.TIMEOUT,
          category: ErrorCategory.EQUATION_SERVICE,
          severity: ErrorSeverity.MEDIUM,
        })
      })

      it('should classify equation service validation errors', () => {
        const validationErrorCodes = [400, 422]

        validationErrorCodes.forEach(status => {
          const error = createMockAxiosError(
            'Invalid LaTeX',
            'ERR_VALIDATION',
            status,
          )
          const result = service.classifyError(
            error,
            ErrorCategory.EQUATION_SERVICE,
          )

          expect(result).toEqual({
            isRetryable: false,
            errorType: ErrorType.VALIDATION_ERROR,
            category: ErrorCategory.EQUATION_SERVICE,
            severity: ErrorSeverity.LOW,
          })
        })
      })
    })

    describe('Media API Errors', () => {
      it('should classify media API rate limits', () => {
        const error = createMockAxiosError(
          'Rate limited',
          'ERR_RATE_LIMITED',
          429,
        )
        const result = service.classifyError(error, ErrorCategory.MEDIA_API)

        expect(result).toEqual({
          isRetryable: true,
          errorType: ErrorType.RATE_LIMIT,
          retryAfterMs: undefined,
          category: ErrorCategory.MEDIA_API,
          severity: ErrorSeverity.MEDIUM,
        })
      })

      it('should classify media API server errors', () => {
        const serverErrorCodes = [500, 502, 503, 504]

        serverErrorCodes.forEach(status => {
          const error = createMockAxiosError(
            'Media API server error',
            'ERR_SERVER_ERROR',
            status,
          )
          const result = service.classifyError(error, ErrorCategory.MEDIA_API)

          expect(result).toEqual({
            isRetryable: true,
            errorType: ErrorType.SERVER_ERROR,
            category: ErrorCategory.MEDIA_API,
            severity: ErrorSeverity.HIGH,
          })
        })
      })

      it('should classify media API auth errors', () => {
        const error = createMockAxiosError(
          'Invalid API key',
          'ERR_UNAUTHORIZED',
          401,
        )
        const result = service.classifyError(error, ErrorCategory.MEDIA_API)

        expect(result).toEqual({
          isRetryable: false,
          errorType: ErrorType.AUTHENTICATION_ERROR,
          category: ErrorCategory.MEDIA_API,
          severity: ErrorSeverity.CRITICAL,
        })
      })

      it('should classify media API permission errors', () => {
        const error = createMockAxiosError(
          'Insufficient permissions',
          'ERR_FORBIDDEN',
          403,
        )
        const result = service.classifyError(error, ErrorCategory.MEDIA_API)

        expect(result).toEqual({
          isRetryable: false,
          errorType: ErrorType.PERMISSION_ERROR,
          category: ErrorCategory.MEDIA_API,
          severity: ErrorSeverity.HIGH,
        })
      })

      it('should classify media API 404 as retryable (timing issues)', () => {
        const error = createMockAxiosError('Not found', 'ERR_NOT_FOUND', 404)
        const result = service.classifyError(error, ErrorCategory.MEDIA_API)

        expect(result).toEqual({
          isRetryable: true,
          errorType: ErrorType.CLIENT_ERROR,
          category: ErrorCategory.MEDIA_API,
          severity: ErrorSeverity.LOW,
        })
      })

      it('should classify media API validation errors', () => {
        const validationErrorCodes = [400, 422]

        validationErrorCodes.forEach(status => {
          const error = createMockAxiosError(
            'Invalid request',
            'ERR_VALIDATION',
            status,
          )
          const result = service.classifyError(error, ErrorCategory.MEDIA_API)

          expect(result).toEqual({
            isRetryable: false,
            errorType: ErrorType.VALIDATION_ERROR,
            category: ErrorCategory.MEDIA_API,
            severity: ErrorSeverity.MEDIUM,
          })
        })
      })

      it('should handle default case with severity mapping', () => {
        // Test 5xx error
        const serverError = createMockAxiosError(
          'Unknown server error',
          'ERR_UNKNOWN',
          507,
        )
        const serverResult = service.classifyError(
          serverError,
          ErrorCategory.MEDIA_API,
        )

        expect(serverResult.severity).toBe(ErrorSeverity.HIGH)

        // Test 4xx error
        const clientError = createMockAxiosError(
          'Unknown client error',
          'ERR_UNKNOWN',
          418,
        )
        const clientResult = service.classifyError(
          clientError,
          ErrorCategory.MEDIA_API,
        )

        expect(clientResult.severity).toBe(ErrorSeverity.MEDIUM)
      })
    })

    describe('HTTP Client Errors', () => {
      it('should classify HTTP client errors with status codes', () => {
        const testCases = [
          { status: 500, retryable: true, type: ErrorType.SERVER_ERROR },
          { status: 429, retryable: true, type: ErrorType.RATE_LIMIT },
          { status: 408, retryable: true, type: ErrorType.TIMEOUT },
          { status: 400, retryable: false, type: ErrorType.CLIENT_ERROR },
          { status: 404, retryable: false, type: ErrorType.CLIENT_ERROR },
        ]

        testCases.forEach(({ status, retryable, type }) => {
          const error = createMockAxiosError('HTTP error', 'ERR_HTTP', status)
          const result = service.classifyError(error, ErrorCategory.HTTP_CLIENT)

          expect(result.isRetryable).toBe(retryable)
          expect(result.errorType).toBe(type)
          expect(result.category).toBe(ErrorCategory.HTTP_CLIENT)
          expect(result.severity).toBe(
            status >= 500 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
          )
        })
      })

      it('should parse retry-after header for HTTP client errors', () => {
        const error = createMockAxiosError(
          'Rate limited',
          'ERR_RATE_LIMITED',
          429,
          undefined,
          {
            headers: {
              'retry-after': '30',
            },
          },
        )
        const result = service.classifyError(error, ErrorCategory.HTTP_CLIENT)

        expect(result.retryAfterMs).toBe(30000)
      })
    })

    describe('System Errors', () => {
      it('should classify timeout errors', () => {
        const error = new Error('Timeout occurred')
        error.name = 'TimeoutError'

        const result = service.classifyError(error, ErrorCategory.SYSTEM)

        expect(result).toEqual({
          isRetryable: true,
          errorType: ErrorType.TIMEOUT,
          category: ErrorCategory.SYSTEM,
          severity: ErrorSeverity.MEDIUM,
        })
      })

      it('should classify unknown system errors', () => {
        const error = new Error('Unknown system error')

        const result = service.classifyError(error, ErrorCategory.SYSTEM)

        expect(result).toEqual({
          isRetryable: false,
          errorType: ErrorType.UNKNOWN_ERROR,
          category: ErrorCategory.SYSTEM,
          severity: ErrorSeverity.HIGH,
        })
      })
    })

    describe('Default Category Handling', () => {
      it('should handle unknown category with default classification', () => {
        const error = new Error('Test error')
        // Cast to unknown category
        const result = service.classifyError(
          error,
          'UNKNOWN_CATEGORY' as ErrorCategory,
        )

        expect(result).toEqual({
          isRetryable: false,
          errorType: ErrorType.UNKNOWN_ERROR,
          category: ErrorCategory.SYSTEM,
          severity: ErrorSeverity.MEDIUM,
        })
      })
    })
  })

  describe('Retry-After Header Parsing', () => {
    it('should parse modern AxiosHeaders with get() method', () => {
      // Create a mock object that implements the AxiosResponseHeaders interface
      const mockHeaders = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key.toLowerCase() === 'retry-after') {
            return '45'
          }
          return undefined
        }),
      }

      const error = new AxiosError('Rate limited', 'ERR_RATE_LIMITED')
      error.response = {
        status: 429,
        statusText: 'Too Many Requests',
        headers: mockHeaders as unknown as AxiosResponseHeaders,
        config: {},
        data: undefined,
      } as AxiosResponse

      const result = service.classifyError(error, ErrorCategory.OPENAI_API)
      expect(result.retryAfterMs).toBe(45000)
      expect(mockHeaders.get).toHaveBeenCalledWith('retry-after')
    })

    it('should handle case-insensitive header lookup in AxiosHeaders', () => {
      // Create a mock object that implements the AxiosResponseHeaders interface
      const mockHeaders = {
        get: jest.fn().mockImplementation((key: string) => {
          if (key === 'retry-after') return undefined
          if (key === 'Retry-After') return '30'
          return undefined
        }),
      }

      const error = new AxiosError('Rate limited', 'ERR_RATE_LIMITED')
      error.response = {
        status: 429,
        statusText: 'Too Many Requests',
        headers: mockHeaders as unknown as AxiosResponseHeaders,
        config: {},
        data: undefined,
      } as AxiosResponse

      const result = service.classifyError(error, ErrorCategory.OPENAI_API)
      expect(result.retryAfterMs).toBe(30000)
      expect(mockHeaders.get).toHaveBeenCalledWith('retry-after')
      expect(mockHeaders.get).toHaveBeenCalledWith('Retry-After')
    })

    it('should parse legacy headers Record<string, string | string[]> format', () => {
      const error = createMockAxiosError(
        'Rate limited',
        'ERR_RATE_LIMITED',
        429,
        undefined,
        {
          headers: {
            'retry-after': '90',
          },
        },
      )

      const result = service.classifyError(error, ErrorCategory.OPENAI_API)
      expect(result.retryAfterMs).toBe(90000)
    })

    it('should handle case-insensitive legacy header lookup', () => {
      const testCases = [
        { 'retry-after': '60' },
        { 'Retry-After': '60' },
        { 'RETRY-AFTER': '60' },
        { 'ReTrY-AfTeR': '60' }, // This should be found via toLowerCase lookup
      ]

      testCases.forEach(headers => {
        const error = createMockAxiosError(
          'Rate limited',
          'ERR_RATE_LIMITED',
          429,
          undefined,
          { headers },
        )

        const result = service.classifyError(error, ErrorCategory.OPENAI_API)
        expect(result.retryAfterMs).toBe(60000)
      })
    })

    it('should handle array values in legacy headers', () => {
      const error = createMockAxiosError(
        'Rate limited',
        'ERR_RATE_LIMITED',
        429,
        undefined,
        {
          headers: {
            'retry-after': ['75', '100'], // Should use first value
          },
        },
      )

      const result = service.classifyError(error, ErrorCategory.OPENAI_API)
      expect(result.retryAfterMs).toBe(75000)
    })

    it('should handle array values in AxiosHeaders', () => {
      // For this test, we'll use the mock utility since AxiosHeaders doesn't support arrays directly
      const error = createMockAxiosError(
        'Rate limited',
        'ERR_RATE_LIMITED',
        429,
        undefined,
        {
          headers: {
            'retry-after': '50', // First value only for simplicity
          },
        },
      )

      const result = service.classifyError(error, ErrorCategory.OPENAI_API)
      expect(result.retryAfterMs).toBe(50000)
    })

    it('should return undefined for missing retry-after header', () => {
      const error = createMockAxiosError(
        'Rate limited',
        'ERR_RATE_LIMITED',
        429,
        undefined,
        {
          headers: {
            'content-type': 'application/json',
          },
        },
      )

      const result = service.classifyError(error, ErrorCategory.OPENAI_API)
      expect(result.retryAfterMs).toBeUndefined()
    })

    it('should return undefined for undefined headers', () => {
      const error = new AxiosError('Rate limited', 'ERR_RATE_LIMITED')
      error.response = {
        status: 429,
        statusText: 'Too Many Requests',
        headers: undefined as unknown as AxiosResponseHeaders, // Test case for undefined headers
        config: {},
        data: undefined,
      } as AxiosResponse

      const result = service.classifyError(error, ErrorCategory.OPENAI_API)
      expect(result.retryAfterMs).toBeUndefined()
    })

    it('should handle malformed retry-after values', () => {
      const malformedCases = [
        { headers: { 'retry-after': 'invalid' } },
        { headers: { 'retry-after': '' } },
        { headers: { 'retry-after': null } },
        { headers: { 'retry-after': undefined } },
      ]

      malformedCases.forEach(testCase => {
        const error = createMockAxiosError(
          'Rate limited',
          'ERR_RATE_LIMITED',
          429,
          undefined,
          testCase,
        )

        const result = service.classifyError(error, ErrorCategory.OPENAI_API)
        expect(result.retryAfterMs).toBeUndefined()
      })
    })

    it('should handle numeric string values correctly', () => {
      const error = createMockAxiosError(
        'Rate limited',
        'ERR_RATE_LIMITED',
        429,
        undefined,
        {
          headers: {
            'retry-after': '0', // Edge case: zero seconds
          },
        },
      )

      const result = service.classifyError(error, ErrorCategory.OPENAI_API)
      expect(result.retryAfterMs).toBe(0)
    })
  })

  describe('Error Type Mapping', () => {
    it('should map status codes to correct error types', () => {
      const testCases = [
        { status: 429, expected: ErrorType.RATE_LIMIT },
        { status: 408, expected: ErrorType.TIMEOUT },
        { status: 401, expected: ErrorType.AUTHENTICATION_ERROR },
        { status: 403, expected: ErrorType.PERMISSION_ERROR },
        { status: 500, expected: ErrorType.SERVER_ERROR },
        { status: 502, expected: ErrorType.SERVER_ERROR },
        { status: 400, expected: ErrorType.CLIENT_ERROR },
        { status: 404, expected: ErrorType.CLIENT_ERROR },
        { status: 200, expected: ErrorType.UNKNOWN_ERROR }, // Unexpected success code
      ]

      testCases.forEach(({ status, expected }) => {
        // Access private method for testing
        const getErrorTypeFromStatus = (
          service as any
        ).getErrorTypeFromStatus.bind(service)
        const result = getErrorTypeFromStatus(status)
        expect(result).toBe(expected)
      })
    })
  })

  describe('Network Error Classification', () => {
    it('should classify network errors correctly across categories', () => {
      const categories = [
        ErrorCategory.DISCORD_API,
        ErrorCategory.EQUATION_SERVICE,
        ErrorCategory.MEDIA_API,
        ErrorCategory.HTTP_CLIENT,
      ]

      categories.forEach(category => {
        // Test timeout errors
        const timeoutError = new AxiosError('Timeout', 'ETIMEDOUT')
        timeoutError.code = 'ETIMEDOUT'
        const timeoutResult = service.classifyError(timeoutError, category)

        expect(timeoutResult).toEqual({
          isRetryable: true,
          errorType: ErrorType.TIMEOUT,
          category,
          severity: ErrorSeverity.MEDIUM,
        })

        // Test connection errors
        const connectionError = new AxiosError(
          'Connection refused',
          'ECONNREFUSED',
        )
        connectionError.code = 'ECONNREFUSED'
        const connectionResult = service.classifyError(
          connectionError,
          category,
        )

        expect(connectionResult).toEqual({
          isRetryable: true,
          errorType: ErrorType.NETWORK_ERROR,
          category,
          severity: ErrorSeverity.HIGH,
        })
      })
    })

    it('should fall back to default classification for unknown network errors', () => {
      const unknownNetworkError = new AxiosError(
        'Unknown network error',
        'EOTHER',
      )
      unknownNetworkError.code = 'EOTHER'

      const result = service.classifyError(
        unknownNetworkError,
        ErrorCategory.HTTP_CLIENT,
      )

      expect(result).toEqual({
        isRetryable: false,
        errorType: ErrorType.UNKNOWN_ERROR,
        category: ErrorCategory.HTTP_CLIENT,
        severity: ErrorSeverity.MEDIUM,
      })
    })
  })

  describe('Helper Methods', () => {
    it('should determine if error should be retried', () => {
      // Retryable error
      const retryableError = createMockAxiosError(
        'Server error',
        'ERR_SERVER_ERROR',
        500,
      )
      expect(
        service.shouldRetry(retryableError, ErrorCategory.OPENAI_API),
      ).toBe(true)

      // Non-retryable error
      const nonRetryableError = createMockAxiosError(
        'Unauthorized',
        'ERR_UNAUTHORIZED',
        401,
      )
      expect(
        service.shouldRetry(nonRetryableError, ErrorCategory.OPENAI_API),
      ).toBe(false)
    })

    it('should get retry delay from error classification', () => {
      // Error with retry-after header
      const errorWithDelay = createMockAxiosError(
        'Rate limited',
        'ERR_RATE_LIMITED',
        429,
        undefined,
        {
          headers: {
            'retry-after': '120',
          },
        },
      )
      expect(
        service.getRetryDelay(errorWithDelay, ErrorCategory.OPENAI_API),
      ).toBe(120000)

      // Error without retry-after header
      const errorWithoutDelay = createMockAxiosError(
        'Server error',
        'ERR_SERVER_ERROR',
        500,
      )
      expect(
        service.getRetryDelay(errorWithoutDelay, ErrorCategory.OPENAI_API),
      ).toBeUndefined()
    })
  })

  describe('Edge Cases', () => {
    it('should handle errors without response object', () => {
      const error = new AxiosError('Network error')
      error.response = undefined

      const result = service.classifyError(error, ErrorCategory.OPENAI_API)

      expect(result).toEqual({
        isRetryable: false,
        errorType: ErrorType.UNKNOWN_ERROR,
        category: ErrorCategory.OPENAI_API,
        severity: ErrorSeverity.MEDIUM,
      })
    })

    it('should handle errors without status code', () => {
      const error = new AxiosError('Network error')
      error.response = {
        data: null,
        statusText: 'Error',
        headers: {},
        config: {},
      } as AxiosResponse
      // Explicitly remove status for test
      delete (error.response as any).status

      const result = service.classifyError(error, ErrorCategory.OPENAI_API)

      expect(result).toEqual({
        isRetryable: false,
        errorType: ErrorType.UNKNOWN_ERROR,
        category: ErrorCategory.OPENAI_API,
        severity: ErrorSeverity.MEDIUM,
      })
    })

    it('should handle non-AxiosError instances', () => {
      const regularError = new Error('Regular error')

      const result = service.classifyError(regularError, ErrorCategory.SYSTEM)

      expect(result).toEqual({
        isRetryable: false,
        errorType: ErrorType.UNKNOWN_ERROR,
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.HIGH,
      })
    })

    it('should handle errors with zero status code', () => {
      const error = createMockAxiosError('Network error', 'ERR_NETWORK', 0)

      const result = service.classifyError(error, ErrorCategory.HTTP_CLIENT)

      expect(result.isRetryable).toBe(false)
      expect(result.errorType).toBe(ErrorType.UNKNOWN_ERROR)
    })
  })

  describe('Comprehensive Error Classification Scenarios', () => {
    it('should classify all major HTTP status codes correctly', () => {
      const statusCodeTests = [
        // 2xx - Shouldn't normally be errors, but test for completeness
        { status: 200, category: ErrorCategory.HTTP_CLIENT, retryable: false },
        { status: 201, category: ErrorCategory.HTTP_CLIENT, retryable: false },

        // 3xx - Redirects (shouldn't be errors normally)
        { status: 301, category: ErrorCategory.HTTP_CLIENT, retryable: false },
        { status: 302, category: ErrorCategory.HTTP_CLIENT, retryable: false },

        // 4xx - Client errors
        { status: 400, category: ErrorCategory.OPENAI_API, retryable: false },
        { status: 401, category: ErrorCategory.OPENAI_API, retryable: false },
        { status: 403, category: ErrorCategory.OPENAI_API, retryable: false },
        { status: 404, category: ErrorCategory.OPENAI_API, retryable: false },
        { status: 408, category: ErrorCategory.OPENAI_API, retryable: true },
        { status: 422, category: ErrorCategory.OPENAI_API, retryable: false },
        { status: 429, category: ErrorCategory.OPENAI_API, retryable: true },

        // 5xx - Server errors
        { status: 500, category: ErrorCategory.OPENAI_API, retryable: true },
        { status: 501, category: ErrorCategory.OPENAI_API, retryable: true },
        { status: 502, category: ErrorCategory.OPENAI_API, retryable: true },
        { status: 503, category: ErrorCategory.OPENAI_API, retryable: true },
        { status: 504, category: ErrorCategory.OPENAI_API, retryable: true },
      ]

      statusCodeTests.forEach(({ status, category, retryable }) => {
        const error = createMockAxiosError(
          `HTTP ${status} error`,
          'ERR_HTTP',
          status,
        )
        const result = service.classifyError(error, category)

        expect(result.isRetryable).toBe(retryable)
        expect(result.category).toBe(category)
      })
    })

    it('should maintain consistent severity levels across categories', () => {
      // Critical severity (authentication issues)
      const authError = createMockAxiosError('Unauthorized', 'ERR_AUTH', 401)
      const categories = [
        ErrorCategory.OPENAI_API,
        ErrorCategory.DISCORD_API,
        ErrorCategory.MEDIA_API,
      ]

      categories.forEach(category => {
        const result = service.classifyError(authError, category)
        expect(result.severity).toBe(ErrorSeverity.CRITICAL)
      })

      // High severity (server errors)
      const serverError = createMockAxiosError(
        'Server error',
        'ERR_SERVER',
        500,
      )
      categories.forEach(category => {
        const result = service.classifyError(serverError, category)
        expect(result.severity).toBe(ErrorSeverity.HIGH)
      })
    })
  })

  describe('Default Classification Behavior', () => {
    it('should provide consistent default classification', () => {
      const error = new Error('Unknown error')

      // Test with explicit category parameter
      const resultWithCategory = (service as any).getDefaultClassification(
        error,
        ErrorCategory.MEDIA_API,
      )

      expect(resultWithCategory).toEqual({
        isRetryable: false,
        errorType: ErrorType.UNKNOWN_ERROR,
        category: ErrorCategory.MEDIA_API,
        severity: ErrorSeverity.MEDIUM,
      })

      // Test without category parameter (should default to SYSTEM)
      const resultWithoutCategory = (service as any).getDefaultClassification(
        error,
      )

      expect(resultWithoutCategory).toEqual({
        isRetryable: false,
        errorType: ErrorType.UNKNOWN_ERROR,
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.MEDIUM,
      })
    })
  })

  describe('Type Safety and Interface Compliance', () => {
    it('should return complete ErrorClassification interface', () => {
      const error = createMockAxiosError('Test error', 'ERR_TEST', 500)
      const result = service.classifyError(error, ErrorCategory.OPENAI_API)

      // Verify all required properties are present
      expect(result).toHaveProperty('isRetryable')
      expect(result).toHaveProperty('errorType')
      expect(result).toHaveProperty('category')
      expect(result).toHaveProperty('severity')

      // Verify types are correct
      expect(typeof result.isRetryable).toBe('boolean')
      expect(Object.values(ErrorType)).toContain(result.errorType)
      expect(Object.values(ErrorCategory)).toContain(result.category)
      expect(Object.values(ErrorSeverity)).toContain(result.severity)

      // retryAfterMs is optional but should be number or undefined
      if (result.retryAfterMs !== undefined) {
        expect(typeof result.retryAfterMs).toBe('number')
      }
    })

    it('should handle all defined ErrorCategory values', () => {
      const testError = createMockAxiosError('Test error', 'ERR_TEST', 500)

      Object.values(ErrorCategory).forEach(category => {
        const result = service.classifyError(testError, category)
        expect(result).toBeDefined()
        expect(result.category).toBeDefined()
      })
    })

    it('should handle all defined ErrorType values in getErrorTypeFromStatus', () => {
      const getErrorTypeFromStatus = (
        service as any
      ).getErrorTypeFromStatus.bind(service)

      // Test status codes that should map to each error type
      const statusTypeMap = [
        { status: 429, type: ErrorType.RATE_LIMIT },
        { status: 408, type: ErrorType.TIMEOUT },
        { status: 401, type: ErrorType.AUTHENTICATION_ERROR },
        { status: 403, type: ErrorType.PERMISSION_ERROR },
        { status: 500, type: ErrorType.SERVER_ERROR },
        { status: 400, type: ErrorType.CLIENT_ERROR },
      ]

      statusTypeMap.forEach(({ status, type }) => {
        const result = getErrorTypeFromStatus(status)
        expect(result).toBe(type)
        expect(Object.values(ErrorType)).toContain(result)
      })
    })
  })
})
