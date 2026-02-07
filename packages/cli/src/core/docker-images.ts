import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  discoverAppServices,
  getMonorepoRoot,
  type ServiceMode,
} from 'src/services/discovery.js'

export const IMAGE_NAME = 'lilnas-dev'

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
): void {
  const root = getMonorepoRoot()

  // Check base images
  const missingBase = BASE_IMAGES.filter(img => !imageExists(img))
  if (missingBase.length > 0) {
    log(
      `Missing base images: ${missingBase.join(', ')}. Building base images...`,
    )
    execSync('./infra/base-images/build-base-images.sh', {
      cwd: root,
      stdio: 'inherit',
    })
  }

  // In dev mode, check lilnas-dev if targets include app services
  if (mode === 'dev' && targetsIncludeApps(mode, targets)) {
    const currentHash = computeLockfileHash(root)
    const imageHash = getImageLockfileHash(IMAGE_NAME)

    if (!imageHash || imageHash !== currentHash) {
      log(
        imageHash
          ? `${IMAGE_NAME} lockfile hash mismatch (dependencies changed). Rebuilding...`
          : `Missing ${IMAGE_NAME} image. Building...`,
      )
      execSync(
        `docker build -f Dockerfile.dev -t ${IMAGE_NAME} --label "lockfile.hash=${currentHash}" .`,
        { cwd: root, stdio: 'inherit' },
      )
    }
  }
}
