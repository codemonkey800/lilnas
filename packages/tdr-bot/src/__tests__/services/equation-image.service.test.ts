import { TestingModule } from '@nestjs/testing'
import axios, { AxiosResponse } from 'axios'
import { LRUCache } from 'lru-cache'

import {
  createMockAxiosResponse,
  createMockErrorClassificationService,
  createMockRetryService,
  createTestingModule,
} from 'src/__tests__/test-utils'
import { EquationImageService } from 'src/services/equation-image.service'
import { ErrorClassificationService } from 'src/utils/error-classifier'
import { RetryService } from 'src/utils/retry.service'

interface EquationResponse {
  imageUrl: string
  latex: string
}

jest.mock('axios')
jest.mock('lru-cache')

describe('EquationImageService', () => {
  let service: EquationImageService
  let module: TestingModule
  let mockAxios: jest.Mocked<typeof axios>
  let mockCache: jest.Mocked<LRUCache<string, { url: string; latex: string }>>

  beforeEach(async () => {
    // Setup axios mock
    mockAxios = axios as jest.Mocked<typeof axios>
    mockAxios.post.mockClear()

    // Setup LRU cache mock
    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
      has: jest.fn(),
      delete: jest.fn(),
      clear: jest.fn(),
    } as unknown as jest.Mocked<
      LRUCache<string, { url: string; latex: string }>
    >
    ;(LRUCache as jest.MockedClass<typeof LRUCache>).mockImplementation(
      () => mockCache as unknown as LRUCache<object, object>,
    )

    module = await createTestingModule([
      EquationImageService,
      {
        provide: RetryService,
        useValue: createMockRetryService(),
      },
      {
        provide: ErrorClassificationService,
        useValue: createMockErrorClassificationService(),
      },
    ])
    service = module.get<EquationImageService>(EquationImageService)
  })

  afterEach(async () => {
    if (module) {
      await module.close()
    }
  })

  describe('getImage', () => {
    it('should return undefined for empty latex input', async () => {
      const result1 = await service.getImage(null)
      const result2 = await service.getImage(undefined)
      const result3 = await service.getImage('')

      expect(result1).toBeUndefined()
      expect(result2).toBeUndefined()
      expect(result3).toBeUndefined()
      expect(mockAxios.post).not.toHaveBeenCalled()
    })

    it('should fetch and cache new image', async () => {
      const latex = '\\frac{1}{2}'
      const apiResponse = {
        bucket: 'equations',
        file: 'test-file.png',
        url: 'https://storage.lilnas.io/equations/test-file.png',
      }

      mockCache.get.mockReturnValue(undefined)
      mockAxios.post.mockResolvedValue(createMockAxiosResponse(apiResponse))

      const result = await service.getImage(latex)

      expect(result).toEqual(apiResponse)
      expect(mockCache.get).toHaveBeenCalledWith(latex)
      expect(mockCache.set).toHaveBeenCalledWith(latex, apiResponse)
      expect(mockAxios.post).toHaveBeenCalledWith(
        `${process.env.EQUATIONS_URL}/equations`,
        {
          latex,
          token: process.env.EQUATIONS_API_KEY,
        },
        { timeout: 10000 },
      )
    })

    it('should return cached image without API call', async () => {
      const latex = '\\sqrt{x}'
      const cachedData = {
        url: 'https://storage.lilnas.io/equations/cached.png',
        latex: latex,
      }

      mockCache.get.mockReturnValue(cachedData)

      const result = await service.getImage(latex)

      expect(result).toEqual(cachedData)
      expect(mockCache.get).toHaveBeenCalledWith(latex)
      expect(mockCache.set).not.toHaveBeenCalled()
      expect(mockAxios.post).not.toHaveBeenCalled()
    })

    it('should handle API failure gracefully', async () => {
      const latex = 'invalid\\latex'
      const errorResponse = {
        message: 'Invalid LaTeX syntax',
        status: 400,
      }

      mockCache.get.mockReturnValue(undefined)
      mockAxios.post.mockResolvedValue(
        createMockAxiosResponse(errorResponse, 400),
      )

      const result = await service.getImage(latex)

      expect(result).toBeUndefined()
      expect(mockCache.set).not.toHaveBeenCalled()
    })

    it('should handle network errors', async () => {
      const latex = '\\sum_{i=1}^{n} i'

      mockCache.get.mockReturnValue(undefined)
      mockAxios.post.mockRejectedValue(new Error('Network error'))

      expect(await service.getImage(latex)).toBeUndefined()
      expect(mockCache.set).not.toHaveBeenCalled()
    })

    it('should handle invalid API response schema', async () => {
      const latex = 'e^{i\\pi} + 1 = 0'

      mockCache.get.mockReturnValue(undefined)
      mockAxios.post.mockResolvedValue(
        createMockAxiosResponse({ invalid: 'response' }),
      )

      expect(await service.getImage(latex)).toBeUndefined()
      expect(mockCache.set).not.toHaveBeenCalled()
    })
  })

  describe('caching behavior', () => {
    it('should use the same cache key for identical LaTeX', async () => {
      const latex = '\\int_0^1 x^2 dx'
      const apiResponse = {
        bucket: 'equations',
        file: 'integral.png',
        url: 'https://storage.lilnas.io/equations/integral.png',
      }

      mockCache.get.mockReturnValue(undefined)
      mockAxios.post.mockResolvedValue(createMockAxiosResponse(apiResponse))

      // First call
      await service.getImage(latex)

      // Setup cache to return value
      mockCache.get.mockReturnValue({
        url: apiResponse.url,
        latex: latex,
      })

      // Second call
      await service.getImage(latex)

      expect(mockAxios.post).toHaveBeenCalledTimes(1)
      expect(mockCache.get).toHaveBeenCalledTimes(2)
      expect(mockCache.get).toHaveBeenCalledWith(latex)
    })

    it('should treat different LaTeX as different cache entries', async () => {
      const latex1 = 'x^2'
      const latex2 = 'x^3'
      const response1 = {
        bucket: 'equations',
        file: 'x2.png',
        url: 'https://storage.lilnas.io/equations/x2.png',
      }
      const response2 = {
        bucket: 'equations',
        file: 'x3.png',
        url: 'https://storage.lilnas.io/equations/x3.png',
      }

      mockCache.get.mockReturnValue(undefined)
      mockAxios.post
        .mockResolvedValueOnce(createMockAxiosResponse(response1))
        .mockResolvedValueOnce(createMockAxiosResponse(response2))

      const result1 = await service.getImage(latex1)
      const result2 = await service.getImage(latex2)

      expect(result1).toEqual(response1)
      expect(result2).toEqual(response2)
      expect(mockCache.set).toHaveBeenCalledWith(latex1, response1)
      expect(mockCache.set).toHaveBeenCalledWith(latex2, response2)
      expect(mockAxios.post).toHaveBeenCalledTimes(2)
    })
  })

  describe('performance logging', () => {
    it('should log performance metrics', async () => {
      const latex = '\\frac{d}{dx} e^x = e^x'
      const apiResponse = {
        bucket: 'equations',
        file: 'derivative.png',
        url: 'https://storage.lilnas.io/equations/derivative.png',
      }

      mockCache.get.mockReturnValue(undefined)

      // Mock performance.now to test timing
      const originalNow = performance.now
      let callCount = 0
      performance.now = jest.fn(() => {
        // Return 0 for start, 150 for end
        return callCount++ === 0 ? 0 : 150
      })

      mockAxios.post.mockResolvedValue(createMockAxiosResponse(apiResponse))

      await service.getImage(latex)

      // Restore original performance.now
      performance.now = originalNow

      expect(mockAxios.post).toHaveBeenCalled()
      // The service logs the duration, but we're not testing the logger directly
    })
  })

  describe('edge cases', () => {
    it('should handle very long LaTeX strings', async () => {
      const longLatex = '\\sum_{i=1}^{1000} ' + 'x_i^2 + '.repeat(100)
      const apiResponse = {
        bucket: 'equations',
        file: 'long.png',
        url: 'https://storage.lilnas.io/equations/long.png',
      }

      mockCache.get.mockReturnValue(undefined)
      mockAxios.post.mockResolvedValue(createMockAxiosResponse(apiResponse))

      const result = await service.getImage(longLatex)

      expect(result).toEqual(apiResponse)
      expect(mockCache.set).toHaveBeenCalledWith(longLatex.trim(), apiResponse)
    })

    it('should handle LaTeX with special characters', async () => {
      const specialLatex = '\\text{Hello "World"} & \\alpha < \\beta'
      const apiResponse = {
        bucket: 'equations',
        file: 'special.png',
        url: 'https://storage.lilnas.io/equations/special.png',
      }

      mockCache.get.mockReturnValue(undefined)
      mockAxios.post.mockResolvedValue(createMockAxiosResponse(apiResponse))

      const result = await service.getImage(specialLatex)

      expect(result).toEqual(apiResponse)
    })

    it('should handle concurrent requests for the same LaTeX', async () => {
      const latex = '\\pi r^2'
      const apiResponse = {
        bucket: 'equations',
        file: 'circle.png',
        url: 'https://storage.lilnas.io/equations/circle.png',
      }

      mockCache.get.mockReturnValue(undefined)

      let resolvePost: (value: unknown) => void
      const postPromise = new Promise(resolve => {
        resolvePost = resolve
      })

      mockAxios.post.mockReturnValue(
        postPromise as Promise<AxiosResponse<EquationResponse>>,
      )

      // Start two concurrent requests
      const promise1 = service.getImage(latex)
      const promise2 = service.getImage(latex)

      // Resolve the API call
      resolvePost!(createMockAxiosResponse(apiResponse))

      const [result1, result2] = await Promise.all([promise1, promise2])

      // Both should get the same result
      expect(result1).toEqual(apiResponse)
      expect(result2).toEqual(apiResponse)

      // But only one API call should be made due to request deduplication
      expect(mockAxios.post).toHaveBeenCalledTimes(1) // Request deduplication prevents duplicate calls
    })
  })
})
