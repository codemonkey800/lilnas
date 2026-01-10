import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'

import {
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals'

// Mock child_process module for ESM
const mockSpawn = jest.fn<() => ChildProcess & EventEmitter>()
jest.unstable_mockModule('node:child_process', () => ({
  spawn: mockSpawn,
}))

// Declare variables to hold dynamically imported functions
let checkDockerCompose: () => Promise<void>
let execDockerCompose: (composeFile: string, args: string[]) => Promise<void>
let composeUp: (options: {
  composeFile: string
  services?: string[]
  detach?: boolean
}) => Promise<void>
let composeDown: (options: {
  composeFile: string
  services?: string[]
}) => Promise<void>
let composeBuild: (options: {
  composeFile: string
  services?: string[]
}) => Promise<void>

beforeAll(async () => {
  // Import after mocking
  const module = await import('../docker-compose.js')
  checkDockerCompose = module.checkDockerCompose
  execDockerCompose = module.execDockerCompose
  composeUp = module.composeUp
  composeDown = module.composeDown
  composeBuild = module.composeBuild
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

describe('docker-compose utils', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  describe('checkDockerCompose', () => {
    it('should resolve when docker-compose is available', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = checkDockerCompose()

      // Simulate successful exit
      mockProc.emit('close', 0)

      await expect(promise).resolves.toBeUndefined()
      expect(mockSpawn).toHaveBeenCalledWith('docker-compose', ['--version'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    })

    it('should reject when docker-compose exits with non-zero code', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = checkDockerCompose()

      // Simulate failed exit
      mockProc.emit('close', 1)

      await expect(promise).rejects.toThrow(
        'docker-compose is not installed or not available in PATH',
      )
    })

    it('should reject when spawn fails with error', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = checkDockerCompose()

      // Simulate spawn error (e.g., command not found)
      mockProc.emit('error', new Error('spawn ENOENT'))

      await expect(promise).rejects.toThrow(
        'docker-compose is not installed or not available in PATH',
      )
    })
  })

  describe('execDockerCompose', () => {
    it('should execute docker-compose with correct arguments', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = execDockerCompose('/path/to/compose.yml', [
        'up',
        '-d',
        'service1',
      ])

      mockProc.emit('close', 0)

      await expect(promise).resolves.toBeUndefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker-compose',
        ['-f', '/path/to/compose.yml', 'up', '-d', 'service1'],
        { stdio: 'inherit' },
      )
    })

    it('should reject when docker-compose exits with non-zero code', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = execDockerCompose('/path/to/compose.yml', ['up'])

      mockProc.emit('close', 1)

      await expect(promise).rejects.toThrow('docker-compose exited with code 1')
    })

    it('should reject when spawn fails with error', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = execDockerCompose('/path/to/compose.yml', ['up'])

      mockProc.emit('error', new Error('spawn failed'))

      await expect(promise).rejects.toThrow(
        'Failed to execute docker-compose: spawn failed',
      )
    })
  })

  describe('composeUp', () => {
    it('should call execDockerCompose with up command', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = composeUp({ composeFile: '/path/to/compose.yml' })

      mockProc.emit('close', 0)

      await expect(promise).resolves.toBeUndefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker-compose',
        ['-f', '/path/to/compose.yml', 'up'],
        { stdio: 'inherit' },
      )
    })

    it('should include -d flag when detach is true', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = composeUp({
        composeFile: '/path/to/compose.yml',
        detach: true,
      })

      mockProc.emit('close', 0)

      await expect(promise).resolves.toBeUndefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker-compose',
        ['-f', '/path/to/compose.yml', 'up', '-d'],
        { stdio: 'inherit' },
      )
    })

    it('should include services when provided', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = composeUp({
        composeFile: '/path/to/compose.yml',
        services: ['web', 'db'],
      })

      mockProc.emit('close', 0)

      await expect(promise).resolves.toBeUndefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker-compose',
        ['-f', '/path/to/compose.yml', 'up', 'web', 'db'],
        { stdio: 'inherit' },
      )
    })

    it('should include both detach flag and services', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = composeUp({
        composeFile: '/path/to/compose.yml',
        detach: true,
        services: ['web', 'db'],
      })

      mockProc.emit('close', 0)

      await expect(promise).resolves.toBeUndefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker-compose',
        ['-f', '/path/to/compose.yml', 'up', '-d', 'web', 'db'],
        { stdio: 'inherit' },
      )
    })

    it('should not include services for empty array', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = composeUp({
        composeFile: '/path/to/compose.yml',
        services: [],
      })

      mockProc.emit('close', 0)

      await expect(promise).resolves.toBeUndefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker-compose',
        ['-f', '/path/to/compose.yml', 'up'],
        { stdio: 'inherit' },
      )
    })
  })

  describe('composeDown', () => {
    it('should call execDockerCompose with down command and cleanup flags', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = composeDown({ composeFile: '/path/to/compose.yml' })

      mockProc.emit('close', 0)

      await expect(promise).resolves.toBeUndefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker-compose',
        ['-f', '/path/to/compose.yml', 'down', '--rmi', 'all', '-v'],
        { stdio: 'inherit' },
      )
    })

    it('should include services when provided', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = composeDown({
        composeFile: '/path/to/compose.yml',
        services: ['web', 'db'],
      })

      mockProc.emit('close', 0)

      await expect(promise).resolves.toBeUndefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker-compose',
        [
          '-f',
          '/path/to/compose.yml',
          'down',
          '--rmi',
          'all',
          '-v',
          'web',
          'db',
        ],
        { stdio: 'inherit' },
      )
    })
  })

  describe('composeBuild', () => {
    it('should call execDockerCompose with build command', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = composeBuild({ composeFile: '/path/to/compose.yml' })

      mockProc.emit('close', 0)

      await expect(promise).resolves.toBeUndefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker-compose',
        ['-f', '/path/to/compose.yml', 'build'],
        { stdio: 'inherit' },
      )
    })

    it('should include services when provided', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const promise = composeBuild({
        composeFile: '/path/to/compose.yml',
        services: ['web', 'db'],
      })

      mockProc.emit('close', 0)

      await expect(promise).resolves.toBeUndefined()
      expect(mockSpawn).toHaveBeenCalledWith(
        'docker-compose',
        ['-f', '/path/to/compose.yml', 'build', 'web', 'db'],
        { stdio: 'inherit' },
      )
    })
  })
})
