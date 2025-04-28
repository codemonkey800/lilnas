import { z } from 'zod'

import {
  getDockerImages,
  getRepoDir,
  getServices,
  runInteractive,
} from 'src/utils'

const DevOptionsSchema = z.object({
  all: z.boolean().optional(),
  command: z.enum(['build', 'down', 'ls', 'logs', 'up', 'shell', 'sync-deps']),
  detach: z.boolean().optional(),
  follow: z.boolean().optional(),
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
