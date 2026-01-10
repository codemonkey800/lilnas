import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { Stats } from 'node:fs'

import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals'

import type { ServiceInfo } from 'src/types.js'

// Mock functions
const mockAccessSync = jest.fn()
const mockAccess = jest.fn<() => Promise<void>>()
const mockReaddir = jest.fn<() => Promise<string[]>>()
const mockReadFile = jest.fn<() => Promise<string>>()
const mockStat = jest.fn<() => Promise<Stats>>()
const mockSpawn = jest.fn<() => ChildProcess & EventEmitter>()

// Setup ESM mocks
jest.unstable_mockModule('node:fs', () => ({
  accessSync: mockAccessSync,
}))

jest.unstable_mockModule('node:fs/promises', () => ({
  access: mockAccess,
  readdir: mockReaddir,
  readFile: mockReadFile,
  stat: mockStat,
}))

jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
}))

// Declare variables to hold dynamically imported functions
let findProjectRoot: (startDir?: string) => string
let getComposeFile: (devMode: boolean, rootDir: string) => string
let getDeployFile: (devMode: boolean, packageDir: string) => string
let getServicesFromFile: (composeFile: string) => Promise<string[]>
let listPackageServices: (
  devMode: boolean,
  rootDir: string,
) => Promise<ServiceInfo[]>
let listInfraServices: (
  devMode: boolean,
  rootDir: string,
) => Promise<ServiceInfo[]>
let listAllServices: (
  devMode: boolean,
  rootDir: string,
) => Promise<ServiceInfo[]>

beforeAll(async () => {
  const module = await import('../service-discovery.js')
  findProjectRoot = module.findProjectRoot
  getComposeFile = module.getComposeFile
  getDeployFile = module.getDeployFile
  getServicesFromFile = module.getServicesFromFile
  listPackageServices = module.listPackageServices
  listInfraServices = module.listInfraServices
  listAllServices = module.listAllServices
})

/**
 * Create a mock ChildProcess that emits events
 */
function createMockProcess(): ChildProcess & EventEmitter {
  const proc = new EventEmitter() as ChildProcess & EventEmitter
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proc.stdout = new EventEmitter() as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proc.stderr = new EventEmitter() as any
  return proc
}

/**
 * Create a mock Stats object
 */
function createMockStats(isDir: boolean): Stats {
  return {
    isDirectory: () => isDir,
  } as Stats
}

/**
 * Helper to emit process events after promise handlers are registered
 */
function emitAfterTick(
  proc: ChildProcess & EventEmitter,
  stdout: string,
  exitCode: number,
): void {
  setImmediate(() => {
    if (stdout) {
      proc.stdout.emit('data', Buffer.from(stdout))
    }
    proc.emit('close', exitCode)
  })
}

describe('service-discovery utils', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('findProjectRoot', () => {
    it('should find project root at current directory', () => {
      mockAccessSync.mockImplementation(() => undefined)

      const result = findProjectRoot('/home/user/project')

      expect(result).toBe('/home/user/project')
      expect(mockAccessSync).toHaveBeenCalledWith(
        '/home/user/project/pnpm-workspace.yaml',
      )
    })

    it('should walk up directories to find project root', () => {
      mockAccessSync
        .mockImplementationOnce(() => {
          throw new Error('ENOENT')
        })
        .mockImplementationOnce(() => {
          throw new Error('ENOENT')
        })
        .mockImplementationOnce(() => undefined)

      const result = findProjectRoot('/home/user/project/packages/cli')

      expect(result).toBe('/home/user/project')
      expect(mockAccessSync).toHaveBeenCalledTimes(3)
    })

    it('should throw error when pnpm-workspace.yaml is not found', () => {
      mockAccessSync.mockImplementation(() => {
        throw new Error('ENOENT')
      })

      expect(() => findProjectRoot('/home/user')).toThrow(
        'Could not find monorepo root (no pnpm-workspace.yaml found)',
      )
    })
  })

  describe('getComposeFile', () => {
    it('should return production compose file path when devMode is false', () => {
      const result = getComposeFile(false, '/project')

      expect(result).toBe('/project/docker-compose.yml')
    })

    it('should return development compose file path when devMode is true', () => {
      const result = getComposeFile(true, '/project')

      expect(result).toBe('/project/docker-compose.dev.yml')
    })
  })

  describe('getDeployFile', () => {
    it('should return production deploy file path when devMode is false', () => {
      const result = getDeployFile(false, '/project/packages/web')

      expect(result).toBe('/project/packages/web/deploy.yml')
    })

    it('should return development deploy file path when devMode is true', () => {
      const result = getDeployFile(true, '/project/packages/web')

      expect(result).toBe('/project/packages/web/deploy.dev.yml')
    })
  })

  describe('getServicesFromFile', () => {
    it('should return service names when docker-compose succeeds', async () => {
      mockAccess.mockResolvedValue(undefined)
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = getServicesFromFile('/path/to/compose.yml')

      // Emit events after promise handlers are registered
      emitAfterTick(mockProc, 'web\ndb\nredis\n', 0)

      const result = await promise

      expect(result).toEqual(['web', 'db', 'redis'])
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker-compose',
        ['-f', '/path/to/compose.yml', 'config', '--services'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
    })

    it('should throw error when compose file does not exist', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'))

      await expect(getServicesFromFile('/nonexistent.yml')).rejects.toThrow(
        'Compose file not found: /nonexistent.yml',
      )
    })

    it('should return empty array when docker-compose fails', async () => {
      mockAccess.mockResolvedValue(undefined)
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = getServicesFromFile('/path/to/invalid.yml')

      emitAfterTick(mockProc, '', 1)

      const result = await promise

      expect(result).toEqual([])
    })
  })

  describe('listPackageServices', () => {
    it('should return services from packages with deploy files', async () => {
      // Mock packages directory and deploy files exist
      mockAccess.mockResolvedValue(undefined)

      // Mock readdir returns package directories
      mockReaddir.mockResolvedValue(['web', 'api', 'utils'])

      // Mock stat: web and api are directories, utils is a file
      mockStat
        .mockResolvedValueOnce(createMockStats(true)) // web
        .mockResolvedValueOnce(createMockStats(true)) // api
        .mockResolvedValueOnce(createMockStats(false)) // utils (not a dir)

      // Mock spawn for getServicesFromFile calls
      const mockProc1 = createMockProcess()
      const mockProc2 = createMockProcess()
      mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2)

      // Emit events after processes are created
      setImmediate(() => {
        mockProc1.stdout.emit('data', Buffer.from('web-service\n'))
        mockProc1.emit('close', 0)
      })

      setImmediate(() => {
        mockProc2.stdout.emit('data', Buffer.from('api-service\n'))
        mockProc2.emit('close', 0)
      })

      const result = await listPackageServices(false, '/project')

      expect(result).toEqual([
        {
          name: 'web-service',
          source: 'package',
          composeFile: '/project/packages/web/deploy.yml',
        },
        {
          name: 'api-service',
          source: 'package',
          composeFile: '/project/packages/api/deploy.yml',
        },
      ])
    })

    it('should throw error when packages directory does not exist', async () => {
      mockAccess.mockRejectedValue(new Error('ENOENT'))

      await expect(listPackageServices(false, '/project')).rejects.toThrow(
        'Packages directory not found: /project/packages',
      )
    })

    it('should skip packages without deploy files', async () => {
      mockAccess
        .mockResolvedValueOnce(undefined) // packages dir exists
        .mockRejectedValueOnce(new Error('ENOENT')) // web has no deploy file

      mockReaddir.mockResolvedValue(['web'])
      mockStat.mockResolvedValue(createMockStats(true))

      const result = await listPackageServices(false, '/project')

      expect(result).toEqual([])
    })
  })

  describe('listInfraServices', () => {
    it('should return services from included infra files', async () => {
      // Mock directories and files exist
      mockAccess.mockResolvedValue(undefined)

      // Mock compose file content with infra includes
      mockReadFile.mockResolvedValue(`
include:
  - ./infra/proxy.yml
  - ./infra/storage.yml
`)

      // Mock spawn for getServicesFromFile calls
      const mockProc1 = createMockProcess()
      const mockProc2 = createMockProcess()
      mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2)

      // Emit events after processes are created
      setImmediate(() => {
        mockProc1.stdout.emit('data', Buffer.from('traefik\n'))
        mockProc1.emit('close', 0)
      })

      setImmediate(() => {
        mockProc2.stdout.emit('data', Buffer.from('minio\n'))
        mockProc2.emit('close', 0)
      })

      const result = await listInfraServices(false, '/project')

      expect(result).toEqual([
        {
          name: 'traefik',
          source: 'infra',
          composeFile: '/project/infra/proxy.yml',
        },
        {
          name: 'minio',
          source: 'infra',
          composeFile: '/project/infra/storage.yml',
        },
      ])
    })

    it('should throw error when infra directory does not exist', async () => {
      // First call is for infra dir check, which fails
      mockAccess.mockRejectedValueOnce(new Error('ENOENT'))

      await expect(listInfraServices(false, '/project')).rejects.toThrow(
        'Infra directory not found: /project/infra',
      )
    })

    it('should throw error when compose file does not exist', async () => {
      mockAccess
        .mockResolvedValueOnce(undefined) // infra dir exists
        .mockRejectedValueOnce(new Error('ENOENT')) // compose file doesn't exist

      await expect(listInfraServices(false, '/project')).rejects.toThrow(
        'Compose file not found: /project/docker-compose.yml',
      )
    })

    it('should skip non-existent infra files', async () => {
      mockAccess
        .mockResolvedValueOnce(undefined) // infra dir
        .mockResolvedValueOnce(undefined) // compose file
        .mockRejectedValueOnce(new Error('ENOENT')) // proxy.yml doesn't exist

      mockReadFile.mockResolvedValue(`
include:
  - ./infra/proxy.yml
`)

      const result = await listInfraServices(false, '/project')

      expect(result).toEqual([])
    })
  })

  describe('listAllServices', () => {
    it('should return combined services from packages and infra', async () => {
      // Mock all access calls to succeed
      mockAccess.mockResolvedValue(undefined)

      // Mock readdir for packages
      mockReaddir.mockResolvedValue(['web'])

      // Mock stat for package directory check
      mockStat.mockResolvedValue(createMockStats(true))

      // Mock compose file content for infra
      mockReadFile.mockResolvedValue(`
include:
  - ./infra/proxy.yml
`)

      // Mock spawn for both package and infra service discovery
      const mockProc1 = createMockProcess()
      const mockProc2 = createMockProcess()
      mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2)

      // Emit events after processes are created
      setImmediate(() => {
        mockProc1.stdout.emit('data', Buffer.from('web-service\n'))
        mockProc1.emit('close', 0)
      })

      setImmediate(() => {
        mockProc2.stdout.emit('data', Buffer.from('traefik\n'))
        mockProc2.emit('close', 0)
      })

      const result = await listAllServices(false, '/project')

      expect(result).toContainEqual({
        name: 'web-service',
        source: 'package',
        composeFile: '/project/packages/web/deploy.yml',
      })
      expect(result).toContainEqual({
        name: 'traefik',
        source: 'infra',
        composeFile: '/project/infra/proxy.yml',
      })
    })
  })
})
