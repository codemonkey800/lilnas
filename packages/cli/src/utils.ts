import { execSync, ExecSyncOptionsWithBufferEncoding } from 'child_process'
import * as fs from 'fs-extra'
import * as yaml from 'yaml'
import { z } from 'zod'
import { $ } from 'zx'

export async function getServicesWithDevMode() {
  const repoDir = await getRepoDir()
  const packages = await fs.readdir(`${repoDir}/packages`)
  const packagesWithDevMode: string[] = []

  for (const pkg of packages) {
    const packageJson = JSON.parse(
      await fs.readFile(`${repoDir}/packages/${pkg}/package.json`, 'utf-8'),
    )

    if (packageJson?.scripts?.dev) {
      packagesWithDevMode.push(pkg)
    }
  }

  return packagesWithDevMode
}

export async function getRepoDir() {
  const output = await $`git rev-parse --show-toplevel`
  return output.stdout.trim()
}

async function getServiceFiles() {
  const repoDir = await getRepoDir()
  const serviceFiles = await $`fd .yml ${repoDir}/infra`
  return serviceFiles.stdout.split('\n').filter(Boolean)
}

export async function getServices() {
  const serviceFiles = await getServiceFiles()
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

export const StringArraySchema = z.array(z.string())

export async function getDockerImages() {
  const imageNames = await $`docker images --format '{{.Repository}}:{{.Tag}}'`
  return imageNames.stdout.split('\n').filter(Boolean)
}
