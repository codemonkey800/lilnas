import { execSync } from 'child_process'
import * as yaml from 'yaml'
import { $ } from 'zx'

import {
  getDockerImages,
  getRepoDir,
  getServices,
  runDockerCompose,
  runInteractive,
  ServicesOptionSchema,
} from 'src/utils'

// Mock dependencies
jest.mock('child_process')
jest.mock('zx', () => ({
  $: jest.fn(),
}))
jest.mock('yaml')

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>
const mockZx = $ as jest.MockedFunction<any>
const mockYamlParse = yaml.parse as jest.MockedFunction<typeof yaml.parse>

describe('utils', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.resetAllMocks()
  })

  describe('getRepoDir', () => {
    it('should return the repository root directory', async () => {
      const expectedDir = '/home/user/lilnas'
      mockZx.mockResolvedValue({
        stdout: `${expectedDir}\n`,
        stderr: '',
        exitCode: 0,
      } as any)

      const result = await getRepoDir()

      expect(result).toBe(expectedDir)
      expect(mockZx).toHaveBeenCalled()
    })

    it('should handle git command failures', async () => {
      mockZx.mockRejectedValue(new Error('Not a git repository'))

      await expect(getRepoDir()).rejects.toThrow('Not a git repository')
    })

    it('should trim whitespace from git output', async () => {
      mockZx.mockResolvedValue({
        stdout: '  /home/user/lilnas  \n\n',
        stderr: '',
        exitCode: 0,
      } as any)

      const result = await getRepoDir()

      expect(result).toBe('/home/user/lilnas')
    })
  })

  describe('getServices', () => {
    beforeEach(() => {
      // Mock getRepoDir
      mockZx.mockImplementation((cmd: any) => {
        const cmdStr = Array.isArray(cmd)
          ? cmd.join(' ')
          : cmd?.toString() || ''
        if (cmdStr.includes('git rev-parse')) {
          return Promise.resolve({
            stdout: '/home/user/lilnas\n',
            stderr: '',
            exitCode: 0,
          } as any)
        }
        if (cmdStr.includes('fd .yml')) {
          return Promise.resolve({
            stdout:
              '/home/user/lilnas/infra/apps.yml\n/home/user/lilnas/infra/proxy.yml\n',
            stderr: '',
            exitCode: 0,
          } as any)
        }
        if (cmdStr.includes('cat')) {
          return Promise.resolve({
            stdout:
              'services:\n  app1:\n    image: nginx\n  app2:\n    image: redis\n',
            stderr: '',
            exitCode: 0,
          } as any)
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any)
      })

      mockYamlParse.mockReturnValue({
        services: {
          app1: { image: 'nginx' },
          app2: { image: 'redis' },
        },
      })
    })

    it('should return production services by default', async () => {
      const services = await getServices()

      expect(services).toEqual(['app1', 'app2'])
      expect(mockZx).toHaveBeenCalled()
    })

    it('should return dev services when dev=true', async () => {
      // Mock dev service files
      mockZx.mockImplementation((cmd: any) => {
        const cmdStr = Array.isArray(cmd)
          ? cmd.join(' ')
          : cmd?.toString() || ''
        if (cmdStr.includes('git rev-parse')) {
          return Promise.resolve({
            stdout: '/home/user/lilnas\n',
            stderr: '',
            exitCode: 0,
          } as any)
        }
        if (cmdStr.includes('fd .yml')) {
          return Promise.resolve({
            stdout:
              '/home/user/lilnas/infra/apps.dev.yml\n/home/user/lilnas/infra/proxy.dev.yml\n',
            stderr: '',
            exitCode: 0,
          } as any)
        }
        if (cmdStr.includes('cat')) {
          return Promise.resolve({
            stdout:
              'services:\n  dev-app1:\n    image: nginx\n  dev-app2:\n    image: redis\n',
            stderr: '',
            exitCode: 0,
          } as any)
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any)
      })

      mockYamlParse.mockReturnValue({
        services: {
          'dev-app1': { image: 'nginx' },
          'dev-app2': { image: 'redis' },
        },
      })

      const services = await getServices({ dev: true })

      expect(services).toEqual(['dev-app1', 'dev-app2'])
    })

    it('should handle empty service files', async () => {
      mockZx.mockImplementation((cmd: any) => {
        const cmdStr = Array.isArray(cmd)
          ? cmd.join(' ')
          : cmd?.toString() || ''
        if (cmdStr.includes('git rev-parse')) {
          return Promise.resolve({
            stdout: '/home/user/lilnas\n',
            stderr: '',
            exitCode: 0,
          } as any)
        }
        if (cmdStr.includes('fd .yml')) {
          return Promise.resolve({
            stdout: '',
            stderr: '',
            exitCode: 0,
          } as any)
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any)
      })

      const services = await getServices()

      expect(services).toEqual([])
    })

    it('should handle YAML parsing errors', async () => {
      mockYamlParse.mockImplementation(() => {
        throw new Error('Invalid YAML')
      })

      await expect(getServices()).rejects.toThrow('Invalid YAML')
    })

    it('should handle services without services key', async () => {
      mockYamlParse.mockReturnValue({
        version: '3.8',
        // No services key
      })

      const services = await getServices()

      expect(services).toEqual([])
    })

    it('should deduplicate services across files', async () => {
      mockZx.mockImplementation((cmd: any) => {
        const cmdStr = Array.isArray(cmd)
          ? cmd.join(' ')
          : cmd?.toString() || ''
        if (cmdStr.includes('git rev-parse')) {
          return Promise.resolve({
            stdout: '/home/user/lilnas\n',
            stderr: '',
            exitCode: 0,
          } as any)
        }
        if (cmdStr.includes('fd .yml')) {
          return Promise.resolve({
            stdout:
              '/home/user/lilnas/infra/file1.yml\n/home/user/lilnas/infra/file2.yml\n',
            stderr: '',
            exitCode: 0,
          } as any)
        }
        if (cmdStr.includes('cat')) {
          return Promise.resolve({
            stdout:
              'services:\n  app1:\n    image: nginx\n  app2:\n    image: redis\n',
            stderr: '',
            exitCode: 0,
          } as any)
        }
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 } as any)
      })

      mockYamlParse.mockReturnValue({
        services: {
          app1: { image: 'nginx' },
          app2: { image: 'redis' },
        },
      })

      const services = await getServices()

      expect(services).toEqual(['app1', 'app2'])
    })

    it('should sort services alphabetically', async () => {
      mockYamlParse.mockReturnValue({
        services: {
          zebra: { image: 'nginx' },
          apple: { image: 'redis' },
          banana: { image: 'mongo' },
        },
      })

      const services = await getServices()

      expect(services).toEqual(['apple', 'banana', 'zebra'])
    })
  })

  describe('runInteractive', () => {
    it('should call execSync with inherit stdio by default', () => {
      const command = 'echo "hello"'

      runInteractive(command)

      expect(mockExecSync).toHaveBeenCalledWith(command, { stdio: 'inherit' })
    })

    it('should merge provided options with defaults', () => {
      const command = 'echo "hello"'
      const options = { cwd: '/tmp', env: { NODE_ENV: 'test' } }

      runInteractive(command, options)

      expect(mockExecSync).toHaveBeenCalledWith(command, {
        stdio: 'inherit',
        cwd: '/tmp',
        env: { NODE_ENV: 'test' },
      })
    })

    it('should allow overriding stdio option', () => {
      const command = 'echo "hello"'
      const options = { stdio: 'pipe' as const }

      runInteractive(command, options)

      expect(mockExecSync).toHaveBeenCalledWith(command, { stdio: 'pipe' })
    })

    it('should handle command execution errors', () => {
      const command = 'invalid-command'
      mockExecSync.mockImplementation(() => {
        throw new Error('Command failed')
      })

      expect(() => runInteractive(command)).toThrow('Command failed')
    })
  })

  describe('getDockerImages', () => {
    it('should return list of Docker images', async () => {
      mockZx.mockResolvedValue({
        stdout: 'nginx:latest\nredis:alpine\nnode:18\n',
        stderr: '',
        exitCode: 0,
      } as any)

      const images = await getDockerImages()

      expect(images).toEqual(['nginx:latest', 'redis:alpine', 'node:18'])
      expect(mockZx).toHaveBeenCalled()
    })

    it('should handle empty Docker images output', async () => {
      mockZx.mockResolvedValue({
        stdout: '',
        stderr: '',
        exitCode: 0,
      } as any)

      const images = await getDockerImages()

      expect(images).toEqual([])
    })

    it('should handle Docker command failures', async () => {
      mockZx.mockRejectedValue(new Error('Docker daemon not running'))

      await expect(getDockerImages()).rejects.toThrow(
        'Docker daemon not running',
      )
    })

    it('should filter out empty lines', async () => {
      mockZx.mockResolvedValue({
        stdout: 'nginx:latest\n\nredis:alpine\n\n',
        stderr: '',
        exitCode: 0,
      } as any)

      const images = await getDockerImages()

      expect(images).toEqual(['nginx:latest', 'redis:alpine'])
    })
  })

  describe('runDockerCompose', () => {
    it('should run docker-compose with default file', () => {
      const command = 'up -d'

      runDockerCompose(command)

      expect(mockExecSync).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.yml up -d',
        { stdio: 'inherit' },
      )
    })

    it('should run docker-compose with custom file', () => {
      const command = 'down'
      const file = 'docker-compose.dev.yml'

      runDockerCompose(command, file)

      expect(mockExecSync).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml down',
        { stdio: 'inherit' },
      )
    })

    it('should handle complex commands', () => {
      const command = 'up -d --build --force-recreate service1 service2'

      runDockerCompose(command)

      expect(mockExecSync).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.yml up -d --build --force-recreate service1 service2',
        { stdio: 'inherit' },
      )
    })
  })

  describe('ServicesOptionSchema', () => {
    it('should validate valid services array', () => {
      const input = { services: ['app1', 'app2'] }
      const result = ServicesOptionSchema.parse(input)

      expect(result).toEqual({ services: ['app1', 'app2'] })
    })

    it('should validate empty services array', () => {
      const input = { services: [] }
      const result = ServicesOptionSchema.parse(input)

      expect(result).toEqual({ services: [] })
    })

    it('should reject invalid services format', () => {
      const input = { services: 'invalid' }

      expect(() => ServicesOptionSchema.parse(input)).toThrow()
    })

    it('should reject non-string elements in services array', () => {
      const input = { services: ['valid', 123, 'also-valid'] }

      expect(() => ServicesOptionSchema.parse(input)).toThrow()
    })

    it('should handle missing services property', () => {
      const input = {}

      expect(() => ServicesOptionSchema.parse(input)).toThrow()
    })
  })
})
