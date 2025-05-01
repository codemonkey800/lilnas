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
  const serviceFiles = await $`fd .yml ${repoDir}/infra`
  return serviceFiles.stdout
    .split('\n')
    .filter(Boolean)
    .filter(file => file.includes('.dev.yml') === dev)
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
