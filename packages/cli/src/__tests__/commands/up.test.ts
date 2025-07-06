import { up } from 'src/commands/up'
import { runInteractive, ServicesOptionSchema } from 'src/utils'

// Mock dependencies
jest.mock('../../utils', () => ({
  runInteractive: jest.fn(),
  ServicesOptionSchema: {
    parse: jest.fn(),
  },
}))

const mockRunInteractive = runInteractive as jest.MockedFunction<
  typeof runInteractive
>
const mockServicesOptionSchema = ServicesOptionSchema as jest.Mocked<
  typeof ServicesOptionSchema
>

describe('up command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetAllMocks()
  })

  describe('successful execution', () => {
    it('should run docker-compose up with single service', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['app1'],
      })

      await up({ services: ['app1'] })

      expect(mockServicesOptionSchema.parse).toHaveBeenCalledWith({
        services: ['app1'],
      })
      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose up -d app1',
      )
    })

    it('should run docker-compose up with multiple services', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['app1', 'app2', 'app3'],
      })

      await up({ services: ['app1', 'app2', 'app3'] })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose up -d app1 app2 app3',
      )
    })

    it('should run docker-compose up with empty services array', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: [],
      })

      await up({ services: [] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose up -d ')
    })

    it('should handle services with special characters', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['app-with-dashes', 'app_with_underscores', 'app123'],
      })

      await up({
        services: ['app-with-dashes', 'app_with_underscores', 'app123'],
      })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose up -d app-with-dashes app_with_underscores app123',
      )
    })

    it('should handle services with spaces (edge case)', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['app with spaces'],
      })

      await up({ services: ['app with spaces'] })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose up -d app with spaces',
      )
    })
  })

  describe('input validation', () => {
    it('should validate options using ServicesOptionSchema', async () => {
      const inputOptions = { services: ['app1', 'app2'] }
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['app1', 'app2'],
      })

      await up(inputOptions)

      expect(mockServicesOptionSchema.parse).toHaveBeenCalledWith(inputOptions)
    })

    it('should handle schema validation errors', async () => {
      mockServicesOptionSchema.parse.mockImplementation(() => {
        throw new Error('Invalid services format')
      })

      await expect(up({ services: 'invalid' })).rejects.toThrow(
        'Invalid services format',
      )
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should handle missing services property', async () => {
      mockServicesOptionSchema.parse.mockImplementation(() => {
        throw new Error('services is required')
      })

      await expect(up({})).rejects.toThrow('services is required')
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should handle null options', async () => {
      mockServicesOptionSchema.parse.mockImplementation(() => {
        throw new Error('Expected object, received null')
      })

      await expect(up(null)).rejects.toThrow('Expected object, received null')
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should handle undefined options', async () => {
      mockServicesOptionSchema.parse.mockImplementation(() => {
        throw new Error('Expected object, received undefined')
      })

      await expect(up(undefined)).rejects.toThrow(
        'Expected object, received undefined',
      )
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })
  })

  describe('docker-compose execution', () => {
    it('should pass through docker-compose execution errors', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['app1'],
      })
      mockRunInteractive.mockImplementation(() => {
        throw new Error('Docker daemon not running')
      })

      await expect(up({ services: ['app1'] })).rejects.toThrow(
        'Docker daemon not running',
      )
      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose up -d app1',
      )
    })

    it('should handle docker-compose command failures', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['nonexistent-service'],
      })
      mockRunInteractive.mockImplementation(() => {
        throw new Error('No such service: nonexistent-service')
      })

      await expect(up({ services: ['nonexistent-service'] })).rejects.toThrow(
        'No such service: nonexistent-service',
      )
    })

    it('should handle network errors', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['app1'],
      })
      mockRunInteractive.mockImplementation(() => {
        throw new Error('Network timeout')
      })

      await expect(up({ services: ['app1'] })).rejects.toThrow(
        'Network timeout',
      )
    })

    it('should handle insufficient permissions', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['app1'],
      })
      mockRunInteractive.mockImplementation(() => {
        throw new Error('Permission denied')
      })

      await expect(up({ services: ['app1'] })).rejects.toThrow(
        'Permission denied',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle very long service names', async () => {
      const longServiceName = 'a'.repeat(100)
      mockServicesOptionSchema.parse.mockReturnValue({
        services: [longServiceName],
      })

      await up({ services: [longServiceName] })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        `docker-compose up -d ${longServiceName}`,
      )
    })

    it('should handle many services at once', async () => {
      const manyServices = Array.from({ length: 50 }, (_, i) => `service${i}`)
      mockServicesOptionSchema.parse.mockReturnValue({
        services: manyServices,
      })

      await up({ services: manyServices })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        `docker-compose up -d ${manyServices.join(' ')}`,
      )
    })

    it('should handle duplicate service names', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['app1', 'app1', 'app2'],
      })

      await up({ services: ['app1', 'app1', 'app2'] })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose up -d app1 app1 app2',
      )
    })

    it('should handle services with numeric names', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['123', '456'],
      })

      await up({ services: ['123', '456'] })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose up -d 123 456',
      )
    })

    it('should handle mixed case service names', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['MyApp', 'REDIS', 'postgreSQL'],
      })

      await up({ services: ['MyApp', 'REDIS', 'postgreSQL'] })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose up -d MyApp REDIS postgreSQL',
      )
    })
  })

  describe('integration scenarios', () => {
    it('should handle realistic service configuration', async () => {
      const realisticServices = [
        'frontend',
        'backend',
        'database',
        'redis',
        'nginx-proxy',
      ]
      mockServicesOptionSchema.parse.mockReturnValue({
        services: realisticServices,
      })

      await up({ services: realisticServices })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose up -d frontend backend database redis nginx-proxy',
      )
    })

    it('should handle single critical service', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['database'],
      })

      await up({ services: ['database'] })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose up -d database',
      )
    })

    it('should handle service names with version suffixes', async () => {
      mockServicesOptionSchema.parse.mockReturnValue({
        services: ['postgres-14', 'redis-7', 'nginx-1.21'],
      })

      await up({ services: ['postgres-14', 'redis-7', 'nginx-1.21'] })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose up -d postgres-14 redis-7 nginx-1.21',
      )
    })
  })
})
