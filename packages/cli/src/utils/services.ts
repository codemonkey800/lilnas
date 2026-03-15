import { spawnSync } from 'child_process'
import * as fs from 'fs'
import yaml from 'js-yaml'
import * as path from 'path'

import { resolveDockerComposeCmd } from './docker'

/**
 * Returns the list of Docker Compose services defined in the given compose file.
 */
function getServicesFromFile(composeFile: string): string[] {
  if (!fs.existsSync(composeFile)) {
    return []
  }
  const cmd = resolveDockerComposeCmd()
  if (!cmd) return []

  const [bin, ...baseArgs] = cmd
  const result = spawnSync(
    bin,
    [...baseArgs, '-f', composeFile, 'config', '--services'],
    {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  )

  if (result.status !== 0 || !result.stdout) return []

  return result.stdout
    .trim()
    .split('\n')
    .filter(s => s.length > 0)
}

/**
 * Lists services from all app deploy files (apps/*\/deploy.yml).
 */
export function listAppServices(root: string): string[] {
  const appsDir = path.join(root, 'apps')
  if (!fs.existsSync(appsDir)) {
    throw new Error(`Apps directory not found: ${appsDir}`)
  }

  const services: string[] = []
  for (const entry of fs.readdirSync(appsDir)) {
    const deployFile = path.join(appsDir, entry, 'deploy.yml')
    if (fs.existsSync(deployFile)) {
      services.push(...getServicesFromFile(deployFile))
    }
  }
  return services
}

interface ComposeDoc {
  include?: (string | { path: string })[]
}

function isComposeDoc(doc: unknown): doc is ComposeDoc {
  return typeof doc === 'object' && doc !== null && 'include' in doc
}

function resolveIncludePath(entry: unknown): string | null {
  if (typeof entry === 'string') return entry
  if (
    typeof entry === 'object' &&
    entry !== null &&
    'path' in entry &&
    typeof (entry as { path: unknown }).path === 'string'
  ) {
    return (entry as { path: string }).path
  }
  return null
}

/**
 * Lists services from infra compose files that are included in docker-compose.yml.
 * Parses the `include:` block using js-yaml to find which infra/*.yml files are referenced.
 */
export function listInfraServices(root: string): string[] {
  const composeFile = path.join(root, 'docker-compose.yml')
  if (!fs.existsSync(composeFile)) {
    throw new Error(`docker-compose.yml not found: ${composeFile}`)
  }

  const content = fs.readFileSync(composeFile, 'utf8')
  const doc = yaml.load(content)

  if (!isComposeDoc(doc) || !Array.isArray(doc.include)) {
    return []
  }

  const services: string[] = []
  for (const entry of doc.include) {
    const filePath = resolveIncludePath(entry)
    if (filePath && /\/infra\/[^/]+\.yml$/.test(filePath)) {
      services.push(...getServicesFromFile(path.resolve(root, filePath)))
    }
  }
  return services
}
