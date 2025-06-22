import { z } from 'zod'

import {
  getDockerImages,
  getRepoDir,
  getServices,
  runInteractive,
} from 'src/utils'
import { execSync } from 'child_process'

const DevOptionsSchema = z.object({
  all: z.boolean().optional(),
  command: z.enum(['build', 'down', 'ls', 'logs', 'ps', 'up', 'shell', 'sync-deps']),
  detach: z.boolean().optional(),
  filter: z.string().optional(),
  follow: z.boolean().optional(),
  quiet: z.boolean().optional(),
  services: z.string().array().optional(),
  shell: z.boolean().optional(),
  shellCommand: z.string().optional(),
})

type DevOptions = z.infer<typeof DevOptionsSchema>
type Handler = (options: DevOptions) => Promise<void>

const DEV_IMAGE = 'lilnas-dev'
const DEV_COMPOSE = 'docker-compose.dev.yml'

async function runCompose(command: string) {
  runInteractive(`docker-compose -f ${DEV_COMPOSE} ${command}`)
}

async function build() {
  runInteractive(`docker build --rm -t ${DEV_IMAGE} -f Dockerfile.dev .`)
  runCompose('build')
}

async function down(options: DevOptions) {
  const command = [
    'down',
    `--rmi ${options.all ? 'all' : 'local'}`,
    ...(options.services ?? []),
  ].join(' ')

  runCompose(command)
}

async function list() {
  const services = await getServices({ dev: true })
  console.log(services.join('\n'))
}

async function logs(options: DevOptions) {
  const command = [
    'logs',
    ...(options.follow ? ['-f'] : []),
    ...(options.services ?? []),
  ].join(' ')

  runCompose(command)
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
      ...(options.services ?? []),
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
    ...(options.services ?? []),
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
      const imageName = container.Image.length > 25 
        ? container.Image.substring(0, 22) + '...'
        : container.Image
      const image = imageName.padEnd(28)
      const status = container.Status
      console.log(`${service}${image}${status}`)
    })
  } catch (error) {
    console.error('Error getting container status:', error instanceof Error ? error.message : error)
  }
}

async function maybeBuildDevImage() {
  const images = await getDockerImages()

  if (!images.some(image => image === `${DEV_IMAGE}:latest`)) {
    await build()
  }
}

async function up(options: DevOptions) {
  const command = [
    'up',
    ...(options.detach ? ['-d'] : []),
    ...(options.services ?? []),
  ].join(' ')

  await maybeBuildDevImage()
  runCompose(command)
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

const HANDLER_MAP: Record<DevOptions['command'], Handler> = {
  build,
  down,
  logs,
  ps,
  shell,
  up,
  ls: list,
  'sync-deps': syncDeps,
}

export async function dev(rawOptions: unknown) {
  const options = DevOptionsSchema.parse(rawOptions)
  const handler = HANDLER_MAP[options.command]

  await handler(options)
}
