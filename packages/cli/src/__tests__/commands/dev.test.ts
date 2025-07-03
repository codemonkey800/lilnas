import { execSync } from 'child_process'

import { dev } from '../../commands/dev'
import {
  getDockerImages,
  getRepoDir,
  getServices,
  runDockerCompose,
  runInteractive,
} from '../../utils'

// Mock all dependencies
jest.mock('child_process')
jest.mock('../../utils')

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>
const mockGetDockerImages = getDockerImages as jest.MockedFunction<typeof getDockerImages>
const mockGetRepoDir = getRepoDir as jest.MockedFunction<typeof getRepoDir>
const mockGetServices = getServices as jest.MockedFunction<typeof getServices>
const mockRunDockerCompose = runDockerCompose as jest.MockedFunction<typeof runDockerCompose>
const mockRunInteractive = runInteractive as jest.MockedFunction<typeof runInteractive>

// Mock console methods
const mockConsoleLog = console.log as jest.MockedFunction<typeof console.log>
const mockConsoleError = console.error as jest.MockedFunction<typeof console.error>

describe('dev command', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    
    // Setup default mocks
    mockGetServices.mockResolvedValue(['dev-app1', 'dev-app2'])
    mockGetRepoDir.mockResolvedValue('/home/user/lilnas')
    mockGetDockerImages.mockResolvedValue(['nginx:latest', 'redis:alpine'])
  })

  describe('list subcommand', () => {
    it('should list all dev services', async () => {
      await dev({ command: 'ls' })

      expect(mockGetServices).toHaveBeenCalledWith({ dev: true })
      expect(mockConsoleLog).toHaveBeenCalledWith('dev-app1\ndev-app2')
    })

    it('should handle empty services list', async () => {
      mockGetServices.mockResolvedValue([])

      await dev({ command: 'ls' })

      expect(mockConsoleLog).toHaveBeenCalledWith('')
    })

    it('should handle service loading errors', async () => {
      mockGetServices.mockRejectedValue(new Error('Failed to load services'))

      await expect(dev({ command: 'ls' })).rejects.toThrow('Failed to load services')
    })
  })

  describe('ps subcommand', () => {
    it('should show container status in formatted output', async () => {
      const mockContainers = [
        {
          ID: '12345',
          Name: 'dev-app1',
          Image: 'nginx:latest',
          Service: 'dev-app1',
          State: 'running',
          Status: 'Up 5 minutes',
        },
        {
          ID: '67890',
          Name: 'dev-app2',
          Image: 'redis:alpine',
          Service: 'dev-app2',
          State: 'running',
          Status: 'Up 3 minutes',
        },
      ]

      mockExecSync.mockReturnValue(
        mockContainers.map(c => JSON.stringify(c)).join('\n')
      )

      await dev({ command: 'ps' })

      expect(mockExecSync).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml ps --format=json',
        { encoding: 'utf8' }
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        'SERVICE'.padEnd(18) + 'IMAGE'.padEnd(28) + 'STATUS'
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        'dev-app1'.padEnd(18) + 'nginx:latest'.padEnd(28) + 'Up 5 minutes'
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(
        'dev-app2'.padEnd(18) + 'redis:alpine'.padEnd(28) + 'Up 3 minutes'
      )
    })

    it('should handle quiet mode', async () => {
      await dev({ command: 'ps', quiet: true })

      expect(mockRunDockerCompose).toHaveBeenCalledWith('ps -q', 'docker-compose.dev.yml')
      expect(mockExecSync).not.toHaveBeenCalled()
    })

    it('should handle --all flag', async () => {
      await dev({ command: 'ps', all: true })

      expect(mockExecSync).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml ps --format=json -a',
        { encoding: 'utf8' }
      )
    })

    it('should handle --filter flag', async () => {
      await dev({ command: 'ps', filter: 'status=running' })

      expect(mockExecSync).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml ps --format=json --filter=status=running',
        { encoding: 'utf8' }
      )
    })

    it('should handle specific services', async () => {
      await dev({ command: 'ps', services: ['dev-app1'] })

      expect(mockExecSync).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml ps --format=json dev-app1',
        { encoding: 'utf8' }
      )
    })

    it('should handle empty container output', async () => {
      mockExecSync.mockReturnValue('')

      await dev({ command: 'ps' })

      expect(mockConsoleLog).toHaveBeenCalledWith('No containers found')
    })

    it('should handle execSync errors', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Docker command failed')
      })

      await dev({ command: 'ps' })

      expect(mockConsoleError).toHaveBeenCalledWith(
        'Error getting container status:',
        'Docker command failed'
      )
    })

    it('should truncate long image names', async () => {
      const mockContainer = {
        ID: '12345',
        Name: 'dev-app1',
        Image: 'very-long-image-name-that-exceeds-25-characters:latest',
        Service: 'dev-app1',
        State: 'running',
        Status: 'Up 5 minutes',
      }

      mockExecSync.mockReturnValue(JSON.stringify(mockContainer))

      await dev({ command: 'ps' })

      expect(mockConsoleLog).toHaveBeenCalledWith(
        'dev-app1'.padEnd(18) + 'very-long-image-name-...'.padEnd(28) + 'Up 5 minutes'
      )
    })
  })

  describe('shell subcommand', () => {
    it('should start interactive shell', async () => {
      await dev({ command: 'shell' })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker run --rm -it -w /source -v /home/user/lilnas:/source lilnas-dev'
      )
    })

    it('should run specific command in shell', async () => {
      await dev({ command: 'shell', shellCommand: 'ls -la' })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker run --rm -it -w /source -v /home/user/lilnas:/source lilnas-dev -c "ls -la"'
      )
    })

    it('should build dev image if not exists', async () => {
      mockGetDockerImages.mockResolvedValue(['nginx:latest', 'redis:alpine'])

      await dev({ command: 'shell' })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker build --rm -t lilnas-dev -f Dockerfile.dev .'
      )
    })

    it('should not build dev image if already exists', async () => {
      mockGetDockerImages.mockResolvedValue(['lilnas-dev:latest', 'nginx:latest'])

      await dev({ command: 'shell' })

      expect(mockRunInteractive).not.toHaveBeenCalledWith(
        expect.stringContaining('docker build')
      )
    })

    it('should handle shell command with quotes', async () => {
      await dev({ command: 'shell', shellCommand: 'echo "hello world"' })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker run --rm -it -w /source -v /home/user/lilnas:/source lilnas-dev -c "echo "hello world""'
      )
    })
  })

  describe('sync-deps subcommand', () => {
    it('should sync dependencies using shell command', async () => {
      await dev({ command: 'sync-deps' })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker run --rm -it -w /source -v /home/user/lilnas:/source lilnas-dev -c "pnpm i"'
      )
    })

    it('should build dev image if not exists', async () => {
      mockGetDockerImages.mockResolvedValue(['nginx:latest'])

      await dev({ command: 'sync-deps' })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker build --rm -t lilnas-dev -f Dockerfile.dev .'
      )
    })
  })

  describe('help handling', () => {
    it('should show custom help when no command provided', async () => {
      mockExecSync.mockReturnValue('docker-compose help output')

      await dev({ help: true })

      expect(mockExecSync).toHaveBeenCalledWith('docker-compose -h', { encoding: 'utf8' })
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('lilnas dev'))
    })

    it('should show custom help for help command', async () => {
      mockExecSync.mockReturnValue('docker-compose help output')

      await dev({ command: 'help' })

      expect(mockExecSync).toHaveBeenCalledWith('docker-compose -h', { encoding: 'utf8' })
    })

    it('should handle help display errors', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Help command failed')
      })

      await dev({ help: true })

      expect(mockConsoleError).toHaveBeenCalledWith('Error displaying help:', expect.any(Error))
    })
  })

  describe('pass-through commands', () => {
    it('should pass through docker-compose commands', async () => {
      await dev({ command: 'up', _: ['dev', 'up', 'service1'] })

      expect(mockRunDockerCompose).toHaveBeenCalledWith('up service1', 'docker-compose.dev.yml')
    })

    it('should handle pass-through with flags', async () => {
      await dev({ command: 'up', all: true, _: ['dev', 'up'] })

      expect(mockRunDockerCompose).toHaveBeenCalledWith('up --all', 'docker-compose.dev.yml')
    })

    it('should handle pass-through help requests', async () => {
      mockExecSync.mockReturnValue('docker-compose up help')

      await dev({ command: 'up', help: true })

      expect(mockExecSync).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml up --help',
        { encoding: 'utf8' }
      )
      expect(mockConsoleLog).toHaveBeenCalledWith(expect.stringContaining('lilnas dev'))
    })

    it('should handle pass-through help errors', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('Help command failed')
      })

      await dev({ command: 'up', help: true })

      expect(mockConsoleError).toHaveBeenCalledWith('Error displaying command help:', expect.any(Error))
    })

    it('should handle services array for pass-through', async () => {
      await dev({ command: 'up', services: ['app1', 'app2'] })

      expect(mockRunDockerCompose).toHaveBeenCalledWith('up app1 app2', 'docker-compose.dev.yml')
    })

    it('should handle services boolean flag', async () => {
      await dev({ command: 'config', services: true })

      expect(mockRunDockerCompose).toHaveBeenCalledWith('config --services', 'docker-compose.dev.yml')
    })
  })

  describe('error handling', () => {
    it('should handle invalid options schema', async () => {
      const invalidOptions = { command: 123 }

      await expect(dev(invalidOptions)).rejects.toThrow()
    })

    it('should handle Docker image listing errors', async () => {
      mockGetDockerImages.mockRejectedValue(new Error('Docker not available'))

      await expect(dev({ command: 'shell' })).rejects.toThrow('Docker not available')
    })

    it('should handle repo directory errors', async () => {
      mockGetRepoDir.mockRejectedValue(new Error('Not a git repo'))

      await expect(dev({ command: 'shell' })).rejects.toThrow('Not a git repo')
    })
  })

  describe('edge cases', () => {
    it('should handle empty command', async () => {
      mockExecSync.mockReturnValue('help output')

      await dev({})

      expect(mockExecSync).toHaveBeenCalledWith('docker-compose -h', { encoding: 'utf8' })
    })

    it('should handle undefined options', async () => {
      await expect(dev(undefined)).rejects.toThrow()
    })

    it('should handle null options', async () => {
      await expect(dev(null)).rejects.toThrow()
    })

    it('should filter out dev and command from args', async () => {
      await dev({ command: 'up', _: ['dev', 'up', 'service1', 'service2'] })

      expect(mockRunDockerCompose).toHaveBeenCalledWith('up service1 service2', 'docker-compose.dev.yml')
    })

    it('should handle multiple flags together', async () => {
      await dev({ command: 'ps', all: true, quiet: true, filter: 'status=running' })

      expect(mockRunDockerCompose).toHaveBeenCalledWith(
        'ps -q -a --filter=status=running', 
        'docker-compose.dev.yml'
      )
    })
  })
})