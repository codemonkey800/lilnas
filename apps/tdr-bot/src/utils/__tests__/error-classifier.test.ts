import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

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

  describe('classifyOpenAIError', () => {
    it('should classify 429 as retryable rate limit error', () => {
      const error = createMockAxiosError(
        'Request failed with status code 429',
        'ERR_BAD_REQUEST',
        429,
        undefined,
        { headers: { 'retry-after': '60' } },
      )

      const classification = service.classifyError(
        error,
        ErrorCategory.OPENAI_API,
      )

      expect(classification).toEqual({
        isRetryable: true,
        errorType: ErrorType.RATE_LIMIT,
        retryAfterMs: 60000,
        category: ErrorCategory.OPENAI_API,
        severity: ErrorSeverity.MEDIUM,
      })
    })

    it('should classify 500 as retryable server error', () => {
      const error = createMockAxiosError(
        'Request failed with status code 500',
        'ERR_BAD_REQUEST',
        500,
      )

      const classification = service.classifyError(
        error,
        ErrorCategory.OPENAI_API,
      )

      expect(classification).toEqual({
        isRetryable: true,
        errorType: ErrorType.SERVER_ERROR,
        category: ErrorCategory.OPENAI_API,
        severity: ErrorSeverity.HIGH,
      })
    })

    it('should classify 401 as non-retryable authentication error', () => {
      const error = createMockAxiosError(
        'Request failed with status code 401',
        'ERR_BAD_REQUEST',
        401,
        null,
      )

      const classification = service.classifyError(
        error,
        ErrorCategory.OPENAI_API,
      )

      expect(classification).toEqual({
        isRetryable: false,
        errorType: ErrorType.AUTHENTICATION_ERROR,
        category: ErrorCategory.OPENAI_API,
        severity: ErrorSeverity.CRITICAL,
      })
    })

    it('should classify 400 as non-retryable validation error', () => {
      const error = createMockAxiosError(
        'Request failed with status code 400',
        'ERR_BAD_REQUEST',
        400,
      )

      const classification = service.classifyError(
        error,
        ErrorCategory.OPENAI_API,
      )

      expect(classification).toEqual({
        isRetryable: false,
        errorType: ErrorType.VALIDATION_ERROR,
        category: ErrorCategory.OPENAI_API,
        severity: ErrorSeverity.MEDIUM,
      })
    })

    it('should classify network timeout as retryable', () => {
      const error = createMockAxiosError(
        'Request failed with timeout',
        'ECONNABORTED',
      )

      const classification = service.classifyError(
        error,
        ErrorCategory.OPENAI_API,
      )

      expect(classification).toEqual({
        isRetryable: true,
        errorType: ErrorType.TIMEOUT,
        category: ErrorCategory.OPENAI_API,
        severity: ErrorSeverity.MEDIUM,
      })
    })

    it('should classify connection refused as retryable', () => {
      const error = createMockAxiosError(
        'Request failed with connection refused',
        'ECONNREFUSED',
      )

      const classification = service.classifyError(
        error,
        ErrorCategory.OPENAI_API,
      )

      expect(classification).toEqual({
        isRetryable: true,
        errorType: ErrorType.NETWORK_ERROR,
        category: ErrorCategory.OPENAI_API,
        severity: ErrorSeverity.HIGH,
      })
    })
  })

  describe('classifyDiscordError', () => {
    it('should classify 429 with retry-after header', () => {
      const error = createMockAxiosError(
        'Request failed with status code 429',
        'ERR_BAD_REQUEST',
        429,
        undefined,
        {
          headers: { 'retry-after': '30' },
        },
      )

      const classification = service.classifyError(
        error,
        ErrorCategory.DISCORD_API,
      )

      expect(classification).toEqual({
        isRetryable: true,
        errorType: ErrorType.RATE_LIMIT,
        retryAfterMs: 30000,
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.MEDIUM,
      })
    })

    it('should classify 403 as non-retryable permission error', () => {
      const error = createMockAxiosError(
        'Request failed with status code 403',
        'ERR_BAD_REQUEST',
        403,
      )

      const classification = service.classifyError(
        error,
        ErrorCategory.DISCORD_API,
      )

      expect(classification).toEqual({
        isRetryable: false,
        errorType: ErrorType.PERMISSION_ERROR,
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.HIGH,
      })
    })

    it('should classify 500 as retryable server error', () => {
      const error = createMockAxiosError(
        'Request failed with status code 500',
        'ERR_BAD_REQUEST',
        500,
      )

      const classification = service.classifyError(
        error,
        ErrorCategory.DISCORD_API,
      )

      expect(classification).toEqual({
        isRetryable: true,
        errorType: ErrorType.SERVER_ERROR,
        category: ErrorCategory.DISCORD_API,
        severity: ErrorSeverity.HIGH,
      })
    })
  })

  describe('classifyEquationServiceError', () => {
    it('should classify 408 as retryable timeout error', () => {
      const error = createMockAxiosError(
        'Request failed with status code 408',
        'ERR_BAD_REQUEST',
        408,
      )

      const classification = service.classifyError(
        error,
        ErrorCategory.EQUATION_SERVICE,
      )

      expect(classification).toEqual({
        isRetryable: true,
        errorType: ErrorType.TIMEOUT,
        category: ErrorCategory.EQUATION_SERVICE,
        severity: ErrorSeverity.MEDIUM,
      })
    })

    it('should classify 422 as non-retryable validation error', () => {
      const error = createMockAxiosError(
        'Request failed with status code 422',
        'ERR_BAD_REQUEST',
        422,
      )

      const classification = service.classifyError(
        error,
        ErrorCategory.EQUATION_SERVICE,
      )

      expect(classification).toEqual({
        isRetryable: false,
        errorType: ErrorType.VALIDATION_ERROR,
        category: ErrorCategory.EQUATION_SERVICE,
        severity: ErrorSeverity.LOW,
      })
    })
  })

  describe('classifySystemError', () => {
    it('should classify timeout errors as retryable', () => {
      const error = new Error('Operation timed out')
      error.name = 'TimeoutError'

      const classification = service.classifyError(error, ErrorCategory.SYSTEM)

      expect(classification).toEqual({
        isRetryable: true,
        errorType: ErrorType.TIMEOUT,
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.MEDIUM,
      })
    })

    it('should classify unknown errors as non-retryable', () => {
      const error = new Error('Unknown error')

      const classification = service.classifyError(error, ErrorCategory.SYSTEM)

      expect(classification).toEqual({
        isRetryable: false,
        errorType: ErrorType.UNKNOWN_ERROR,
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.HIGH,
      })
    })
  })

  describe('utility methods', () => {
    it('should determine if error should be retried', () => {
      const retryableError = createMockAxiosError(
        'Request failed with status code 500',
        'ERR_BAD_REQUEST',
        500,
      )

      const nonRetryableError = createMockAxiosError(
        'Request failed with status code 400',
        'ERR_BAD_REQUEST',
        400,
      )

      expect(
        service.shouldRetry(retryableError, ErrorCategory.OPENAI_API),
      ).toBe(true)
      expect(
        service.shouldRetry(nonRetryableError, ErrorCategory.OPENAI_API),
      ).toBe(false)
    })

    it('should get retry delay from error', () => {
      const errorWithRetryAfter = createMockAxiosError(
        'Request failed with status code 429',
        'ERR_BAD_REQUEST',
        429,
        undefined,
        {
          headers: { 'retry-after': '45' },
        },
      )

      const errorWithoutRetryAfter = createMockAxiosError(
        'Request failed with status code 500',
        'ERR_BAD_REQUEST',
        500,
      )

      expect(
        service.getRetryDelay(errorWithRetryAfter, ErrorCategory.OPENAI_API),
      ).toBe(45000)
      expect(
        service.getRetryDelay(errorWithoutRetryAfter, ErrorCategory.OPENAI_API),
      ).toBeUndefined()
    })
  })

  describe('parseRetryAfter', () => {
    it('should parse retry-after header correctly', () => {
      const parseRetryAfter = service['parseRetryAfter'].bind(service)

      expect(parseRetryAfter({ 'retry-after': '60' })).toBe(60000)
      expect(parseRetryAfter({ 'Retry-After': '30' })).toBe(30000)
      expect(parseRetryAfter({ 'retry-after': 'invalid' })).toBeUndefined()
      expect(parseRetryAfter({})).toBeUndefined()
    })
  })

  describe('getErrorTypeFromStatus', () => {
    it('should map status codes to error types correctly', () => {
      const getErrorTypeFromStatus =
        service['getErrorTypeFromStatus'].bind(service)

      expect(getErrorTypeFromStatus(429)).toBe(ErrorType.RATE_LIMIT)
      expect(getErrorTypeFromStatus(408)).toBe(ErrorType.TIMEOUT)
      expect(getErrorTypeFromStatus(401)).toBe(ErrorType.AUTHENTICATION_ERROR)
      expect(getErrorTypeFromStatus(403)).toBe(ErrorType.PERMISSION_ERROR)
      expect(getErrorTypeFromStatus(500)).toBe(ErrorType.SERVER_ERROR)
      expect(getErrorTypeFromStatus(400)).toBe(ErrorType.CLIENT_ERROR)
      expect(getErrorTypeFromStatus(200)).toBe(ErrorType.UNKNOWN_ERROR)
    })
  })
})
