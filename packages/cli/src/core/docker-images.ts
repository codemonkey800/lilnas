import { execSync } from 'node:child_process'

import {
  discoverAppServices,
  getMonorepoRoot,
  type ServiceMode,
} from 'src/services/discovery.js'

const BASE_IMAGES = [
  'lilnas-node-base',
  'lilnas-monorepo-builder',
  'lilnas-node-runtime',
  'lilnas-nextjs-runtime',
]

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
    if (!imageExists('lilnas-dev')) {
      log('Missing lilnas-dev image. Building...')
      execSync('docker build -f Dockerfile.dev -t lilnas-dev .', {
        cwd: root,
        stdio: 'inherit',
      })
    }
  }
}
