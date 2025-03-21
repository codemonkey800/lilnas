import { execSync } from 'child_process'
import * as yaml from 'yaml'
import { $ } from 'zx'

export async function getCurrentAppName() {
  const pwd = await $`pwd`
  console.log(pwd)
  return 'breh'
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

export function runInteractive(command: string) {
  execSync(command, { stdio: 'inherit' })
}
