import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import {
  ErrorCategory,
  ErrorClassificationService,
  ErrorSeverity,
  ErrorType,
} from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

describe('RetryService', () => {
  let service: RetryService

  beforeEach(async () => {
    const mockErrorClassificationService = {
      classifyError: jest.fn().mockReturnValue({
        isRetryable: true,
        errorType: ErrorType.NETWORK_ERROR,
        category: ErrorCategory.SYSTEM,
        severity: ErrorSeverity.MEDIUM,
        retryAfterMs: undefined,
      }),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetryService,
        {
          provide: ErrorClassificationService,
          useValue: mockErrorClassificationService,
        },
      ],
    }).compile()

    service = module.get<RetryService>(RetryService)
    jest.spyOn(Logger.prototype, 'debug').mockImplementation()
    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
  })

  afterEach(() => {
    jest.clearAllMocks()
    jest.restoreAllMocks()
    jest.clearAllTimers()
  })

  describe('executeWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const mockOperation = jest.fn().mockResolvedValue('success')

      const result = await service.executeWithRetry(
        mockOperation,
        {
          maxAttempts: 3,
          baseDelay: 100,
          maxDelay: 1000,
          backoffFactor: 2,
          jitter: false,
        },
        'test-operation',
        ErrorCategory.SYSTEM,
      )

      expect(result).toBe('success')
      expect(mockOperation).toHaveBeenCalledTimes(1)
    })

    it('should retry on failure and eventually succeed', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValue('success')

      const result = await service.executeWithRetry(
        mockOperation,
        {
          maxAttempts: 3,
          baseDelay: 10,
          maxDelay: 1000,
          backoffFactor: 2,
          jitter: false,
        },
        'test-operation',
        ErrorCategory.SYSTEM,
      )

      expect(result).toBe('success')
      expect(mockOperation).toHaveBeenCalledTimes(3)
    })

    it('should fail after max attempts', async () => {
      const mockOperation = jest
        .fn()
        .mockRejectedValue(new Error('Persistent failure'))

      await expect(
        service.executeWithRetry(
          mockOperation,
          {
            maxAttempts: 3,
            baseDelay: 10,
            maxDelay: 1000,
            backoffFactor: 2,
            jitter: false,
          },
          'test-operation',
          ErrorCategory.SYSTEM,
        ),
      ).rejects.toThrow('Persistent failure')

      expect(mockOperation).toHaveBeenCalledTimes(3)
    })

    it('should calculate exponential backoff correctly', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Failure'))
      const sleepSpy = jest
        .spyOn(
          service as unknown as { sleep: (ms: number) => Promise<void> },
          'sleep',
        )
        .mockResolvedValue(undefined)

      await expect(
        service.executeWithRetry(
          mockOperation,
          {
            maxAttempts: 3,
            baseDelay: 100,
            maxDelay: 1000,
            backoffFactor: 2,
            jitter: false,
          },
          'test-operation',
          ErrorCategory.SYSTEM,
        ),
      ).rejects.toThrow('Failure')

      // Should have called sleep twice (between attempts)
      expect(sleepSpy).toHaveBeenCalledTimes(2)
      expect(sleepSpy).toHaveBeenNthCalledWith(1, 100) // 100 * 2^0
      expect(sleepSpy).toHaveBeenNthCalledWith(2, 200) // 100 * 2^1
    })

    it('should apply jitter when enabled', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Failure'))
      const sleepSpy = jest
        .spyOn(
          service as unknown as { sleep: (ms: number) => Promise<void> },
          'sleep',
        )
        .mockResolvedValue(undefined)

      await expect(
        service.executeWithRetry(
          mockOperation,
          {
            maxAttempts: 3,
            baseDelay: 100,
            maxDelay: 1000,
            backoffFactor: 2,
            jitter: true,
          },
          'test-operation',
          ErrorCategory.SYSTEM,
        ),
      ).rejects.toThrow('Failure')

      // Should have called sleep twice with jittered values
      expect(sleepSpy).toHaveBeenCalledTimes(2)
      // Values should be less than or equal to the exponential delay
      expect(sleepSpy.mock.calls[0][0]).toBeLessThanOrEqual(100)
      expect(sleepSpy.mock.calls[1][0]).toBeLessThanOrEqual(200)
    })

    it('should respect max delay', async () => {
      const mockOperation = jest.fn().mockRejectedValue(new Error('Failure'))
      const sleepSpy = jest
        .spyOn(
          service as unknown as { sleep: (ms: number) => Promise<void> },
          'sleep',
        )
        .mockResolvedValue(undefined)

      await expect(
        service.executeWithRetry(
          mockOperation,
          {
            maxAttempts: 5,
            baseDelay: 100,
            maxDelay: 150,
            backoffFactor: 2,
            jitter: false,
          },
          'test-operation',
          ErrorCategory.SYSTEM,
        ),
      ).rejects.toThrow('Failure')

      // All sleep calls should respect max delay
      sleepSpy.mock.calls.forEach(call => {
        expect(call[0]).toBeLessThanOrEqual(150)
      })
    })

    it('should handle timeout', async () => {
      jest.useFakeTimers()

      let resolveOperation: (() => void) | undefined
      const mockOperation = jest.fn().mockImplementation(
        () =>
          new Promise<void>(resolve => {
            resolveOperation = resolve
          }),
      )

      const operationPromise = service.executeWithRetry(
        mockOperation,
        {
          maxAttempts: 1,
          baseDelay: 100,
          maxDelay: 1000,
          backoffFactor: 2,
          jitter: false,
          timeout: 100,
        },
        'test-operation',
        ErrorCategory.SYSTEM,
      )

      // Fast-forward time to trigger the timeout
      jest.advanceTimersByTime(100)

      await expect(operationPromise).rejects.toThrow(
        'Operation timed out after 100ms',
      )

      // Cleanup - resolve the hanging operation if it exists
      if (resolveOperation) {
        resolveOperation()
      }

      jest.useRealTimers()
    })
  })

  describe('delay calculation', () => {
    it('should calculate delay correctly', () => {
      const calculateDelay = service['calculateDelay'].bind(service)

      const config = {
        maxAttempts: 5,
        baseDelay: 1000,
        maxDelay: 30000,
        backoffFactor: 2,
        jitter: false,
      }

      expect(calculateDelay(0, config)).toBe(1000) // 1000 * 2^0
      expect(calculateDelay(1, config)).toBe(2000) // 1000 * 2^1
      expect(calculateDelay(2, config)).toBe(4000) // 1000 * 2^2
      expect(calculateDelay(3, config)).toBe(8000) // 1000 * 2^3
    })

    it('should respect max delay', () => {
      const calculateDelay = service['calculateDelay'].bind(service)

      const config = {
        maxAttempts: 5,
        baseDelay: 1000,
        maxDelay: 5000,
        backoffFactor: 2,
        jitter: false,
      }

      expect(calculateDelay(0, config)).toBe(1000)
      expect(calculateDelay(1, config)).toBe(2000)
      expect(calculateDelay(2, config)).toBe(4000)
      expect(calculateDelay(3, config)).toBe(5000) // Should be capped at maxDelay
      expect(calculateDelay(4, config)).toBe(5000) // Should be capped at maxDelay
    })
  })
})
