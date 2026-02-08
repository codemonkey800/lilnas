import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import {
  discoverAppServices,
  getMonorepoRoot,
  type ServiceMode,
} from 'src/services/discovery.js'

export const IMAGE_NAME = 'lilnas-dev'
const NODE_MODULES_VOLUME_SUFFIX = 'node_modules'

const BASE_IMAGES = [
  'lilnas-node-base',
  'lilnas-monorepo-builder',
  'lilnas-node-runtime',
  'lilnas-nextjs-runtime',
]

export function computeLockfileHash(root: string): string {
  const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'))
  return createHash('sha256').update(lockfile).digest('hex')
}

export function getImageLockfileHash(imageName: string): string | null {
  try {
    const hash = execSync(
      `docker image inspect ${imageName} --format '{{index .Config.Labels "lockfile.hash"}}'`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] },
    ).trim()
    return hash || null
  } catch {
    return null
  }
}

function imageExists(name: string): boolean {
  try {
    execSync(`docker image inspect ${name}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function targetsIncludeApps(mode: ServiceMode, targets: string[]): boolean {
  if (targets.length === 0) return true

  const appServices = discoverAppServices(mode)
  return targets.some(t => appServices.includes(t))
}

export function ensureDockerImages(
  mode: ServiceMode,
  targets: string[],
  log: (msg: string) => void,
  verbose: (msg: string) => void = () => {},
): void {
  const root = getMonorepoRoot()

  // Check base images
  for (const img of BASE_IMAGES) {
    const exists = imageExists(img)
    verbose(`Checking base image: ${img} -> ${exists ? 'exists' : 'missing'}`)
  }

  const missingBase = BASE_IMAGES.filter(img => !imageExists(img))
  if (missingBase.length > 0) {
    log(
      `Missing base images: ${missingBase.join(', ')}. Building base images...`,
    )
    execSync('./infra/base-images/build-base-images.sh', {
      cwd: root,
      stdio: 'inherit',
    })
  } else {
    verbose('All base images present')
  }

  // In dev mode, check lilnas-dev if targets include app services
  const includesApps = targetsIncludeApps(mode, targets)
  verbose(`Targets include app services: ${String(includesApps)}`)

  if (mode === 'dev' && includesApps) {
    const currentHash = computeLockfileHash(root)
    const imageHash = getImageLockfileHash(IMAGE_NAME)
    verbose(`Current lockfile hash: ${currentHash}`)
    verbose(`Image lockfile hash: ${imageHash ?? 'none'}`)

    if (!imageHash || imageHash !== currentHash) {
      const reason = imageHash
        ? 'lockfile hash mismatch (dependencies changed)'
        : `missing ${IMAGE_NAME} image`
      verbose(`Rebuild needed: ${reason}`)
      log(
        imageHash
          ? `${IMAGE_NAME} lockfile hash mismatch (dependencies changed). Rebuilding...`
          : `Missing ${IMAGE_NAME} image. Building...`,
      )
      execSync(
        `docker build -f Dockerfile.dev -t ${IMAGE_NAME} --label "lockfile.hash=${currentHash}" .`,
        { cwd: root, stdio: 'inherit' },
      )

      // Remove the stale node_modules Docker volume so it gets repopulated
      // from the fresh image. The volume caches pnpm's .pnpm store, and
      // when the lockfile changes the dependency hashes change too, causing
      // symlinks in packages/*/node_modules/ to point to non-existent paths.
      const projectName = basename(root)
      const volumeName = `${projectName}_${NODE_MODULES_VOLUME_SUFFIX}`
      verbose(`Removing stale volume: ${volumeName}`)
      try {
        execSync(`docker volume rm ${volumeName}`, {
          stdio: ['pipe', 'pipe', 'ignore'],
        })
        log(`Removed stale ${volumeName} volume`)
      } catch {
        verbose(`Volume ${volumeName} not found or in use, skipping removal`)
      }
    } else {
      verbose('Lockfile hashes match, no rebuild needed')
    }
  }
}
