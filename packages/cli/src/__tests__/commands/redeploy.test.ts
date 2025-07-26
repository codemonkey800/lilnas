import * as path from 'path'

import { redeploy } from 'src/commands/redeploy'
import { runInteractive } from 'src/utils'

// Mock dependencies
jest.mock('../../utils')
jest.mock('path')

const mockRunInteractive = runInteractive as jest.MockedFunction<
  typeof runInteractive
>
const mockPathJoin = path.join as jest.MockedFunction<typeof path.join>
const mockConsoleLog = jest.spyOn(console, 'log').mockImplementation()

describe('redeploy command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockRunInteractive.mockReset()
    mockPathJoin.mockReset()
    mockConsoleLog.mockReset()

    // Default mock for path.join to return a predictable script path
    mockPathJoin.mockReturnValue('/mock/path/to/build-base-images.sh')
  })

  describe('successful execution', () => {
    it('should run default redeploy with no options', async () => {
      const options = {}

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        'docker-compose -f docker-compose.yml down --rmi local -v ',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        2,
        'docker-compose -f docker-compose.yml up -d ',
      )
      expect(mockConsoleLog).not.toHaveBeenCalled()
    })

    it('should run redeploy with single service', async () => {
      const options = { services: ['tdr-bot'] }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        'docker-compose -f docker-compose.yml down --rmi local -v tdr-bot',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        2,
        'docker-compose -f docker-compose.yml up -d tdr-bot',
      )
    })

    it('should run redeploy with multiple services', async () => {
      const options = { services: ['tdr-bot', 'download', 'equations'] }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        'docker-compose -f docker-compose.yml down --rmi local -v tdr-bot download equations',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        2,
        'docker-compose -f docker-compose.yml up -d tdr-bot download equations',
      )
    })

    it('should use --rmi all when all flag is true', async () => {
      const options = { all: true }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        'docker-compose -f docker-compose.yml down --rmi all -v ',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        2,
        'docker-compose -f docker-compose.yml up -d ',
      )
    })

    it('should rebuild base images when rebuild-base flag is true', async () => {
      const options = { 'rebuild-base': true }

      await redeploy(options)

      expect(mockConsoleLog).toHaveBeenCalledWith('Rebuilding base images...')
      expect(mockRunInteractive).toHaveBeenCalledTimes(3)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        '/mock/path/to/build-base-images.sh',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        2,
        'docker-compose -f docker-compose.yml down --rmi local -v ',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        3,
        'docker-compose -f docker-compose.yml up -d ',
      )
    })

    it('should handle all flags combined', async () => {
      const options = {
        all: true,
        'rebuild-base': true,
        services: ['tdr-bot', 'download'],
      }

      await redeploy(options)

      expect(mockConsoleLog).toHaveBeenCalledWith('Rebuilding base images...')
      expect(mockRunInteractive).toHaveBeenCalledTimes(3)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        '/mock/path/to/build-base-images.sh',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        2,
        'docker-compose -f docker-compose.yml down --rmi all -v tdr-bot download',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        3,
        'docker-compose -f docker-compose.yml up -d tdr-bot download',
      )
    })

    it('should handle all flag set to false explicitly', async () => {
      const options = { all: false, services: ['tdr-bot'] }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        'docker-compose -f docker-compose.yml down --rmi local -v tdr-bot',
      )
    })

    it('should handle rebuild-base flag set to false explicitly', async () => {
      const options = { 'rebuild-base': false, services: ['tdr-bot'] }

      await redeploy(options)

      expect(mockConsoleLog).not.toHaveBeenCalled()
      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        'docker-compose -f docker-compose.yml down --rmi local -v tdr-bot',
      )
    })

    it('should execute commands in correct order when rebuilding base images', async () => {
      const options = { 'rebuild-base': true, services: ['tdr-bot'] }
      const callOrder: string[] = []

      mockRunInteractive.mockImplementation((command: string) => {
        callOrder.push(command)
      })

      await redeploy(options)

      expect(callOrder).toEqual([
        '/mock/path/to/build-base-images.sh',
        'docker-compose -f docker-compose.yml down --rmi local -v tdr-bot',
        'docker-compose -f docker-compose.yml up -d tdr-bot',
      ])
    })

    it('should handle empty services array', async () => {
      const options = { services: [] }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        'docker-compose -f docker-compose.yml down --rmi local -v ',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        2,
        'docker-compose -f docker-compose.yml up -d ',
      )
    })
  })

  describe('input validation', () => {
    it('should accept valid options with all flags', async () => {
      const options = {
        all: true,
        services: ['service1', 'service2'],
        'rebuild-base': true,
      }

      await expect(redeploy(options)).resolves.not.toThrow()
    })

    it('should accept options with only all flag', async () => {
      const options = { all: true }

      await expect(redeploy(options)).resolves.not.toThrow()
    })

    it('should accept options with only services', async () => {
      const options = { services: ['service1'] }

      await expect(redeploy(options)).resolves.not.toThrow()
    })

    it('should accept options with only rebuild-base flag', async () => {
      const options = { 'rebuild-base': true }

      await expect(redeploy(options)).resolves.not.toThrow()
    })

    it('should accept empty options object', async () => {
      const options = {}

      await expect(redeploy(options)).resolves.not.toThrow()
    })

    it('should reject all flag as string', async () => {
      const options = { all: 'true' }

      await expect(redeploy(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should reject all flag as number', async () => {
      const options = { all: 1 }

      await expect(redeploy(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should reject rebuild-base flag as string', async () => {
      const options = { 'rebuild-base': 'true' }

      await expect(redeploy(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should reject services as string', async () => {
      const options = { services: 'tdr-bot' }

      await expect(redeploy(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should reject services array with non-string elements', async () => {
      const options = { services: ['tdr-bot', 123, 'download'] }

      await expect(redeploy(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should reject services as number', async () => {
      const options = { services: 123 }

      await expect(redeploy(options)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should reject null options', async () => {
      await expect(redeploy(null)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should reject undefined options', async () => {
      await expect(redeploy(undefined)).rejects.toThrow()
      expect(mockRunInteractive).not.toHaveBeenCalled()
    })

    it('should ignore additional unknown properties', async () => {
      const options = {
        all: true,
        services: ['tdr-bot'],
        unknownProp: 'should-be-ignored',
        anotherProp: 123,
      }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        'docker-compose -f docker-compose.yml down --rmi all -v tdr-bot',
      )
    })

    it('should handle services array with mixed valid strings', async () => {
      const options = {
        services: [
          'service-with-dashes',
          'service_with_underscores',
          'service.with.dots',
        ],
      }

      await expect(redeploy(options)).resolves.not.toThrow()
    })
  })

  describe('script path construction', () => {
    it('should construct correct path to build-base-images.sh script', async () => {
      const options = { 'rebuild-base': true }

      await redeploy(options)

      expect(mockPathJoin).toHaveBeenCalledWith(
        expect.any(String), // __dirname
        '..',
        '..',
        '..',
        '..',
        'infra',
        'base-images',
        'build-base-images.sh',
      )
    })

    it('should use path.join result in runInteractive call', async () => {
      const mockScriptPath = '/custom/path/to/build-base-images.sh'
      mockPathJoin.mockReturnValue(mockScriptPath)
      const options = { 'rebuild-base': true }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenNthCalledWith(1, mockScriptPath)
    })

    it('should construct path starting from __dirname', async () => {
      const options = { 'rebuild-base': true }

      await redeploy(options)

      const pathJoinCall = mockPathJoin.mock.calls[0]
      expect(pathJoinCall[0]).toContain('src') // Should contain __dirname path
      expect(pathJoinCall[1]).toBe('..')
      expect(pathJoinCall[2]).toBe('..')
    })

    it('should navigate correct number of directories up from src/commands', async () => {
      const options = { 'rebuild-base': true }

      await redeploy(options)

      const pathJoinCall = mockPathJoin.mock.calls[0]
      // Should be: __dirname, '..', '..', '..', '..', 'infra', 'base-images', 'build-base-images.sh'
      expect(pathJoinCall).toHaveLength(8)
      expect(pathJoinCall[4]).toBe('..') // Fourth '..' to get to repo root
      expect(pathJoinCall[5]).toBe('infra')
      expect(pathJoinCall[6]).toBe('base-images')
      expect(pathJoinCall[7]).toBe('build-base-images.sh')
    })
  })

  describe('docker command structure', () => {
    it('should use correct docker-compose file specification', async () => {
      await redeploy({})

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('-f docker-compose.yml'),
      )
    })

    it('should include down command with correct flags', async () => {
      await redeploy({})

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('down --rmi local -v'),
      )
    })

    it('should include up command with detached flag', async () => {
      await redeploy({})

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('up -d'),
      )
    })

    it('should use --rmi all when all flag is true', async () => {
      await redeploy({ all: true })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('down --rmi all -v'),
      )
    })

    it('should use --rmi local when all flag is false', async () => {
      await redeploy({ all: false })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('down --rmi local -v'),
      )
    })

    it('should include service names in down command', async () => {
      await redeploy({ services: ['service1', 'service2'] })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('down --rmi local -v service1 service2'),
      )
    })

    it('should include service names in up command', async () => {
      await redeploy({ services: ['service1', 'service2'] })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('up -d service1 service2'),
      )
    })

    it('should maintain consistent command structure across variations', async () => {
      await redeploy({ all: true, services: ['test'] })

      const downCall = mockRunInteractive.mock.calls[0][0]
      const upCall = mockRunInteractive.mock.calls[1][0]

      expect(downCall).toMatch(
        /^docker-compose -f docker-compose\.yml down --rmi all -v test$/,
      )
      expect(upCall).toMatch(
        /^docker-compose -f docker-compose\.yml up -d test$/,
      )
    })
  })

  describe('error scenarios', () => {
    it('should propagate rebuild script execution errors', async () => {
      mockRunInteractive.mockImplementationOnce(() => {
        throw new Error('build-base-images.sh: No such file or directory')
      })

      await expect(redeploy({ 'rebuild-base': true })).rejects.toThrow(
        'build-base-images.sh: No such file or directory',
      )

      expect(mockRunInteractive).toHaveBeenCalledTimes(1)
    })

    it('should propagate docker down command errors', async () => {
      mockRunInteractive
        .mockImplementationOnce(() => {}) // rebuild script succeeds
        .mockImplementationOnce(() => {
          throw new Error('Docker daemon is not running')
        })

      await expect(redeploy({ 'rebuild-base': true })).rejects.toThrow(
        'Docker daemon is not running',
      )

      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
    })

    it('should propagate docker up command errors', async () => {
      mockRunInteractive
        .mockImplementationOnce(() => {}) // down succeeds
        .mockImplementationOnce(() => {
          throw new Error('Service tdr-bot not found')
        })

      await expect(redeploy({ services: ['tdr-bot'] })).rejects.toThrow(
        'Service tdr-bot not found',
      )

      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
    })

    it('should handle permission denied errors', async () => {
      mockRunInteractive.mockImplementationOnce(() => {
        throw new Error('Permission denied')
      })

      await expect(redeploy({})).rejects.toThrow('Permission denied')
    })

    it('should handle docker image not found errors', async () => {
      mockRunInteractive
        .mockImplementationOnce(() => {}) // down succeeds
        .mockImplementationOnce(() => {
          throw new Error('Error response from daemon: pull access denied')
        })

      await expect(redeploy({})).rejects.toThrow('pull access denied')
    })

    it('should handle network connectivity errors', async () => {
      mockRunInteractive.mockImplementationOnce(() => {
        throw new Error('Network timeout: could not connect to docker daemon')
      })

      await expect(redeploy({})).rejects.toThrow('Network timeout')
    })

    it('should handle docker-compose file not found', async () => {
      mockRunInteractive.mockImplementationOnce(() => {
        throw new Error('docker-compose.yml not found')
      })

      await expect(redeploy({})).rejects.toThrow('docker-compose.yml not found')
    })

    it('should not execute subsequent commands if earlier command fails', async () => {
      mockRunInteractive.mockImplementationOnce(() => {
        throw new Error('First command failed')
      })

      await expect(redeploy({})).rejects.toThrow('First command failed')
      expect(mockRunInteractive).toHaveBeenCalledTimes(1)
    })

    it('should handle script execution timeout', async () => {
      mockRunInteractive.mockImplementationOnce(() => {
        throw new Error('Command timeout after 30 seconds')
      })

      await expect(redeploy({ 'rebuild-base': true })).rejects.toThrow(
        'Command timeout',
      )
    })
  })

  describe('edge cases', () => {
    it('should handle service names with special characters', async () => {
      const options = {
        services: [
          'service-with-dashes',
          'service_with_underscores',
          'service.with.dots',
        ],
      }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining(
          'service-with-dashes service_with_underscores service.with.dots',
        ),
      )
    })

    it('should handle service names with unicode characters', async () => {
      const options = {
        services: ['сервис', '服务', 'servicio'],
      }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('сервис 服务 servicio'),
      )
    })

    it('should handle large service lists', async () => {
      const manyServices = Array.from({ length: 20 }, (_, i) => `service-${i}`)
      const options = { services: manyServices }

      await redeploy(options)

      const expectedServiceString = manyServices.join(' ')
      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining(expectedServiceString),
      )
    })

    it('should handle duplicate service names', async () => {
      const options = {
        services: ['tdr-bot', 'tdr-bot', 'download', 'tdr-bot'],
      }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('tdr-bot tdr-bot download tdr-bot'),
      )
    })

    it('should handle very long service names', async () => {
      const longServiceName =
        'very-long-service-name-that-exceeds-normal-length-expectations-and-might-cause-issues'
      const options = { services: [longServiceName] }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining(longServiceName),
      )
    })

    it('should handle service names with numbers and special patterns', async () => {
      const options = {
        services: [
          'service123',
          '123service',
          'service-v1.2.3',
          'my_service_2024',
        ],
      }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining(
          'service123 123service service-v1.2.3 my_service_2024',
        ),
      )
    })

    it('should handle mixed case in service names', async () => {
      const options = {
        services: ['ServiceName', 'UPPERCASE-SERVICE', 'lowercase-service'],
      }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining(
          'ServiceName UPPERCASE-SERVICE lowercase-service',
        ),
      )
    })
  })

  describe('integration scenarios', () => {
    it('should handle typical development workflow redeploy', async () => {
      const options = { services: ['tdr-bot'] }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        'docker-compose -f docker-compose.yml down --rmi local -v tdr-bot',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        2,
        'docker-compose -f docker-compose.yml up -d tdr-bot',
      )
      expect(mockConsoleLog).not.toHaveBeenCalled()
    })

    it('should handle production deployment with multiple services', async () => {
      const options = {
        all: true,
        services: ['tdr-bot', 'download', 'equations'],
      }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        'docker-compose -f docker-compose.yml down --rmi all -v tdr-bot download equations',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        2,
        'docker-compose -f docker-compose.yml up -d tdr-bot download equations',
      )
    })

    it('should handle fresh deployment with base rebuild', async () => {
      const options = { 'rebuild-base': true, all: true }

      await redeploy(options)

      expect(mockConsoleLog).toHaveBeenCalledWith('Rebuilding base images...')
      expect(mockRunInteractive).toHaveBeenCalledTimes(3)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        '/mock/path/to/build-base-images.sh',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        2,
        'docker-compose -f docker-compose.yml down --rmi all -v ',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        3,
        'docker-compose -f docker-compose.yml up -d ',
      )
    })

    it('should handle full system redeploy', async () => {
      const options = {
        'rebuild-base': true,
        all: true,
        services: ['tdr-bot', 'download', 'equations', 'apps'],
      }

      await redeploy(options)

      expect(mockConsoleLog).toHaveBeenCalledWith('Rebuilding base images...')
      expect(mockRunInteractive).toHaveBeenCalledTimes(3)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        2,
        'docker-compose -f docker-compose.yml down --rmi all -v tdr-bot download equations apps',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        3,
        'docker-compose -f docker-compose.yml up -d tdr-bot download equations apps',
      )
    })

    it('should handle partial service update without flags', async () => {
      const options = { services: ['download', 'equations'] }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledTimes(2)
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        1,
        'docker-compose -f docker-compose.yml down --rmi local -v download equations',
      )
      expect(mockRunInteractive).toHaveBeenNthCalledWith(
        2,
        'docker-compose -f docker-compose.yml up -d download equations',
      )
      expect(mockConsoleLog).not.toHaveBeenCalled()
    })

    it('should handle infrastructure service redeploy', async () => {
      const options = {
        all: true,
        services: ['traefik', 'minio', 'forward-auth'],
      }

      await redeploy(options)

      expect(mockRunInteractive).toHaveBeenCalledWith(
        expect.stringContaining('traefik minio forward-auth'),
      )
    })
  })

  describe('console output', () => {
    it('should log rebuild message when rebuild-base is true', async () => {
      await redeploy({ 'rebuild-base': true })

      expect(mockConsoleLog).toHaveBeenCalledWith('Rebuilding base images...')
      expect(mockConsoleLog).toHaveBeenCalledTimes(1)
    })

    it('should not log rebuild message when rebuild-base is false', async () => {
      await redeploy({ 'rebuild-base': false })

      expect(mockConsoleLog).not.toHaveBeenCalled()
    })

    it('should not log rebuild message when rebuild-base is undefined', async () => {
      await redeploy({})

      expect(mockConsoleLog).not.toHaveBeenCalled()
    })

    it('should log rebuild message before script execution', async () => {
      const callOrder: string[] = []

      mockConsoleLog.mockImplementation(() => {
        callOrder.push('console.log')
      })

      mockRunInteractive.mockImplementation(() => {
        callOrder.push('runInteractive')
      })

      await redeploy({ 'rebuild-base': true })

      expect(callOrder[0]).toBe('console.log')
      expect(callOrder[1]).toBe('runInteractive')
    })
  })
})
