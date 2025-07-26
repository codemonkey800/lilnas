import { execSync } from 'child_process'

import { dev } from './commands/dev'
import { redeploy } from './commands/redeploy'
import { syncPhotos } from './commands/sync-photos'
import { extractFlags, runInteractive } from './utils'

// TypeScript interfaces for new architecture
export interface ParsedCommand {
  command?: string
  subCommand?: string
  args: string[]
  flags: Record<string, string | boolean>
}

export type CommandType = 'special' | 'dev' | 'docker-compose' | 'help'

// Parse command line arguments into structured format
export function parseArgs(argv: string[]): ParsedCommand {
  // Filter out flag arguments to get positional args
  const positionalArgs = argv.filter(arg => !arg.startsWith('-'))
  const [command] = positionalArgs

  // Commands that have subcommands
  const commandsWithSubcommands = ['dev']

  let subCommand: string | undefined
  let remainingArgs: string[]

  if (commandsWithSubcommands.includes(command || '')) {
    // For commands with subcommands, second arg is subCommand
    subCommand = positionalArgs[1]
    remainingArgs = positionalArgs.slice(2)
  } else {
    // For commands without subcommands, all args after command are in args
    subCommand = undefined
    remainingArgs = positionalArgs.slice(1)
  }

  return {
    command,
    subCommand,
    args: remainingArgs,
    flags: extractFlags(argv),
  }
}

// Categorize commands by type
export function categorizeCommand(command?: string): CommandType {
  if (
    !command ||
    command === 'help' ||
    command === '--help' ||
    command === '-h'
  ) {
    return 'help'
  }
  if (command === 'sync-photos' || command === 'redeploy') {
    return 'special'
  }
  if (command === 'dev') {
    return 'dev'
  }
  return 'docker-compose'
}

// Handle special commands (sync-photos, redeploy)
export async function handleSpecialCommand(
  parsed: ParsedCommand,
): Promise<void> {
  // Handle help requests for special commands
  if (parsed.flags.help || parsed.flags.h) {
    if (parsed.command === 'sync-photos') {
      console.log(`Usage: lilnas sync-photos --email <email> --dest <destination>

Sync iCloud photos to local directory

Options:
  --email <email>      iCloud email address
  --dest <destination> Local destination directory
  --help, -h           Show this help message`)
      return
    }

    if (parsed.command === 'redeploy') {
      console.log(`Usage: lilnas redeploy [services...] [options]

Redeploy services with optional base image rebuild

Arguments:
  services             Service names to redeploy (optional)

Options:
  --all                Remove all images vs local images
  --rebuild-base       Rebuild base images before redeploying
  --help, -h           Show this help message`)
      return
    }
  }

  if (parsed.command === 'sync-photos') {
    // Convert to legacy format expected by syncPhotos
    const legacyArgs = {
      dest: parsed.flags.dest as string,
      email: parsed.flags.email as string,
    }
    return syncPhotos(legacyArgs)
  }

  if (parsed.command === 'redeploy') {
    // Convert to legacy format expected by redeploy
    const legacyArgs = {
      all: parsed.flags.all as boolean,
      services: parsed.args, // parseArgs already filters out flags
      'rebuild-base': parsed.flags['rebuild-base'] as boolean,
    }
    return redeploy(legacyArgs)
  }
}

// Forward commands to docker-compose
export async function forwardToDockerCompose(
  parsed: ParsedCommand,
): Promise<void> {
  if (!parsed.command) {
    console.error('Error: No command provided')
    process.exit(1)
  }

  // Need to reconstruct flags for docker-compose
  const flagArgs = Object.entries(parsed.flags).flatMap(([key, value]) => {
    if (value === true) {
      // Use single dash for single character flags, double dash for longer flags
      const prefix = key.length === 1 ? '-' : '--'
      return [`${prefix}${key}`]
    }
    if (value === false || value === undefined) return []
    // Use single dash for single character flags, double dash for longer flags
    const prefix = key.length === 1 ? '-' : '--'
    return [`${prefix}${key}`, String(value)]
  })

  const cmd = [
    'docker-compose',
    '-f',
    'docker-compose.yml',
    parsed.command,
    ...parsed.args,
    ...flagArgs,
  ].filter(Boolean) // Remove any undefined/empty values

  return runInteractive(cmd.join(' '))
}

// Handle dev commands
export async function handleDevCommand(parsed: ParsedCommand): Promise<void> {
  // Handle help requests for dev commands
  if (!parsed.subCommand || parsed.flags.help || parsed.flags.h) {
    // Convert to legacy format for help display
    const legacyArgs = {
      ...parsed.flags,
      command: parsed.subCommand,
      help: parsed.flags.help || parsed.flags.h,
      h: parsed.flags.h,
    }
    return dev(legacyArgs)
  }

  // Handle custom lilnas dev commands
  const customCommands = ['redeploy', 'ls', 'ps', 'shell', 'sync-deps']
  if (customCommands.includes(parsed.subCommand)) {
    // Convert to legacy format for custom commands
    const legacyArgs = {
      ...parsed.flags,
      command: parsed.subCommand,
      _: [
        'dev',
        parsed.subCommand,
        ...parsed.args, // parseArgs already filters out flags
      ],
    }
    return dev(legacyArgs)
  }

  // Forward all other commands directly to docker-compose with dev file
  // Need to reconstruct flags for docker-compose
  const flagArgs = Object.entries(parsed.flags).flatMap(([key, value]) => {
    if (value === true) {
      // Use single dash for single character flags, double dash for longer flags
      const prefix = key.length === 1 ? '-' : '--'
      return [`${prefix}${key}`]
    }
    if (value === false || value === undefined) return []
    // Use single dash for single character flags, double dash for longer flags
    const prefix = key.length === 1 ? '-' : '--'
    return [`${prefix}${key}`, String(value)]
  })

  const cmd = [
    'docker-compose',
    '-f',
    'docker-compose.dev.yml',
    parsed.subCommand,
    ...parsed.args,
    ...flagArgs,
  ].filter(Boolean)

  return runInteractive(cmd.join(' '))
}

// Helper functions for help system
function createCustomCommandsSection(): string {
  return `
lilnas Custom Commands:
  sync-photos     Sync iCloud photos to local directory
  redeploy        Redeploy services with optional base image rebuild
  dev COMMAND     Run docker-compose commands against dev environment
                  (includes: dev redeploy with same options as redeploy)

`
}

function integrateCustomHelp(
  dockerComposeHelp: string,
  customSection: string,
): string {
  // Insert custom section before "Commands:" section, similar to dev.ts pattern
  let helpWithCustomCommands = dockerComposeHelp.replace(
    /(Commands:)/,
    `${customSection}Docker Compose $1`,
  )

  // Replace docker-compose references with lilnas
  helpWithCustomCommands = helpWithCustomCommands
    .replace(/Usage:\s+docker(?:-|\s)compose/g, 'Usage:  lilnas')
    .replace(/docker(?:-|\s)compose/g, 'lilnas')
    .replace(
      /Run 'docker(?:-|\s)compose COMMAND --help'/g,
      "Run 'lilnas COMMAND --help'",
    )

  return helpWithCustomCommands
}

// Handle command-specific help forwarding
export async function showCommandHelp(
  command: string,
  args: string[],
): Promise<void> {
  try {
    let cmd: string[]
    let replacementPattern: string

    if (command === 'dev' && args[0] && args[0] !== '--help') {
      // Handle dev subcommand help: lilnas dev up --help
      cmd = [
        'docker-compose',
        '-f',
        'docker-compose.dev.yml',
        args[0],
        '--help',
      ]
      replacementPattern = 'lilnas dev'
    } else if (command === 'dev') {
      // Handle dev general help: lilnas dev --help (already implemented in dev.ts)
      return handleDevCommand({
        command: 'dev',
        subCommand: undefined,
        args: ['--help'],
        flags: { help: true },
      })
    } else {
      // Handle production command help: lilnas up --help
      cmd = ['docker-compose', command, '--help']
      replacementPattern = 'lilnas'
    }

    const output = execSync(cmd.join(' '), { encoding: 'utf8' })
    // Replace both "docker-compose" and "docker compose" references
    const modifiedOutput = output
      .replace(/docker-compose/g, replacementPattern)
      .replace(/docker compose/g, replacementPattern)
    console.log(modifiedOutput)
  } catch (error) {
    // Forward error from docker-compose (e.g., invalid command)
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

// Show help information
export async function showHelp(parsed?: ParsedCommand): Promise<void> {
  // Check if this is command-specific help
  if (parsed?.command && parsed.command !== 'help') {
    // For dev commands, include subCommand in args if present
    const args =
      parsed.command === 'dev' && parsed.subCommand
        ? [parsed.subCommand, ...parsed.args]
        : parsed.args
    return showCommandHelp(parsed.command, args)
  }

  try {
    // Fetch live docker-compose help
    const dockerComposeHelp = execSync('docker-compose --help', {
      encoding: 'utf8',
    })

    const customSection = createCustomCommandsSection()
    const integratedHelp = integrateCustomHelp(dockerComposeHelp, customSection)
    console.log(integratedHelp)
  } catch {
    // Fallback to basic help if docker-compose unavailable
    console.log('lilnas: Docker Compose CLI wrapper with custom commands')
    console.log('')
    console.log('Custom Commands:')
    console.log('  sync-photos     Sync iCloud photos to local directory')
    console.log(
      '  redeploy        Redeploy services with optional base image rebuild',
    )
    console.log(
      '  dev COMMAND     Run docker-compose commands against dev environment',
    )
    console.log('')
    console.log('Run with --help on individual commands for more information')
    console.log('Note: docker-compose must be installed for full functionality')
  }
}

// Main dispatcher function
export async function dispatch(parsed: ParsedCommand): Promise<void> {
  const commandType = categorizeCommand(parsed.command)

  // Handle help flags based on command type
  if (parsed.flags.help || parsed.flags.h) {
    // Special commands and dev commands handle their own help
    if (commandType === 'special' || commandType === 'dev') {
      // Let the specific handlers deal with help
    } else {
      // For help and docker-compose commands, use integrated help system
      return showHelp(parsed)
    }
  }

  switch (commandType) {
    case 'help':
      return showHelp(parsed)
    case 'special':
      return handleSpecialCommand(parsed)
    case 'dev':
      return handleDevCommand(parsed)
    case 'docker-compose':
      return forwardToDockerCompose(parsed)
  }
}

// New main function using dispatcher
async function main() {
  const parsed = parseArgs(process.argv.slice(2))
  return dispatch(parsed)
}

if (require.main === module) {
  main()
}

export { main }
