import { list } from '../../commands/list'
import { getServices } from '../../utils'

// Mock dependencies
jest.mock('../../utils')

const mockGetServices = getServices as jest.MockedFunction<typeof getServices>

// Mock console methods
const mockConsoleLog = console.log as jest.MockedFunction<typeof console.log>

describe('list command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('successful execution', () => {
    it('should list all production services', async () => {
      const mockServices = ['app1', 'app2', 'database', 'redis']
      mockGetServices.mockResolvedValue(mockServices)

      await list()

      expect(mockGetServices).toHaveBeenCalledWith()
      expect(mockConsoleLog).toHaveBeenCalledWith('app1\napp2\ndatabase\nredis')
    })

    it('should handle empty services list', async () => {
      mockGetServices.mockResolvedValue([])

      await list()

      expect(mockGetServices).toHaveBeenCalledWith()
      expect(mockConsoleLog).toHaveBeenCalledWith('')
    })

    it('should handle single service', async () => {
      mockGetServices.mockResolvedValue(['only-service'])

      await list()

      expect(mockGetServices).toHaveBeenCalledWith()
      expect(mockConsoleLog).toHaveBeenCalledWith('only-service')
    })

    it('should handle services with special characters', async () => {
      const mockServices = ['app-with-dashes', 'app_with_underscores', 'app123']
      mockGetServices.mockResolvedValue(mockServices)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith('app-with-dashes\napp_with_underscores\napp123')
    })

    it('should handle services with mixed case', async () => {
      const mockServices = ['MyApp', 'REDIS', 'postgreSQL']
      mockGetServices.mockResolvedValue(mockServices)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith('MyApp\nREDIS\npostgreSQL')
    })
  })

  describe('service loading', () => {
    it('should call getServices without dev flag', async () => {
      mockGetServices.mockResolvedValue(['app1', 'app2'])

      await list()

      expect(mockGetServices).toHaveBeenCalledWith()
      expect(mockGetServices).toHaveBeenCalledTimes(1)
    })

    it('should handle getServices errors', async () => {
      mockGetServices.mockRejectedValue(new Error('Failed to load services'))

      await expect(list()).rejects.toThrow('Failed to load services')
      expect(mockConsoleLog).not.toHaveBeenCalled()
    })

    it('should handle getServices timeout', async () => {
      mockGetServices.mockRejectedValue(new Error('Timeout loading services'))

      await expect(list()).rejects.toThrow('Timeout loading services')
      expect(mockConsoleLog).not.toHaveBeenCalled()
    })

    it('should handle file system errors', async () => {
      mockGetServices.mockRejectedValue(new Error('ENOENT: no such file or directory'))

      await expect(list()).rejects.toThrow('ENOENT: no such file or directory')
      expect(mockConsoleLog).not.toHaveBeenCalled()
    })

    it('should handle YAML parsing errors', async () => {
      mockGetServices.mockRejectedValue(new Error('Invalid YAML syntax'))

      await expect(list()).rejects.toThrow('Invalid YAML syntax')
      expect(mockConsoleLog).not.toHaveBeenCalled()
    })
  })

  describe('output formatting', () => {
    it('should join services with newlines', async () => {
      const mockServices = ['service1', 'service2', 'service3']
      mockGetServices.mockResolvedValue(mockServices)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith('service1\nservice2\nservice3')
    })

    it('should handle services with long names', async () => {
      const longServiceName = 'a'.repeat(100)
      mockGetServices.mockResolvedValue([longServiceName])

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith(longServiceName)
    })

    it('should handle many services', async () => {
      const manyServices = Array.from({ length: 50 }, (_, i) => `service${i}`)
      mockGetServices.mockResolvedValue(manyServices)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith(manyServices.join('\n'))
    })

    it('should handle services with numbers', async () => {
      const mockServices = ['123', '456', '789']
      mockGetServices.mockResolvedValue(mockServices)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith('123\n456\n789')
    })

    it('should handle services with version suffixes', async () => {
      const mockServices = ['postgres-14', 'redis-7', 'nginx-1.21']
      mockGetServices.mockResolvedValue(mockServices)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith('postgres-14\nredis-7\nnginx-1.21')
    })
  })

  describe('edge cases', () => {
    it('should handle undefined services result', async () => {
      mockGetServices.mockResolvedValue(undefined as any)

      await expect(list()).rejects.toThrow()
    })

    it('should handle null services result', async () => {
      mockGetServices.mockResolvedValue(null as any)

      await expect(list()).rejects.toThrow()
    })

    it('should handle non-array services result', async () => {
      mockGetServices.mockResolvedValue('not-an-array' as any)

      await expect(list()).rejects.toThrow()
    })

    it('should handle services with null values', async () => {
      mockGetServices.mockResolvedValue([null, 'valid-service'] as any)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith('null\nvalid-service')
    })

    it('should handle services with undefined values', async () => {
      mockGetServices.mockResolvedValue([undefined, 'valid-service'] as any)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith('undefined\nvalid-service')
    })
  })

  describe('integration scenarios', () => {
    it('should handle realistic service listing', async () => {
      const realisticServices = [
        'frontend',
        'backend',
        'database',
        'redis',
        'nginx-proxy',
        'monitoring',
        'logging'
      ]
      mockGetServices.mockResolvedValue(realisticServices)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith(realisticServices.join('\n'))
    })

    it('should handle minimal service setup', async () => {
      const minimalServices = ['app']
      mockGetServices.mockResolvedValue(minimalServices)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith('app')
    })

    it('should handle complex service setup', async () => {
      const complexServices = [
        'frontend-react',
        'backend-node',
        'backend-python',
        'database-postgres',
        'database-mongo',
        'cache-redis',
        'queue-rabbitmq',
        'proxy-nginx',
        'monitoring-prometheus',
        'logging-elasticsearch'
      ]
      mockGetServices.mockResolvedValue(complexServices)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith(complexServices.join('\n'))
    })

    it('should handle alphabetically sorted services', async () => {
      const sortedServices = ['app', 'backend', 'database', 'frontend', 'nginx', 'redis']
      mockGetServices.mockResolvedValue(sortedServices)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith('app\nbackend\ndatabase\nfrontend\nnginx\nredis')
    })
  })

  describe('error recovery', () => {
    it('should not catch and suppress errors', async () => {
      mockGetServices.mockRejectedValue(new Error('Service loading failed'))

      await expect(list()).rejects.toThrow('Service loading failed')
    })

    it('should not continue execution after errors', async () => {
      mockGetServices.mockRejectedValue(new Error('Failed'))

      await expect(list()).rejects.toThrow('Failed')
      expect(mockConsoleLog).not.toHaveBeenCalled()
    })

    it('should handle async errors properly', async () => {
      mockGetServices.mockImplementation(async () => {
        throw new Error('Async error')
      })

      await expect(list()).rejects.toThrow('Async error')
      expect(mockConsoleLog).not.toHaveBeenCalled()
    })
  })

  describe('performance considerations', () => {
    it('should handle large service lists efficiently', async () => {
      const largeServiceList = Array.from({ length: 1000 }, (_, i) => `service${i}`)
      mockGetServices.mockResolvedValue(largeServiceList)

      await list()

      expect(mockConsoleLog).toHaveBeenCalledWith(largeServiceList.join('\n'))
      expect(mockGetServices).toHaveBeenCalledTimes(1)
    })

    it('should call getServices only once', async () => {
      mockGetServices.mockResolvedValue(['service1', 'service2'])

      await list()

      expect(mockGetServices).toHaveBeenCalledTimes(1)
    })
  })
})