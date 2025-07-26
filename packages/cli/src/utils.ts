import { execSync, ExecSyncOptionsWithBufferEncoding } from 'child_process'
import * as yaml from 'yaml'
import { z } from 'zod'
import { $ } from 'zx'

export async function getRepoDir() {
  const output = await $`git rev-parse --show-toplevel`
  return output.stdout.trim()
}

async function getServiceFiles(dev: boolean) {
  const repoDir = await getRepoDir()

  // Get infrastructure service files
  const infraFiles = await $`fd .yml ${repoDir}/infra`
  const infraFileList = infraFiles.stdout
    .split('\n')
    .filter(Boolean)
    .filter(file => file.includes('.dev.yml') === dev)

  // Get package service files
  const packagePattern = dev ? 'deploy.dev.yml' : 'deploy.yml'
  const packageFiles = await $`fd ${packagePattern} ${repoDir}/packages`
  const packageFileList = packageFiles.stdout.split('\n').filter(Boolean)

  return [...infraFileList, ...packageFileList]
}

export async function getServices({ dev = false }: { dev?: boolean } = {}) {
  const serviceFiles = await getServiceFiles(dev)
  const services = new Set<string>()

  await Promise.all(
    serviceFiles.map(async file => {
      const content = await $`cat ${file}`
      const data = yaml.parse(content.stdout)

      if ('services' in data) {
        Object.keys(data.services).forEach(service => services.add(service))
      }
    }),
  )

  return Array.from(services).sort((a, b) => a.localeCompare(b))
}

export function runInteractive(
  command: string,
  options?: ExecSyncOptionsWithBufferEncoding,
) {
  execSync(command, { stdio: 'inherit', ...options })
}

export async function getDockerImages() {
  const imageNames = await $`docker images --format '{{.Repository}}:{{.Tag}}'`
  return imageNames.stdout.split('\n').filter(Boolean)
}

export const ServicesOptionSchema = z.object({
  services: z.array(z.string()),
})

export function runDockerCompose(
  command: string,
  file: string = 'docker-compose.yml',
) {
  runInteractive(`docker-compose -f ${file} ${command}`)
}

// Extract flags from arguments array
export function extractFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]

    if (arg.startsWith('--')) {
      if (arg.includes('=')) {
        // Handle --flag=value format
        const [key, value] = arg.substring(2).split('=', 2)
        flags[key] = value
      } else {
        // Handle --flag value format or boolean flags
        const key = arg.substring(2)
        const nextArg = args[i + 1]

        if (nextArg && !nextArg.startsWith('-')) {
          flags[key] = nextArg
          i++ // Skip next arg since we used it as value
        } else {
          flags[key] = true // Boolean flag
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // Handle short flags like -h, -a
      const key = arg.substring(1)
      flags[key] = true
    }
  }

  return flags
}
