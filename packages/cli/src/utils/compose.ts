import * as fs from 'fs'
import yaml from 'js-yaml'
import * as path from 'path'

import { getMonorepoRoot } from './paths'

export interface StorageMount {
  service: string
  hostPath: string
  containerPath: string
  readOnly: boolean
  source: string
}

interface ComposeService {
  volumes?: (string | { type?: string; source?: string; target?: string })[]
}

interface ComposeDoc {
  include?: (string | { path: string })[]
  services?: Record<string, ComposeService>
}

function isComposeDoc(doc: unknown): doc is ComposeDoc {
  return typeof doc === 'object' && doc !== null
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
 * Parses bind mount strings in the form "host:container[:opts]" and returns
 * the host path, container path, and whether the mount is read-only.
 * Returns null for named volumes (no leading slash on source).
 */
function parseBindMount(
  volume: string,
): { hostPath: string; containerPath: string; readOnly: boolean } | null {
  const parts = volume.split(':')
  const hostPath = parts[0]
  const containerPath = parts[1]

  if (!hostPath || !containerPath) return null

  const opts = parts[2] ?? ''

  // Named volumes don't start with / or ./
  if (!hostPath.startsWith('/') && !hostPath.startsWith('.')) return null

  return {
    hostPath,
    containerPath,
    readOnly: opts.split(',').includes('ro'),
  }
}

/**
 * Extracts /storage/ bind mounts from a single compose file.
 */
function extractMountsFromFile(filePath: string): StorageMount[] {
  if (!fs.existsSync(filePath)) return []

  const content = fs.readFileSync(filePath, 'utf8')
  const doc = yaml.load(content)

  if (!isComposeDoc(doc) || !doc.services) return []

  const sourceName = path.basename(filePath)
  const mounts: StorageMount[] = []

  for (const [service, svcDef] of Object.entries(doc.services)) {
    if (!svcDef?.volumes) continue

    for (const vol of svcDef.volumes) {
      if (typeof vol === 'string') {
        const parsed = parseBindMount(vol)
        if (parsed && parsed.hostPath.startsWith('/storage/')) {
          mounts.push({ service, source: sourceName, ...parsed })
        }
      } else if (typeof vol === 'object' && vol !== null) {
        // Long-form volume syntax
        const { type, source, target } = vol
        if (
          type === 'bind' &&
          typeof source === 'string' &&
          typeof target === 'string' &&
          source.startsWith('/storage/')
        ) {
          mounts.push({
            service,
            source: sourceName,
            hostPath: source,
            containerPath: target,
            readOnly: false,
          })
        }
      }
    }
  }

  return mounts
}

/**
 * Resolves all compose files included by docker-compose.yml (infra + apps).
 */
function resolveIncludedFiles(root: string): string[] {
  const mainCompose = path.join(root, 'docker-compose.yml')
  if (!fs.existsSync(mainCompose)) {
    throw new Error(`docker-compose.yml not found at: ${mainCompose}`)
  }

  const content = fs.readFileSync(mainCompose, 'utf8')
  const doc = yaml.load(content)

  if (!isComposeDoc(doc) || !Array.isArray(doc.include)) return []

  return doc.include
    .map(resolveIncludePath)
    .filter((p): p is string => p !== null)
    .map(p => path.resolve(root, p))
}

/**
 * Returns all /storage/ bind mounts across all compose files in the monorepo,
 * grouped by service with source compose file info.
 */
export function getStorageMounts(): StorageMount[] {
  const root = getMonorepoRoot()
  const files = resolveIncludedFiles(root)

  const mounts: StorageMount[] = []
  for (const file of files) {
    mounts.push(...extractMountsFromFile(file))
  }

  return mounts
}
