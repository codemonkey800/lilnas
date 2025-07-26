import { execSync } from 'child_process'

import { dev } from 'src/commands/dev'
import { redeploy } from 'src/commands/redeploy'
import { syncPhotos } from 'src/commands/sync-photos'
import {
  categorizeCommand,
  dispatch,
  forwardToDockerCompose,
  handleDevCommand,
  handleSpecialCommand,
  main,
  parseArgs,
  showCommandHelp,
  showHelp,
} from 'src/main'
import { extractFlags, runInteractive } from 'src/utils'

// Mock all dependencies
jest.mock('child_process')
jest.mock('../commands/dev')
jest.mock('../commands/redeploy')
jest.mock('../commands/sync-photos')
jest.mock('../utils')

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>
const mockDev = dev as jest.MockedFunction<typeof dev>
const mockRedeploy = redeploy as jest.MockedFunction<typeof redeploy>
const mockSyncPhotos = syncPhotos as jest.MockedFunction<typeof syncPhotos>
const mockExtractFlags = extractFlags as jest.MockedFunction<
  typeof extractFlags
>
const mockRunInteractive = runInteractive as jest.MockedFunction<
  typeof runInteractive
>

describe('main CLI', () => {
  beforeEach(() => {
    jest.clearAllMocks()

    // Re-mock process.exit after clearAllMocks
    process.exit = jest.fn() as unknown as typeof process.exit

    // Setup default mocks
    mockExtractFlags.mockReturnValue({})
    mockExecSync.mockReturnValue('mocked docker-compose help output')
  })

  describe('parseArgs', () => {
    beforeEach(() => {
      mockExtractFlags.mockReturnValue({ help: false, verbose: true })
    })

    it('should parse basic command structure', () => {
      const result = parseArgs(['dev', 'up'])

      expect(result).toEqual({
        command: 'dev',
        subCommand: 'up',
        args: [],
        flags: { help: false, verbose: true },
      })
      expect(mockExtractFlags).toHaveBeenCalledWith(['dev', 'up'])
    })

    it('should parse command with arguments', () => {
      const result = parseArgs(['redeploy', 'service1', 'service2', '--all'])

      expect(result).toEqual({
        command: 'redeploy',
        subCommand: undefined,
        args: ['service1', 'service2'],
        flags: { help: false, verbose: true },
      })
    })

    it('should handle single command without subcommand', () => {
      const result = parseArgs(['help'])

      expect(result).toEqual({
        command: 'help',
        subCommand: undefined,
        args: [],
        flags: { help: false, verbose: true },
      })
    })

    it('should handle empty arguments', () => {
      const result = parseArgs([])

      expect(result).toEqual({
        command: undefined,
        subCommand: undefined,
        args: [],
        flags: { help: false, verbose: true },
      })
    })

    it('should filter out flag arguments from positional args', () => {
      const result = parseArgs([
        'dev',
        '--verbose',
        'up',
        '--force',
        'service1',
      ])

      expect(result).toEqual({
        command: 'dev',
        subCommand: 'up',
        args: ['service1'],
        flags: { help: false, verbose: true },
      })
    })

    it('should handle arguments with special characters', () => {
      const result = parseArgs(['sync-photos', '--dest', '/path/with spaces'])

      expect(result).toEqual({
        command: 'sync-photos',
        subCommand: undefined,
        args: ['/path/with spaces'],
        flags: { help: false, verbose: true },
      })
    })

    it('should handle unicode arguments', () => {
      const result = parseArgs(['dev', 'logs', 'service-名前'])

      expect(result).toEqual({
        command: 'dev',
        subCommand: 'logs',
        args: ['service-名前'],
        flags: { help: false, verbose: true },
      })
    })
  })

  describe('categorizeCommand', () => {
    it('should categorize help commands', () => {
      expect(categorizeCommand(undefined)).toBe('help')
      expect(categorizeCommand('help')).toBe('help')
      expect(categorizeCommand('--help')).toBe('help')
      expect(categorizeCommand('-h')).toBe('help')
    })

    it('should categorize special commands', () => {
      expect(categorizeCommand('sync-photos')).toBe('special')
      expect(categorizeCommand('redeploy')).toBe('special')
    })

    it('should categorize dev commands', () => {
      expect(categorizeCommand('dev')).toBe('dev')
    })

    it('should categorize docker-compose commands', () => {
      expect(categorizeCommand('up')).toBe('docker-compose')
      expect(categorizeCommand('down')).toBe('docker-compose')
      expect(categorizeCommand('logs')).toBe('docker-compose')
      expect(categorizeCommand('ps')).toBe('docker-compose')
      expect(categorizeCommand('unknown-command')).toBe('docker-compose')
    })

    it('should handle case sensitivity', () => {
      expect(categorizeCommand('HELP')).toBe('docker-compose')
      expect(categorizeCommand('Dev')).toBe('docker-compose')
      expect(categorizeCommand('SYNC-PHOTOS')).toBe('docker-compose')
    })
  })

  describe('handleSpecialCommand', () => {
    it('should show sync-photos help when help flag is present', async () => {
      const consoleSpy = jest.spyOn(console, 'log')

      await handleSpecialCommand({
        command: 'sync-photos',
        subCommand: undefined,
        args: [],
        flags: { help: true },
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage: lilnas sync-photos --email'),
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('--email <email>'),
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('--dest <destination>'),
      )
    })

    it('should show sync-photos help when -h flag is present', async () => {
      const consoleSpy = jest.spyOn(console, 'log')

      await handleSpecialCommand({
        command: 'sync-photos',
        subCommand: undefined,
        args: [],
        flags: { h: true },
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage: lilnas sync-photos --email'),
      )
    })

    it('should show redeploy help when help flag is present', async () => {
      const consoleSpy = jest.spyOn(console, 'log')

      await handleSpecialCommand({
        command: 'redeploy',
        subCommand: undefined,
        args: [],
        flags: { help: true },
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage: lilnas redeploy [services...]'),
      )
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--all'))
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('--rebuild-base'),
      )
    })

    it('should execute sync-photos with correct arguments', async () => {
      await handleSpecialCommand({
        command: 'sync-photos',
        subCommand: undefined,
        args: [],
        flags: { dest: '/tmp/photos', email: 'test@example.com' },
      })

      expect(mockSyncPhotos).toHaveBeenCalledWith({
        dest: '/tmp/photos',
        email: 'test@example.com',
      })
    })

    it('should execute redeploy with correct arguments', async () => {
      await handleSpecialCommand({
        command: 'redeploy',
        subCommand: undefined,
        args: ['service1', 'service2'],
        flags: { all: true, 'rebuild-base': true },
      })

      expect(mockRedeploy).toHaveBeenCalledWith({
        all: true,
        services: ['service1', 'service2'],
        'rebuild-base': true,
      })
    })

    it('should handle redeploy with no services', async () => {
      await handleSpecialCommand({
        command: 'redeploy',
        subCommand: undefined,
        args: [],
        flags: {},
      })

      expect(mockRedeploy).toHaveBeenCalledWith({
        all: undefined,
        services: [],
        'rebuild-base': undefined,
      })
    })

    it('should filter out flag arguments from services list', async () => {
      await handleSpecialCommand({
        command: 'redeploy',
        subCommand: undefined,
        args: ['service1', 'service2'], // parseArgs already filters flags
        flags: { all: true, 'rebuild-base': true },
      })

      expect(mockRedeploy).toHaveBeenCalledWith({
        all: true,
        services: ['service1', 'service2'],
        'rebuild-base': true,
      })
    })
  })

  describe('handleDevCommand', () => {
    it('should show dev help when no subcommand provided', async () => {
      await handleDevCommand({
        command: 'dev',
        subCommand: undefined,
        args: [],
        flags: {},
      })

      expect(mockDev).toHaveBeenCalledWith({
        command: undefined,
        help: undefined,
        h: undefined,
      })
    })

    it('should show dev help when help flag is present', async () => {
      await handleDevCommand({
        command: 'dev',
        subCommand: 'up',
        args: [],
        flags: { help: true },
      })

      expect(mockDev).toHaveBeenCalledWith({
        command: 'up',
        help: true,
        h: undefined,
      })
    })

    it('should handle custom dev commands', async () => {
      const customCommands = ['redeploy', 'ls', 'ps', 'shell', 'sync-deps']

      for (const cmd of customCommands) {
        mockDev.mockClear()

        await handleDevCommand({
          command: 'dev',
          subCommand: cmd,
          args: ['arg1', 'arg2'],
          flags: { verbose: true },
        })

        expect(mockDev).toHaveBeenCalledWith({
          verbose: true,
          command: cmd,
          _: ['dev', cmd, 'arg1', 'arg2'],
        })
      }
    })

    it('should forward non-custom commands to docker-compose', async () => {
      await handleDevCommand({
        command: 'dev',
        subCommand: 'up',
        args: ['-d', 'service1'],
        flags: {},
      })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml up -d service1',
      )
    })

    it('should forward flags to docker-compose when forwarding commands', async () => {
      await handleDevCommand({
        command: 'dev',
        subCommand: 'logs',
        args: ['service1'], // parseArgs already filters flags
        flags: { verbose: true },
      })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml logs service1 --verbose',
      )
    })

    it('should handle empty args when forwarding to docker-compose', async () => {
      await handleDevCommand({
        command: 'dev',
        subCommand: 'down',
        args: [],
        flags: {},
      })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml down',
      )
    })
  })

  describe('forwardToDockerCompose', () => {
    it('should forward commands to docker-compose with production file', async () => {
      await forwardToDockerCompose({
        command: 'up',
        subCommand: undefined,
        args: ['-d', 'service1'],
        flags: {},
      })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.yml up -d service1',
      )
    })

    it('should handle commands without arguments', async () => {
      await forwardToDockerCompose({
        command: 'ps',
        subCommand: undefined,
        args: [],
        flags: {},
      })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.yml ps',
      )
    })

    it('should exit with error when no command provided', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error')
      const mockExit = process.exit as jest.MockedFunction<typeof process.exit>

      await forwardToDockerCompose({
        command: undefined,
        subCommand: undefined,
        args: [],
        flags: {},
      })

      expect(consoleErrorSpy).toHaveBeenCalledWith('Error: No command provided')
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('should filter out undefined values from command array', async () => {
      await forwardToDockerCompose({
        command: 'up',
        subCommand: undefined,
        args: ['service1'],
        flags: {},
      })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.yml up service1',
      )
    })
  })

  describe('showCommandHelp', () => {
    it('should show dev subcommand help', async () => {
      const consoleSpy = jest.spyOn(console, 'log')
      mockExecSync.mockReturnValue('Usage: docker-compose up [options]')

      await showCommandHelp('dev', ['up'])

      expect(mockExecSync).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml up --help',
        { encoding: 'utf8' },
      )
      expect(consoleSpy).toHaveBeenCalledWith('Usage: lilnas dev up [options]')
    })

    it('should show dev general help by calling handleDevCommand', async () => {
      await showCommandHelp('dev', [])

      expect(mockDev).toHaveBeenCalledWith({
        command: undefined,
        help: true,
        h: undefined,
      })
    })

    it('should show production command help', async () => {
      const consoleSpy = jest.spyOn(console, 'log')
      mockExecSync.mockReturnValue('Usage: docker-compose logs [options]')

      await showCommandHelp('logs', [])

      expect(mockExecSync).toHaveBeenCalledWith('docker-compose logs --help', {
        encoding: 'utf8',
      })
      expect(consoleSpy).toHaveBeenCalledWith('Usage: lilnas logs [options]')
    })

    it('should replace both docker-compose and docker compose references', async () => {
      const consoleSpy = jest.spyOn(console, 'log')
      mockExecSync.mockReturnValue(
        'Usage: docker compose up\nRun docker-compose --help for more info',
      )

      await showCommandHelp('up', [])

      expect(consoleSpy).toHaveBeenCalledWith(
        'Usage: lilnas up\nRun lilnas --help for more info',
      )
    })

    it('should handle docker-compose command errors', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error')
      const mockExit = process.exit as jest.MockedFunction<typeof process.exit>
      const error = new Error('Unknown command')

      mockExecSync.mockImplementation(() => {
        throw error
      })

      await showCommandHelp('invalid', [])

      expect(consoleErrorSpy).toHaveBeenCalledWith('Unknown command')
      expect(mockExit).toHaveBeenCalledWith(1)
    })

    it('should handle non-Error objects in catch block', async () => {
      const consoleErrorSpy = jest.spyOn(console, 'error')
      const mockExit = process.exit as jest.MockedFunction<typeof process.exit>

      mockExecSync.mockImplementation(() => {
        throw 'string error'
      })

      await showCommandHelp('invalid', [])

      expect(consoleErrorSpy).toHaveBeenCalledWith('string error')
      expect(mockExit).toHaveBeenCalledWith(1)
    })
  })

  describe('showHelp', () => {
    const mockDockerComposeHelp = `Usage: docker-compose [options] [COMMAND] [ARGS...]

Options:
  --version  Show version

Commands:
  up         Create and start containers
  down       Stop and remove containers`

    it('should show command-specific help when command is provided', async () => {
      const consoleSpy = jest.spyOn(console, 'log')
      mockExecSync.mockReturnValue('Usage: docker-compose up [options]')

      await showHelp({
        command: 'up',
        subCommand: undefined,
        args: [],
        flags: {},
      })

      expect(mockExecSync).toHaveBeenCalledWith('docker-compose up --help', {
        encoding: 'utf8',
      })
      expect(consoleSpy).toHaveBeenCalledWith('Usage: lilnas up [options]')
    })

    it('should show dev command-specific help with subcommand', async () => {
      await showHelp({
        command: 'dev',
        subCommand: 'logs',
        args: ['service1'],
        flags: {},
      })

      expect(mockExecSync).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml logs --help',
        { encoding: 'utf8' },
      )
    })

    it('should show integrated help when no specific command', async () => {
      const consoleSpy = jest.spyOn(console, 'log')
      mockExecSync.mockReturnValue(mockDockerComposeHelp)

      await showHelp()

      expect(mockExecSync).toHaveBeenCalledWith('docker-compose --help', {
        encoding: 'utf8',
      })
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('lilnas Custom Commands:'),
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('sync-photos'),
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('redeploy'),
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Docker Compose Commands:'),
      )
    })

    it('should integrate custom commands section properly', async () => {
      const consoleSpy = jest.spyOn(console, 'log')
      const helpWithCommands = `Usage: docker-compose [options] [COMMAND]

Commands:
  up    Start services`

      mockExecSync.mockReturnValue(helpWithCommands)

      await showHelp()

      const helpOutput = consoleSpy.mock.calls[0][0]
      expect(helpOutput).toMatch(
        /lilnas Custom Commands:.*Docker Compose Commands:/s,
      )
      expect(helpOutput).toContain('Usage:  lilnas') // should replace docker-compose with lilnas
    })

    it('should show fallback help when docker-compose is unavailable', async () => {
      const consoleSpy = jest.spyOn(console, 'log')
      mockExecSync.mockImplementation(() => {
        throw new Error('docker-compose not found')
      })

      await showHelp()

      expect(consoleSpy).toHaveBeenCalledWith(
        'lilnas: Docker Compose CLI wrapper with custom commands',
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Custom Commands:'),
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('sync-photos'),
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('redeploy'),
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('dev COMMAND'),
      )
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('docker-compose must be installed'),
      )
    })

    it('should replace various docker-compose reference patterns', async () => {
      const consoleSpy = jest.spyOn(console, 'log')
      const complexHelp = `Usage: docker compose [options]
Run 'docker compose COMMAND --help' for more information.
Use docker-compose for legacy support.`

      mockExecSync.mockReturnValue(complexHelp)

      await showHelp()

      const helpOutput = consoleSpy.mock.calls[0][0]
      expect(helpOutput).toContain('Usage:  lilnas [options]')
      expect(helpOutput).toContain("Run 'lilnas COMMAND --help'")
      expect(helpOutput).toContain('Use lilnas for legacy support.')
    })
  })

  describe('dispatch', () => {
    it('should route to showHelp for help command type', async () => {
      const consoleSpy = jest.spyOn(console, 'log')
      mockExecSync.mockReturnValue('docker-compose help')

      await dispatch({
        command: 'help',
        subCommand: undefined,
        args: [],
        flags: {},
      })

      expect(consoleSpy).toHaveBeenCalled()
    })

    it('should route to handleSpecialCommand for special command type', async () => {
      await dispatch({
        command: 'sync-photos',
        subCommand: undefined,
        args: [],
        flags: { email: 'test@test.com', dest: '/tmp' },
      })

      expect(mockSyncPhotos).toHaveBeenCalledWith({
        email: 'test@test.com',
        dest: '/tmp',
      })
    })

    it('should route to handleDevCommand for dev command type', async () => {
      await dispatch({
        command: 'dev',
        subCommand: 'up',
        args: ['-d'],
        flags: {},
      })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml up -d',
      )
    })

    it('should route to forwardToDockerCompose for docker-compose command type', async () => {
      await dispatch({
        command: 'up',
        subCommand: undefined,
        args: ['-d'],
        flags: {},
      })

      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.yml up -d',
      )
    })

    it('should handle help flags for special commands', async () => {
      const consoleSpy = jest.spyOn(console, 'log')

      await dispatch({
        command: 'redeploy',
        subCommand: undefined,
        args: [],
        flags: { help: true },
      })

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Usage: lilnas redeploy'),
      )
    })

    it('should handle help flags for dev commands', async () => {
      await dispatch({
        command: 'dev',
        subCommand: 'up',
        args: [],
        flags: { h: true },
      })

      expect(mockDev).toHaveBeenCalledWith({
        command: 'up',
        help: true,
        h: true,
      })
    })

    it('should use integrated help system for docker-compose commands with help flags', async () => {
      const consoleSpy = jest.spyOn(console, 'log')
      mockExecSync.mockReturnValue('docker-compose up help')

      await dispatch({
        command: 'up',
        subCommand: undefined,
        args: [],
        flags: { help: true },
      })

      expect(consoleSpy).toHaveBeenCalled()
    })
  })

  describe('main', () => {
    const originalArgv = process.argv

    beforeEach(() => {
      process.argv = ['node', 'script.js']
    })

    afterEach(() => {
      process.argv = originalArgv
    })

    it('should parse process.argv and dispatch correctly', async () => {
      process.argv = ['node', 'script.js', 'dev', 'up', '-d']
      mockExtractFlags.mockReturnValue({ d: true })

      await main()

      expect(mockExtractFlags).toHaveBeenCalledWith(['dev', 'up', '-d'])
      expect(mockRunInteractive).toHaveBeenCalledWith(
        'docker-compose -f docker-compose.dev.yml up -d',
      )
    })

    it('should handle empty argv', async () => {
      process.argv = ['node', 'script.js']
      const consoleSpy = jest.spyOn(console, 'log')
      mockExecSync.mockReturnValue('docker-compose help')

      await main()

      expect(consoleSpy).toHaveBeenCalled() // Should show help
    })

    it('should handle sync-photos command', async () => {
      process.argv = [
        'node',
        'script.js',
        'sync-photos',
        '--email',
        'test@test.com',
        '--dest',
        '/tmp',
      ]
      mockExtractFlags.mockReturnValue({ email: 'test@test.com', dest: '/tmp' })

      await main()

      expect(mockSyncPhotos).toHaveBeenCalledWith({
        email: 'test@test.com',
        dest: '/tmp',
      })
    })

    it('should handle redeploy command', async () => {
      process.argv = ['node', 'script.js', 'redeploy', '--all', 'service1']
      mockExtractFlags.mockReturnValue({ all: true })

      await main()

      expect(mockRedeploy).toHaveBeenCalledWith({
        all: true,
        services: ['service1'],
        'rebuild-base': undefined,
      })
    })

    it('should handle help command', async () => {
      process.argv = ['node', 'script.js', '--help']
      mockExtractFlags.mockReturnValue({ help: true })
      const consoleSpy = jest.spyOn(console, 'log')
      mockExecSync.mockReturnValue('docker-compose help')

      await main()

      expect(consoleSpy).toHaveBeenCalled()
    })
  })
})
