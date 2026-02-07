import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import yaml from 'js-yaml'

export type ServiceMode = 'prod' | 'dev'

export type ServiceType = 'app' | 'service' | 'tool'

export interface ServiceInfo {
  name: string
  type: ServiceType
  image?: string
  domain?: string
  port?: number
}

interface ComposeFile {
  services?: Record<string, ComposeServiceDef>
  include?: string[]
}

interface ComposeServiceDef {
  image?: string
  build?: string | { context?: string; dockerfile?: string }
  labels?: string[] | Record<string, string>
  extends?: { file?: string; service?: string }
  profiles?: string[]
}

export function getMonorepoRoot(): string {
  // From dist/services/discovery.js → 4 levels up to monorepo root
  const thisDir = dirname(fileURLToPath(import.meta.url))
  const root = join(thisDir, '..', '..', '..', '..')

  if (!existsSync(join(root, 'docker-compose.yml'))) {
    throw new Error(
      `Could not resolve monorepo root (expected docker-compose.yml at ${root})`,
    )
  }

  return root
}

export function getComposeFile(mode: ServiceMode = 'prod'): string {
  return mode === 'dev' ? 'docker-compose.dev.yml' : 'docker-compose.yml'
}

function getDeployFile(mode: ServiceMode = 'prod'): string {
  return mode === 'dev' ? 'deploy.dev.yml' : 'deploy.yml'
}

function parseComposeServices(filePath: string): string[] {
  if (!existsSync(filePath)) return []

  const content = readFileSync(filePath, 'utf-8')
  const parsed = yaml.load(content) as ComposeFile | null

  if (!parsed?.services) return []

  return Object.keys(parsed.services)
}

export function discoverAppServices(mode: ServiceMode = 'prod'): string[] {
  const root = getMonorepoRoot()
  const packagesDir = join(root, 'packages')
  const deployFile = getDeployFile(mode)

  const entries = readdirSync(packagesDir, { withFileTypes: true })

  return entries
    .filter(entry => entry.isDirectory())
    .flatMap(entry => {
      const deployPath = join(packagesDir, entry.name, deployFile)
      return parseComposeServices(deployPath)
    })
    .sort()
}

export function discoverInfraServices(mode: ServiceMode = 'prod'): string[] {
  const root = getMonorepoRoot()
  const composeFile = getComposeFile(mode)
  const composeContent = readFileSync(join(root, composeFile), 'utf-8')
  const parsed = yaml.load(composeContent) as ComposeFile | null
  const includes = parsed?.include ?? []

  return includes
    .filter(include => include.startsWith('./infra/'))
    .flatMap(include => parseComposeServices(join(root, include)))
    .sort()
}

export function discoverAllServices(mode: ServiceMode = 'prod'): string[] {
  return [...discoverAppServices(mode), ...discoverInfraServices(mode)].sort()
}

// --- Rich discovery (ServiceInfo[]) ---

function normalizeLabels(
  labels: string[] | Record<string, string> | undefined,
): string[] {
  if (!labels) return []
  if (Array.isArray(labels)) return labels
  return Object.entries(labels).map(([k, v]) => `${k}=${v}`)
}

function extractDomain(labels: string[]): string | undefined {
  for (const label of labels) {
    const match = label.match(
      /^traefik\.http\.routers\.[^.]+\.rule=Host\(`([^`]+)`\)$/,
    )
    if (match) return match[1]
  }

  return undefined
}

function extractPort(labels: string[]): number | undefined {
  for (const label of labels) {
    const match = label.match(
      /^traefik\.http\.services\.[^.]+\.loadbalancer\.server\.port=(\d+)$/,
    )
    if (match) return Number(match[1])
  }

  return undefined
}

function resolveImage(def: ComposeServiceDef): string | undefined {
  if (def.image) return def.image
  if (def.build) return 'build'
  if (def.extends) return undefined // inherits from base; treat as build
  return undefined
}

function isTool(def: ComposeServiceDef): boolean {
  return def.profiles?.includes('tools') ?? false
}

function parseComposeServiceDetails(
  filePath: string,
  baseType: 'app' | 'service',
): ServiceInfo[] {
  if (!existsSync(filePath)) return []

  const content = readFileSync(filePath, 'utf-8')
  const parsed = yaml.load(content) as ComposeFile | null

  if (!parsed?.services) return []

  return Object.entries(parsed.services).map(([name, def]) => {
    const labels = normalizeLabels(def.labels)
    return {
      name,
      type: isTool(def) ? 'tool' : baseType,
      image: resolveImage(def),
      domain: extractDomain(labels),
      port: extractPort(labels),
    }
  })
}

export function discoverAppServiceDetails(
  mode: ServiceMode = 'prod',
): ServiceInfo[] {
  const root = getMonorepoRoot()
  const packagesDir = join(root, 'packages')
  const deployFile = getDeployFile(mode)

  const entries = readdirSync(packagesDir, { withFileTypes: true })

  return entries
    .filter(entry => entry.isDirectory())
    .flatMap(entry => {
      const deployPath = join(packagesDir, entry.name, deployFile)
      return parseComposeServiceDetails(deployPath, 'app')
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function discoverInfraServiceDetails(
  mode: ServiceMode = 'prod',
): ServiceInfo[] {
  const root = getMonorepoRoot()
  const composeFile = getComposeFile(mode)
  const composeContent = readFileSync(join(root, composeFile), 'utf-8')
  const parsed = yaml.load(composeContent) as ComposeFile | null
  const includes = parsed?.include ?? []

  return includes
    .filter(include => include.startsWith('./infra/'))
    .flatMap(include =>
      parseComposeServiceDetails(join(root, include), 'service'),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function discoverAllServiceDetails(
  mode: ServiceMode = 'prod',
): ServiceInfo[] {
  return [
    ...discoverAppServiceDetails(mode),
    ...discoverInfraServiceDetails(mode),
  ].sort((a, b) => a.name.localeCompare(b.name))
}
