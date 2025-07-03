import yargs from 'yargs'

import { dev } from '../commands/dev'
import { down } from '../commands/down'
import { list } from '../commands/list'
import { redeploy } from '../commands/redeploy'
import { syncPhotos } from '../commands/sync-photos'
import { up } from '../commands/up'
import { getServices } from '../utils'

// Mock all command modules
jest.mock('../commands/dev')
jest.mock('../commands/down')
jest.mock('../commands/list')
jest.mock('../commands/redeploy')
jest.mock('../commands/sync-photos')
jest.mock('../commands/up')
jest.mock('../utils')

const mockDev = dev as jest.MockedFunction<typeof dev>
const mockDown = down as jest.MockedFunction<typeof down>
const mockList = list as jest.MockedFunction<typeof list>
const mockRedeploy = redeploy as jest.MockedFunction<typeof redeploy>
const mockSyncPhotos = syncPhotos as jest.MockedFunction<typeof syncPhotos>
const mockUp = up as jest.MockedFunction<typeof up>
const mockGetServices = getServices as jest.MockedFunction<typeof getServices>

// Mock yargs
jest.mock('yargs')
const mockYargs = yargs as jest.MockedFunction<typeof yargs>

describe('main', () => {
  let mockArgv: any
  let mockYargsInstance: any

  beforeEach(() => {
    jest.clearAllMocks()
    
    // Mock getServices to return test services
    mockGetServices.mockImplementation(({ dev = false } = {}) => {
      return Promise.resolve(dev ? ['dev-app1', 'dev-app2'] : ['app1', 'app2'])
    })

    // Create a mock yargs instance with all needed methods
    mockYargsInstance = {
      command: jest.fn().mockReturnThis(),
      help: jest.fn().mockReturnThis(),
      alias: jest.fn().mockReturnThis(),
      scriptName: jest.fn().mockReturnThis(),
      showHelpOnFail: jest.fn().mockReturnThis(),
      parse: jest.fn(),
      showHelp: jest.fn(),
    }

    // Mock yargs constructor
    mockYargs.mockReturnValue(mockYargsInstance)
  })

  describe('command routing', () => {
    it('should route "ls" command to list function', async () => {
      mockYargsInstance.parse.mockResolvedValue({ _: ['ls'] })

      // Import and run main
      await import('../main')

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockList).toHaveBeenCalled()
    })

    it('should route "dev" command to dev function', async () => {
      const args = { _: ['dev', 'up'], command: 'up' }
      mockYargsInstance.parse.mockResolvedValue(args)

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockDev).toHaveBeenCalledWith({
        ...args,
        command: 'up',
        shellCommand: undefined,
      })
    })

    it('should route "up" command to up function', async () => {
      const args = { _: ['up'], services: ['app1'] }
      mockYargsInstance.parse.mockResolvedValue(args)

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockUp).toHaveBeenCalledWith(args)
    })

    it('should route "down" command to down function', async () => {
      const args = { _: ['down'], services: ['app1'] }
      mockYargsInstance.parse.mockResolvedValue(args)

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockDown).toHaveBeenCalledWith(args)
    })

    it('should route "redeploy" command to redeploy function', async () => {
      const args = { _: ['redeploy'], services: ['app1'] }
      mockYargsInstance.parse.mockResolvedValue(args)

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockRedeploy).toHaveBeenCalledWith(args)
    })

    it('should route "sync-photos" command to syncPhotos function', async () => {
      const args = { _: ['sync-photos'], email: 'test@example.com' }
      mockYargsInstance.parse.mockResolvedValue(args)

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockSyncPhotos).toHaveBeenCalledWith(args)
    })

    it('should show help for unknown commands', async () => {
      mockYargsInstance.parse.mockResolvedValue({ _: ['unknown-command'] })

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockYargsInstance.showHelp).toHaveBeenCalled()
    })

    it('should show help when no command is provided', async () => {
      mockYargsInstance.parse.mockResolvedValue({ _: [] })

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockYargsInstance.showHelp).toHaveBeenCalled()
    })
  })

  describe('yargs configuration', () => {
    it('should configure yargs with correct commands', async () => {
      mockYargsInstance.parse.mockResolvedValue({ _: ['ls'] })

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      // Verify yargs was configured with expected commands
      expect(mockYargsInstance.command).toHaveBeenCalledWith('ls', 'Lists all services')
      expect(mockYargsInstance.command).toHaveBeenCalledWith('dev [command]', 'Manage dev environment', expect.any(Function))
      expect(mockYargsInstance.command).toHaveBeenCalledWith('up [services...]', 'Deploys a service', expect.any(Function))
      expect(mockYargsInstance.command).toHaveBeenCalledWith('down [services...]', 'Brings down a service', expect.any(Function))
      expect(mockYargsInstance.command).toHaveBeenCalledWith('redeploy [services...]', 'Redeploys a service', expect.any(Function))
      expect(mockYargsInstance.command).toHaveBeenCalledWith(
        'sync-photos [options]',
        'Syncs iCloud photos to a local directory',
        expect.any(Function)
      )
    })

    it('should configure help options', async () => {
      mockYargsInstance.parse.mockResolvedValue({ _: ['ls'] })

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockYargsInstance.help).toHaveBeenCalled()
      expect(mockYargsInstance.alias).toHaveBeenCalledWith('h', 'help')
      expect(mockYargsInstance.scriptName).toHaveBeenCalledWith('lilnas')
      expect(mockYargsInstance.showHelpOnFail).toHaveBeenCalledWith(true)
    })
  })

  describe('service loading', () => {
    it('should load both production and dev services', async () => {
      mockYargsInstance.parse.mockResolvedValue({ _: ['ls'] })

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockGetServices).toHaveBeenCalledWith()
      expect(mockGetServices).toHaveBeenCalledWith({ dev: true })
    })

    it('should handle service loading errors', async () => {
      mockGetServices.mockRejectedValue(new Error('Failed to load services'))
      mockYargsInstance.parse.mockResolvedValue({ _: ['ls'] })

      await expect(import('../main')).rejects.toThrow('Failed to load services')
    })
  })

  describe('dev command configuration', () => {
    it('should configure dev subcommands', async () => {
      mockYargsInstance.parse.mockResolvedValue({ _: ['dev', 'ls'] })

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      // Find the dev command configuration call
      const devCommandCall = mockYargsInstance.command.mock.calls.find(
        call => call[0] === 'dev [command]'
      )
      
      expect(devCommandCall).toBeDefined()
      expect(devCommandCall[2]).toBeInstanceOf(Function)
      
      // Test the dev command configuration function
      const devConfigFn = devCommandCall[2]
      const mockDevArgs = {
        command: jest.fn().mockReturnThis(),
        option: jest.fn().mockReturnThis(),
        positional: jest.fn().mockReturnThis(),
        help: jest.fn().mockReturnThis(),
        strict: jest.fn().mockReturnThis(),
      }
      
      devConfigFn(mockDevArgs)
      
      expect(mockDevArgs.command).toHaveBeenCalledWith('ls', 'Lists all apps with dev mode')
      expect(mockDevArgs.command).toHaveBeenCalledWith('ps [services...]', 'Shows status of services', expect.any(Function))
      expect(mockDevArgs.command).toHaveBeenCalledWith('shell [command]', 'Start a shell within the container', expect.any(Function))
      expect(mockDevArgs.command).toHaveBeenCalledWith('sync-deps', 'Syncronizes npm dependencies from within the dev environment')
      expect(mockDevArgs.command).toHaveBeenCalledWith('*', 'Pass-through to docker-compose', expect.any(Function))
    })

    it('should configure ps subcommand options', async () => {
      mockYargsInstance.parse.mockResolvedValue({ _: ['dev', 'ps'] })

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      // Find the ps command configuration
      const devCommandCall = mockYargsInstance.command.mock.calls.find(
        call => call[0] === 'dev [command]'
      )
      
      const devConfigFn = devCommandCall[2]
      const mockDevArgs = {
        command: jest.fn().mockReturnThis(),
        option: jest.fn().mockReturnThis(),
        positional: jest.fn().mockReturnThis(),
        help: jest.fn().mockReturnThis(),
        strict: jest.fn().mockReturnThis(),
      }
      
      devConfigFn(mockDevArgs)
      
      // Find the ps command configuration
      const psCommandCall = mockDevArgs.command.mock.calls.find(
        call => call[0] === 'ps [services...]'
      )
      
      expect(psCommandCall).toBeDefined()
      expect(psCommandCall[2]).toBeInstanceOf(Function)
      
      // Test the ps command configuration function
      const psConfigFn = psCommandCall[2]
      const mockPsArgs = {
        positional: jest.fn().mockReturnThis(),
        option: jest.fn().mockReturnThis(),
      }
      
      psConfigFn(mockPsArgs)
      
      expect(mockPsArgs.positional).toHaveBeenCalledWith('services', {
        array: true,
        choices: ['dev-app1', 'dev-app2'],
        type: 'string',
      })
      expect(mockPsArgs.option).toHaveBeenCalledWith('all', {
        alias: 'a',
        description: 'Show all containers (default shows just running)',
        type: 'boolean',
      })
      expect(mockPsArgs.option).toHaveBeenCalledWith('quiet', {
        alias: 'q',
        description: 'Only show container IDs',
        type: 'boolean',
      })
      expect(mockPsArgs.option).toHaveBeenCalledWith('filter', {
        description: 'Filter services by a property (e.g. status=running)',
        type: 'string',
      })
    })
  })

  describe('error handling', () => {
    it('should handle yargs parsing errors', async () => {
      mockYargsInstance.parse.mockRejectedValue(new Error('Invalid arguments'))

      await expect(import('../main')).rejects.toThrow('Invalid arguments')
    })

    it('should handle command execution errors', async () => {
      mockYargsInstance.parse.mockResolvedValue({ _: ['ls'] })
      mockList.mockRejectedValue(new Error('List command failed'))

      await import('../main')
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(mockList).toHaveBeenCalled()
    })
  })
})