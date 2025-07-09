import { down } from 'src/commands/down'
import { redeploy } from 'src/commands/redeploy'
import { up } from 'src/commands/up'
import { runInteractive } from 'src/utils'

// Mock the command dependencies
jest.mock('../../commands/down')
jest.mock('../../commands/up')
jest.mock('../../utils', () => ({
  ...jest.requireActual('../../utils'),
  runInteractive: jest.fn(),
}))

const mockDown = down as jest.MockedFunction<typeof down>
const mockUp = up as jest.MockedFunction<typeof up>
const mockRunInteractive = runInteractive as jest.MockedFunction<
  typeof runInteractive
>

describe('redeploy command', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Set up default successful mocks
    mockDown.mockResolvedValue(undefined)
    mockUp.mockResolvedValue(undefined)
  })

  describe('successful execution', () => {
    it('should call down then up with same services', async () => {
      const services = ['app1', 'app2']

      await redeploy({ services })

      expect(mockDown).toHaveBeenCalledWith({ all: undefined, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })

    it('should call down with all=true then up when all flag is set', async () => {
      const services = ['app1']

      await redeploy({ all: true, services })

      expect(mockDown).toHaveBeenCalledWith({ all: true, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })

    it('should handle all=false explicitly', async () => {
      const services = ['app1']

      await redeploy({ all: false, services })

      expect(mockDown).toHaveBeenCalledWith({ all: false, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })

    it('should handle empty services array', async () => {
      const services: string[] = []

      await redeploy({ services })

      expect(mockDown).toHaveBeenCalledWith({ all: undefined, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })

    it('should handle single service', async () => {
      const services = ['database']

      await redeploy({ services })

      expect(mockDown).toHaveBeenCalledWith({ all: undefined, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })

    it('should handle multiple services', async () => {
      const services = ['frontend', 'backend', 'database', 'redis']

      await redeploy({ services })

      expect(mockDown).toHaveBeenCalledWith({ all: undefined, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })

    it('should rebuild base images when rebuild-base flag is set', async () => {
      const services = ['app1']

      await redeploy({ services, 'rebuild-base': true })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('build-base-images.sh'),
      )
      expect(mockDown).toHaveBeenCalledWith({ all: undefined, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })

    it('should not rebuild base images when rebuild-base flag is false', async () => {
      const services = ['app1']

      await redeploy({ services, 'rebuild-base': false })

      expect(mockRunInteractive).not.toHaveBeenCalled()
      expect(mockDown).toHaveBeenCalledWith({ all: undefined, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })

    it('should rebuild base images before down command', async () => {
      const callOrder: string[] = []

      mockRunInteractive.mockImplementation(() => {
        callOrder.push('rebuild-base')
      })

      mockDown.mockImplementation(async () => {
        callOrder.push('down')
      })

      mockUp.mockImplementation(async () => {
        callOrder.push('up')
      })

      await redeploy({ services: ['app1'], 'rebuild-base': true })

      expect(callOrder).toEqual(['rebuild-base', 'down', 'up'])
    })
  })

  describe('input validation', () => {
    it('should validate options using RedeployOptionsSchema', async () => {
      const validOptions = { all: true, services: ['app1', 'app2'] }

      await redeploy(validOptions)

      expect(mockDown).toHaveBeenCalledWith({
        all: true,
        services: ['app1', 'app2'],
      })
      expect(mockUp).toHaveBeenCalledWith({ services: ['app1', 'app2'] })
    })

    it('should handle schema validation errors for invalid all flag', async () => {
      const invalidOptions = { all: 'invalid-boolean', services: ['app1'] }

      await expect(redeploy(invalidOptions)).rejects.toThrow()
      expect(mockDown).not.toHaveBeenCalled()
      expect(mockUp).not.toHaveBeenCalled()
    })

    it('should handle schema validation errors for invalid services', async () => {
      const invalidOptions = { services: 'not-an-array' }

      await expect(redeploy(invalidOptions)).rejects.toThrow()
      expect(mockDown).not.toHaveBeenCalled()
      expect(mockUp).not.toHaveBeenCalled()
    })

    it('should handle missing services property', async () => {
      const validOptions = { all: true }

      await redeploy(validOptions)

      expect(mockDown).toHaveBeenCalledWith({ all: true, services: undefined })
      expect(mockUp).toHaveBeenCalledWith({ services: undefined })
    })

    it('should handle null options', async () => {
      await expect(redeploy(null)).rejects.toThrow()
      expect(mockDown).not.toHaveBeenCalled()
      expect(mockUp).not.toHaveBeenCalled()
    })

    it('should handle undefined options', async () => {
      await expect(redeploy(undefined)).rejects.toThrow()
      expect(mockDown).not.toHaveBeenCalled()
      expect(mockUp).not.toHaveBeenCalled()
    })
  })

  describe('command execution order', () => {
    it('should call down before up', async () => {
      const callOrder: string[] = []

      mockDown.mockImplementation(async () => {
        callOrder.push('down')
      })

      mockUp.mockImplementation(async () => {
        callOrder.push('up')
      })

      await redeploy({ services: ['app1'] })

      expect(callOrder).toEqual(['down', 'up'])
    })

    it('should not call up if down fails', async () => {
      mockDown.mockRejectedValue(new Error('Down command failed'))

      await expect(redeploy({ services: ['app1'] })).rejects.toThrow(
        'Down command failed',
      )
      expect(mockDown).toHaveBeenCalled()
      expect(mockUp).not.toHaveBeenCalled()
    })

    // Note: This test identifies a bug in the current implementation
    it('should wait for down to complete before calling up (current implementation bug)', async () => {
      let downCompleted = false

      mockDown.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 100))
        downCompleted = true
      })

      mockUp.mockImplementation(async () => {
        // In the current implementation, this might be called before down completes
        // because the redeploy function is missing await keywords
        expect(downCompleted).toBe(true)
      })

      // This test might fail with the current implementation
      await redeploy({ services: ['app1'] })
    })
  })

  describe('error handling', () => {
    it('should propagate down command errors', async () => {
      mockDown.mockRejectedValue(new Error('Down command failed'))

      await expect(redeploy({ services: ['app1'] })).rejects.toThrow(
        'Down command failed',
      )
    })

    it('should propagate up command errors', async () => {
      mockUp.mockRejectedValue(new Error('Up command failed'))

      await expect(redeploy({ services: ['app1'] })).rejects.toThrow(
        'Up command failed',
      )
    })

    it('should handle down command timeout', async () => {
      mockDown.mockRejectedValue(new Error('Timeout'))

      await expect(redeploy({ services: ['app1'] })).rejects.toThrow('Timeout')
      expect(mockUp).not.toHaveBeenCalled()
    })

    it('should handle up command timeout', async () => {
      mockUp.mockRejectedValue(new Error('Timeout'))

      await expect(redeploy({ services: ['app1'] })).rejects.toThrow('Timeout')
    })

    it('should handle Docker daemon not running', async () => {
      mockDown.mockRejectedValue(new Error('Docker daemon not running'))

      await expect(redeploy({ services: ['app1'] })).rejects.toThrow(
        'Docker daemon not running',
      )
    })

    it('should handle permission errors', async () => {
      mockUp.mockRejectedValue(new Error('Permission denied'))

      await expect(redeploy({ services: ['app1'] })).rejects.toThrow(
        'Permission denied',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle services with special characters', async () => {
      const services = ['app-with-dashes', 'app_with_underscores', 'app123']

      await redeploy({ services })

      expect(mockDown).toHaveBeenCalledWith({ all: undefined, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })

    it('should handle very long service names', async () => {
      const longServiceName = 'a'.repeat(100)
      const services = [longServiceName]

      await redeploy({ services })

      expect(mockDown).toHaveBeenCalledWith({ all: undefined, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })

    it('should handle many services at once', async () => {
      const manyServices = Array.from({ length: 50 }, (_, i) => `service${i}`)

      await redeploy({ services: manyServices })

      expect(mockDown).toHaveBeenCalledWith({
        all: undefined,
        services: manyServices,
      })
      expect(mockUp).toHaveBeenCalledWith({ services: manyServices })
    })

    it('should handle duplicate service names', async () => {
      const services = ['app1', 'app1', 'app2']

      await redeploy({ services })

      expect(mockDown).toHaveBeenCalledWith({ all: undefined, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })

    it('should handle mixed case service names', async () => {
      const services = ['MyApp', 'REDIS', 'postgreSQL']

      await redeploy({ services })

      expect(mockDown).toHaveBeenCalledWith({ all: undefined, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })
  })

  describe('integration scenarios', () => {
    it('should handle realistic service redeploy', async () => {
      const realisticServices = [
        'frontend',
        'backend',
        'database',
        'redis',
        'nginx-proxy',
      ]

      await redeploy({ services: realisticServices })

      expect(mockDown).toHaveBeenCalledWith({
        all: undefined,
        services: realisticServices,
      })
      expect(mockUp).toHaveBeenCalledWith({ services: realisticServices })
    })

    it('should handle critical service redeploy with all images', async () => {
      const criticalServices = ['database', 'redis']

      await redeploy({ all: true, services: criticalServices })

      expect(mockDown).toHaveBeenCalledWith({
        all: true,
        services: criticalServices,
      })
      expect(mockUp).toHaveBeenCalledWith({ services: criticalServices })
    })

    it('should handle single service redeploy', async () => {
      const services = ['frontend']

      await redeploy({ services })

      expect(mockDown).toHaveBeenCalledWith({ all: undefined, services })
      expect(mockUp).toHaveBeenCalledWith({ services })
    })

    it('should handle development environment redeploy', async () => {
      const devServices = ['dev-frontend', 'dev-backend', 'dev-database']

      await redeploy({ all: true, services: devServices })

      expect(mockDown).toHaveBeenCalledWith({
        all: true,
        services: devServices,
      })
      expect(mockUp).toHaveBeenCalledWith({ services: devServices })
    })
  })

  describe('data flow', () => {
    it('should pass all flag to down but not to up', async () => {
      await redeploy({ all: true, services: ['app1'] })

      expect(mockDown).toHaveBeenCalledWith({ all: true, services: ['app1'] })
      expect(mockUp).toHaveBeenCalledWith({ services: ['app1'] })

      // Verify up was not called with all flag
      expect(mockUp).not.toHaveBeenCalledWith({ all: true, services: ['app1'] })
    })

    it('should pass services to both down and up', async () => {
      const services = ['app1', 'app2']

      await redeploy({ services })

      expect(mockDown).toHaveBeenCalledWith(
        expect.objectContaining({ services }),
      )
      expect(mockUp).toHaveBeenCalledWith(expect.objectContaining({ services }))
    })

    it('should handle undefined services correctly', async () => {
      await redeploy({})

      expect(mockDown).toHaveBeenCalledWith({
        all: undefined,
        services: undefined,
      })
      expect(mockUp).toHaveBeenCalledWith({ services: undefined })
    })
  })

  describe('call verification', () => {
    it('should call both commands exactly once', async () => {
      await redeploy({ services: ['app1'] })

      expect(mockDown).toHaveBeenCalledTimes(1)
      expect(mockUp).toHaveBeenCalledTimes(1)
    })

    it('should not make additional calls on success', async () => {
      await redeploy({ services: ['app1'] })

      expect(mockDown).toHaveBeenCalledTimes(1)
      expect(mockUp).toHaveBeenCalledTimes(1)
    })

    it('should not call up multiple times even if down succeeds multiple times', async () => {
      await redeploy({ services: ['app1'] })

      // Reset and redeploy again
      jest.clearAllMocks()
      await redeploy({ services: ['app2'] })

      expect(mockDown).toHaveBeenCalledTimes(1)
      expect(mockUp).toHaveBeenCalledTimes(1)
    })
  })
})
