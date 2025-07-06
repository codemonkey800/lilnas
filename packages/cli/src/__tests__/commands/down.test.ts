import { down } from '../../commands/down'
import { runInteractive } from '../../utils'

// Mock dependencies
jest.mock('../../utils', () => ({
  runInteractive: jest.fn(),
  ServicesOptionSchema: require('zod').z.object({
    services: require('zod').z.array(require('zod').z.string()),
  })
}))

const mockRunInteractive = runInteractive as jest.MockedFunction<typeof runInteractive>

describe('down command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetAllMocks()
  })

  describe('successful execution', () => {
    it('should run docker-compose down with local images by default', async () => {
      await down({ services: ['app1'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v app1')
    })

    it('should run docker-compose down with all images when all=true', async () => {
      await down({ all: true, services: ['app1'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi all -v app1')
    })

    it('should run docker-compose down with multiple services', async () => {
      await down({ services: ['app1', 'app2', 'app3'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v app1 app2 app3')
    })

    it('should run docker-compose down with empty services array', async () => {
      await down({ services: [] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v ')
    })

    it('should handle all=false explicitly', async () => {
      await down({ all: false, services: ['app1'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v app1')
    })

    it('should handle services with special characters', async () => {
      await down({ services: ['app-with-dashes', 'app_with_underscores', 'app123'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v app-with-dashes app_with_underscores app123')
    })
  })

  describe('all flag behavior', () => {
    it('should use "all" image type when all=true', async () => {
      await down({ all: true, services: ['app1', 'app2'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi all -v app1 app2')
    })

    it('should use "local" image type when all=false', async () => {
      await down({ all: false, services: ['app1', 'app2'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v app1 app2')
    })

    it('should use "local" image type when all is undefined', async () => {
      await down({ services: ['app1', 'app2'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v app1 app2')
    })

    it('should handle all as string "true"', async () => {
      await down({ all: 'true' as any, services: ['app1'] })

      // Should be parsed as truthy by zod boolean schema
      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi all -v app1')
    })
  })

  describe('input validation', () => {
    it('should validate options using DownOptionsSchema', async () => {
      const validOptions = { all: true, services: ['app1', 'app2'] }

      await down(validOptions)

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi all -v app1 app2')
    })

    it('should handle schema validation errors for invalid all flag', async () => {
      const invalidOptions = { all: 'invalid-boolean', services: ['app1'] }

      await expect(down(invalidOptions)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should handle schema validation errors for invalid services', async () => {
      const invalidOptions = { services: 'not-an-array' }

      await expect(down(invalidOptions)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should handle missing services property', async () => {
      const invalidOptions = { all: true }

      await expect(down(invalidOptions)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should handle null options', async () => {
      await expect(down(null)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should handle undefined options', async () => {
      await expect(down(undefined)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })
  })

  describe('docker-compose execution', () => {
    it('should pass through docker-compose execution errors', async () => {
      mockRunInteractive.mockImplementation(() => {
        throw new Error('Docker daemon not running')
      })

      await expect(down({ services: ['app1'] })).rejects.toThrow('Docker daemon not running')
      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v app1')
    })

    it('should handle docker-compose command failures', async () => {
      mockRunInteractive.mockImplementation(() => {
        throw new Error('No such service: nonexistent-service')
      })

      await expect(down({ services: ['nonexistent-service'] })).rejects.toThrow('No such service: nonexistent-service')
    })

    it('should handle network errors', async () => {
      mockRunInteractive.mockImplementation(() => {
        throw new Error('Network timeout')
      })

      await expect(down({ services: ['app1'] })).rejects.toThrow('Network timeout')
    })

    it('should handle insufficient permissions', async () => {
      mockRunInteractive.mockImplementation(() => {
        throw new Error('Permission denied')
      })

      await expect(down({ services: ['app1'] })).rejects.toThrow('Permission denied')
    })

    it('should handle docker-compose file not found', async () => {
      mockRunInteractive.mockImplementation(() => {
        throw new Error('docker-compose.yml not found')
      })

      await expect(down({ services: ['app1'] })).rejects.toThrow('docker-compose.yml not found')
    })
  })

  describe('edge cases', () => {
    it('should handle very long service names', async () => {
      const longServiceName = 'a'.repeat(100)

      await down({ services: [longServiceName] })

      expect(mockRunInteractive).toHaveBeenCalledWith(`docker-compose down --rmi local -v ${longServiceName}`)
    })

    it('should handle many services at once', async () => {
      const manyServices = Array.from({ length: 50 }, (_, i) => `service${i}`)

      await down({ services: manyServices })

      expect(mockRunInteractive).toHaveBeenCalledWith(`docker-compose down --rmi local -v ${manyServices.join(' ')}`)
    })

    it('should handle duplicate service names', async () => {
      await down({ services: ['app1', 'app1', 'app2'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v app1 app1 app2')
    })

    it('should handle services with numeric names', async () => {
      await down({ services: ['123', '456'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v 123 456')
    })

    it('should handle mixed case service names', async () => {
      await down({ services: ['MyApp', 'REDIS', 'postgreSQL'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v MyApp REDIS postgreSQL')
    })

    it('should handle services with spaces (edge case)', async () => {
      await down({ services: ['app with spaces'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v app with spaces')
    })
  })

  describe('integration scenarios', () => {
    it('should handle realistic service shutdown', async () => {
      const realisticServices = [
        'frontend',
        'backend', 
        'database',
        'redis',
        'nginx-proxy'
      ]

      await down({ services: realisticServices })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v frontend backend database redis nginx-proxy')
    })

    it('should handle emergency shutdown with all images', async () => {
      const criticalServices = ['database', 'redis', 'message-queue']

      await down({ all: true, services: criticalServices })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi all -v database redis message-queue')
    })

    it('should handle single service shutdown', async () => {
      await down({ services: ['database'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v database')
    })

    it('should handle service names with version suffixes', async () => {
      await down({ services: ['postgres-14', 'redis-7', 'nginx-1.21'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v postgres-14 redis-7 nginx-1.21')
    })

    it('should handle development environment teardown', async () => {
      await down({ all: true, services: ['dev-frontend', 'dev-backend', 'dev-database'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi all -v dev-frontend dev-backend dev-database')
    })
  })

  describe('command construction', () => {
    it('should always include -v flag for volumes', async () => {
      await down({ services: ['app1'] })

      expect(mockRunInteractive).toHaveBeenCalledWith(expect.stringContaining('-v'))
    })

    it('should always include --rmi flag with appropriate value', async () => {
      await down({ services: ['app1'] })

      expect(mockRunInteractive).toHaveBeenCalledWith(expect.stringContaining('--rmi local'))
    })

    it('should construct command in correct order', async () => {
      await down({ all: true, services: ['app1', 'app2'] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi all -v app1 app2')
    })

    it('should handle empty services gracefully', async () => {
      await down({ services: [] })

      expect(mockRunInteractive).toHaveBeenCalledWith('docker-compose down --rmi local -v ')
    })
  })
})