import * as fs from 'fs-extra'
import * as yaml from 'yaml'
import { z } from 'zod'

import { getDockerImages, getRepoDir, runInteractive } from 'src/utils'

const DevOptionsSchema = z.object({
  command: z.enum(['build', 'down', 'ls', 'logs', 'up', 'shell', 'sync-deps']),
  detach: z.boolean().optional(),
  follow: z.boolean().optional(),
  port: z.number().optional(),
  service: z.string().optional(),
  shell: z.boolean().optional(),
})

type DevOptions = z.infer<typeof DevOptionsSchema>
type Handler = (options: DevOptions) => Promise<void>

async function build() {
  runInteractive('docker-compose build dev')
}

async function down() {
  runInteractive('docker-compose down --rmi all -v dev')
}

async function list() {
  const packages = await fs.readdir('packages')
  const packagesWithDevMode: string[] = []

  for (const pkg of packages) {
    const packageJson = JSON.parse(
      await fs.readFile(`packages/${pkg}/package.json`, 'utf-8'),
    )

    if (packageJson?.scripts?.dev) {
      packagesWithDevMode.push(pkg)
    }
  }

  console.log(packagesWithDevMode)
}

async function logs(options: DevOptions) {
  const command = [
    'docker-compose logs',
    ...(options.follow ? ['-f'] : []),
    'dev',
  ].join(' ')

  runInteractive(command)
}

async function up(options: DevOptions) {
  const command = [
    'docker-compose up',
    ...(options.detach ? ['-d'] : []),
    'dev',
  ].join(' ')

  runInteractive(command)
}

async function shell() {
  const repoDir = await getRepoDir()
  runInteractive(`docker run --rm -it -v ${repoDir}:/source lilnas-dev`)
}

async function syncDeps() {
  const images = await getDockerImages()
  const imageName = 'lilnas-dev'

  if (!images.some(image => image.includes(imageName))) {
    await build()
  }

  const repoDir = await getRepoDir()
  runInteractive(
    `docker run --rm -it -v ${repoDir}:/source ${imageName} -c "cd /source && pnpm i"`,
  )
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

interface DockerComposeYaml {
  include: string[]
}

const DEV_INFRA_FILE = 'infra/dev.yml'
const DEV_INFRA_LINE = `./${DEV_INFRA_FILE}`

async function toggleDevInfra(
  enable: boolean,
  service = 'tdr-bot',
  port = 8080,
) {
  const repoDir = await getRepoDir()
  const dockerComposeFile = `${repoDir}/docker-compose.yml`
  const dockerComposeData = await fs.readFile(dockerComposeFile, 'utf-8')

  const { include: serviceList } = yaml.parse(
    dockerComposeData,
  ) as DockerComposeYaml

  const nextComposeData: DockerComposeYaml = {
    include: serviceList
      .filter(line => line !== DEV_INFRA_LINE)
      .concat(enable ? [DEV_INFRA_LINE] : []),
  }

  await fs.writeFile(dockerComposeFile, yaml.stringify(nextComposeData))
  console.log(
    `${enable ? 'Added' : 'Removed'} dev infra ${enable ? 'to' : 'from'} docker-compose.yaml`,
  )

  const devInfraFile = `${repoDir}/${DEV_INFRA_FILE}`
  const envFile = `${repoDir}/infra/.env.${service}`

  if (enable) {
    const envFileExists = await fs.pathExists(envFile)
    const infraData = {
      services: {
        dev: {
          command: `-c "cd /source/packages/${service} && pnpm dev"`,
          env_file: envFileExists ? [envFile] : [],
          ports: [`${port}:${port}`],

          build: {
            context: '../',
            dockerfile: 'Dockerfile.dev',
          },

          volumes: [
            '../:/source',
            '/var/run/docker.sock:/var/run/docker.sock:ro',
            `${process.env.HOME}/Library/pnpm:/pnpm`,
          ],
        },
      },
    }

    await fs.writeFile(devInfraFile, yaml.stringify(infraData))
    console.log(`Added ${devInfraFile}`)
  } else {
    await fs.remove(devInfraFile)
    console.log(`Removed ${devInfraFile}`)
  }
}

export async function dev(rawOptions: unknown) {
  const options = DevOptionsSchema.parse(rawOptions)
  const handler = HANDLER_MAP[options.command]

  await toggleDevInfra(true, options.service, options.port)
  await handler(options)
  await toggleDevInfra(false)
}
