import { execSync } from 'child_process'
import * as path from 'path'
import { z } from 'zod'

import {
  extractFlags,
  getDockerImages,
  getRepoDir,
  getServices,
  runDockerCompose,
  runInteractive,
} from 'src/utils'

const DevOptionsSchema = z
  .object({
    all: z.boolean().optional(),
    command: z.string().optional(),
    filter: z.string().optional(),
    quiet: z.boolean().optional(),
    services: z.union([z.string().array(), z.boolean()]).optional(),
    shell: z.boolean().optional(),
    shellCommand: z.string().optional(),
    help: z.boolean().optional(),
    h: z.boolean().optional(),
    _: z.array(z.string()).optional(),
  })
  .passthrough()

type DevOptions = z.infer<typeof DevOptionsSchema>
type Handler = (options: DevOptions) => Promise<void>

const DEV_IMAGE = 'lilnas-dev'
const DEV_COMPOSE = 'docker-compose.dev.yml'

async function runCompose(command: string) {
  runDockerCompose(command, DEV_COMPOSE)
}

async function list() {
  const services = await getServices({ dev: true })
  console.log(services.join('\n'))
}

interface ContainerInfo {
  ID: string
  Name: string
  Image: string
  Service: string
  State: string
  Status: string
  Publishers?: Array<{
    URL: string
    TargetPort: number
    PublishedPort: number
    Protocol: string
  }>
}

async function ps(options: DevOptions) {
  // If user wants quiet mode, use original behavior
  if (options.quiet) {
    const command = [
      'ps',
      '-q',
      ...(options.all ? ['-a'] : []),
      ...(options.filter ? [`--filter=${options.filter}`] : []),
      ...(Array.isArray(options.services) ? options.services : []),
    ].join(' ')
    runCompose(command)
    return
  }

  // Get container info as JSON
  const command = [
    'ps',
    '--format=json',
    ...(options.all ? ['-a'] : []),
    ...(options.filter ? [`--filter=${options.filter}`] : []),
    ...(Array.isArray(options.services) ? options.services : []),
  ].join(' ')

  try {
    const output = execSync(`docker-compose -f ${DEV_COMPOSE} ${command}`, {
      encoding: 'utf8',
    })

    if (!output.trim()) {
      console.log('No containers found')
      return
    }

    // Parse multiple JSON objects (one per line)
    const containers: ContainerInfo[] = output
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line))

    if (containers.length === 0) {
      console.log('No containers found')
      return
    }

    // Format output
    console.log('SERVICE'.padEnd(18) + 'IMAGE'.padEnd(28) + 'STATUS')
    console.log('-------'.padEnd(18) + '-----'.padEnd(28) + '------')

    containers.forEach(container => {
      const service = container.Service.padEnd(18)
      // Truncate image name if longer than 25 characters
      const imageName =
        container.Image.length > 25
          ? container.Image.substring(0, 22) + '...'
          : container.Image
      const image = imageName.padEnd(28)
      const status = container.Status
      console.log(`${service}${image}${status}`)
    })
  } catch (error) {
    console.error(
      'Error getting container status:',
      error instanceof Error ? error.message : error,
    )
  }
}

async function maybeBuildDevImage() {
  const images = await getDockerImages()

  if (!images.some(image => image === `${DEV_IMAGE}:latest`)) {
    runInteractive(`docker build --rm -t ${DEV_IMAGE} -f Dockerfile.dev .`)
  }
}

async function shell(options: DevOptions) {
  const repoDir = await getRepoDir()
  const command = [
    'docker run',
    '--rm -it',
    '-w /source',
    `-v ${repoDir}:/source`,
    `${DEV_IMAGE}${options.shellCommand ? ` -c "${options.shellCommand}"` : ''}`,
  ].join(' ')

  await maybeBuildDevImage()
  runInteractive(command)
}

async function syncDeps(options: DevOptions) {
  await maybeBuildDevImage()
  shell({ ...options, shellCommand: 'pnpm i' })
}

async function showCustomHelp() {
  try {
    // Get docker-compose help output
    const dockerComposeHelp = execSync('docker-compose -h', {
      encoding: 'utf8',
    })

    // Replace docker-compose references with lilnas dev
    const modifiedHelp = dockerComposeHelp
      .replace(/Usage:\s+docker compose/g, 'Usage:  lilnas dev')
      .replace(/docker compose/g, 'lilnas dev')
      .replace(
        /Run 'docker compose COMMAND --help'/g,
        "Run 'lilnas dev COMMAND --help'",
      )

    // Add custom lilnas dev commands section
    const customCommands = `
lilnas Custom Commands:
  ls          List all apps with dev mode
  ps          Show status of services
  shell       Start a shell within the container
  sync-deps   Synchronize npm dependencies from within the dev environment

`

    // Insert custom commands before the general docker-compose commands
    let helpWithCustomCommands = modifiedHelp.replace(
      /(Management Commands:[\s\S]*?\n\n)(Commands:)/,
      `$1${customCommands}Docker Compose $2`,
    )

    // Remove ps command from Docker Compose commands since we have a custom implementation
    helpWithCustomCommands = helpWithCustomCommands.replace(
      /^\s*ps\s+List containers\s*$/m,
      '',
    )

    console.log(helpWithCustomCommands)
  } catch (error) {
    console.error('Error displaying help:', error)
  }
}

const HANDLER_MAP: Record<string, Handler> = {
  ps,
  shell,
  ls: list,
  'sync-deps': syncDeps,
}

export async function dev(rawOptions: unknown) {
  const options = DevOptionsSchema.parse(rawOptions)

  // Handle help flags when no command is provided
  if ((options.help || options.h) && !options.command) {
    await showCustomHelp()
    return
  }

  // Handle explicit help command
  if (options.command === 'help' || !options.command) {
    await showCustomHelp()
    return
  }

  // Handle custom lilnas dev commands
  const handler = HANDLER_MAP[options.command]
  if (handler) {
    await handler(options)
    return
  }

  // All other commands are now handled by direct forwarding in main.ts
  // This should not be reached in the new architecture
  console.error(`Error: Unknown dev command '${options.command}'`)
  console.error('Run "lilnas dev --help" to see available commands')
  process.exit(1)
}

export async function devRedeploy(args: string[]): Promise<void> {
  // Parse flags: --all, --rebuild-base and extract service names
  const flags = extractFlags(args)
  const services = args.filter(arg => !arg.startsWith('-'))

  const all = flags.all as boolean
  const rebuildBase = flags['rebuild-base'] as boolean

  // Handle help request
  if (flags.help || flags.h) {
    console.log(`Usage: lilnas dev redeploy [services...] [options]

Redeploy services in development environment with optional base image rebuild

Arguments:
  services             Service names to redeploy (optional)

Options:
  --all                Remove all images vs local images
  --rebuild-base       Rebuild base images before redeploying
  --help, -h           Show this help message`)
    return
  }

  // Rebuild base images if requested (reuse logic from redeploy.ts)
  if (rebuildBase) {
    console.log('Rebuilding base images...')
    const scriptPath = path.join(
      __dirname,
      '..',
      '..',
      '..',
      '..',
      'infra',
      'base-images',
      'build-base-images.sh',
    )
    runInteractive(scriptPath)
  }

  // Docker down with dev compose file
  const imageType = all ? 'all' : 'local'
  runInteractive(
    `docker-compose -f docker-compose.dev.yml down --rmi ${imageType} -v ${services.join(' ')}`,
  )

  // Docker up with dev compose file
  runInteractive(
    `docker-compose -f docker-compose.dev.yml up -d ${services.join(' ')}`,
  )
}
