import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import {
  detect,
  DetectInputs,
  DetectResult,
  listImages,
  readComposeTree,
} from '../ci-detect'

/**
 * A mini repo: a root compose including two app deploy files, one infra file
 * with a bind mount and an env file, one include with an include-level
 * `env_file`, a `tdr-code`-style host-native proxy, a `dev-idle-reaper`-style
 * `build: .`, and packages with and without a `test` script.
 */
const FIXTURE: Record<string, string> = {
  'docker-compose.yml': `
name: lilnas
include:
  - ./infra/shared.yml
  - path: ./infra/nexus-code.yml
    env_file: ./infra/.env.nexus-code.decrypted
  - ./apps/auth/deploy.yml
  - ./apps/tdr-bot/deploy.yml
  - ./apps/dev-idle-reaper/deploy.yml
  - ./apps/tdr-code/deploy.yml
`,
  'infra/shared.yml': `
services:
  storage:
    image: pgsty/minio:latest
    env_file:
      - .env.storage.decrypted
    volumes:
      - /storage/app-data/minio:/data
  prometheus:
    image: prom/prometheus:latest
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - type: bind
        source: ./monitoring/rules
        target: /etc/prometheus/rules
      - /storage/app-data/prometheus:/prometheus
`,
  'infra/nexus-code.yml': `
services:
  nexus-code:
    image: ghcr.io/example/nexus-code:latest
  nexus-code-db:
    image: postgres:17-alpine
`,
  'apps/auth/deploy.yml': `
services:
  auth:
    image: ghcr.io/codemonkey800/lilnas-auth:\${LILNAS_TAG:-latest}
    build:
      context: ../..
      dockerfile: apps/auth/Dockerfile
    env_file:
      - .env.prod.decrypted
`,
  'apps/tdr-bot/deploy.yml': `
services:
  tdr-bot-db:
    image: postgres:17-alpine
    env_file:
      - path: .env.prod.decrypted
    volumes:
      - /storage/app-data/tdr-bot-db:/var/lib/postgresql/data
  tdr-bot:
    image: ghcr.io/codemonkey800/lilnas-tdr-bot:\${LILNAS_TAG:-latest}
    build:
      context: ../../
      dockerfile: apps/tdr-bot/Dockerfile
    env_file: .env.prod.decrypted
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
`,
  'apps/dev-idle-reaper/deploy.yml': `
services:
  dev-idle-reaper:
    image: ghcr.io/codemonkey800/lilnas-dev-idle-reaper:\${LILNAS_TAG:-latest}
    build: .
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - reaper-state:/var/lib/reaper
volumes:
  reaper-state:
`,
  'apps/tdr-code/deploy.yml': `
services:
  tdr-code:
    image: nginx:alpine
    env_file:
      - .env
    volumes:
      - ../../infra/local-proxy/entrypoint.sh:/local-proxy/entrypoint.sh:ro
      - ./deploy/sse-locations.conf:/etc/nginx/conf.d/sse.conf:ro
`,
  'apps/auth/Dockerfile': 'FROM ghcr.io/codemonkey800/lilnas-node-runtime\n',
  'apps/tdr-bot/Dockerfile': 'FROM ghcr.io/codemonkey800/lilnas-node-runtime\n',
  'apps/dev-idle-reaper/Dockerfile': 'FROM docker:cli\n',
  'apps/auth/package.json': '{"name":"auth","scripts":{"test":"jest"}}',
  'apps/tdr-bot/package.json': '{"name":"tdr-bot","scripts":{"test":"jest"}}',
  'apps/tdr-code/package.json': '{"name":"tdr-code","scripts":{"test":"jest"}}',
  'apps/dev-idle-reaper/package.json': '{"name":"reaper","scripts":{}}',
  'packages/utils/package.json': '{"name":"utils","scripts":{"test":"jest"}}',
  'packages/eslint/package.json': '{"name":"eslint","scripts":{"lint":"x"}}',
  'README.md': '# fixture\n',
}

const ALL_SERVICES = [
  'auth',
  'dev-idle-reaper',
  'nexus-code',
  'nexus-code-db',
  'prometheus',
  'storage',
  'tdr-bot',
  'tdr-bot-db',
  'tdr-code',
]

const ALL_TEST_PACKAGES = [
  'apps/auth',
  'apps/tdr-bot',
  'apps/tdr-code',
  'packages/utils',
]

const EMPTY: Omit<DetectResult, 'changedFiles'> = {
  full: false,
  baseImages: false,
  images: [],
  pull: [],
  up: [],
  forceRecreate: [],
  decrypt: false,
  testPackages: [],
}

let root: string

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-detect-'))
  for (const [file, body] of Object.entries(FIXTURE)) {
    const abs = path.join(root, file)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body.trimStart())
  }
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function run(
  changedFiles: string[],
  extra: Partial<DetectInputs> = {},
): DetectResult {
  return detect({ root, changedFiles, ...extra })
}

function imageNames(result: DetectResult): string[] {
  return result.images.map(image => image.name)
}

describe('readComposeTree', () => {
  it('normalises every path to repo-relative and keeps host paths absolute', () => {
    const tree = readComposeTree(root)

    expect(tree.includes.map(include => include.file)).toEqual([
      'infra/shared.yml',
      'infra/nexus-code.yml',
      'apps/auth/deploy.yml',
      'apps/tdr-bot/deploy.yml',
      'apps/dev-idle-reaper/deploy.yml',
      'apps/tdr-code/deploy.yml',
    ])
    expect(tree.includes[1]?.envFile).toBe('infra/.env.nexus-code.decrypted')

    const service = (name: string) => {
      const found = tree.services.find(s => s.name === name)
      if (!found) throw new Error(`no service ${name}`)
      return found
    }
    expect(service('auth').build).toEqual({
      context: '.',
      dockerfile: 'apps/auth/Dockerfile',
    })
    expect(service('dev-idle-reaper').build).toEqual({
      context: 'apps/dev-idle-reaper',
      dockerfile: 'apps/dev-idle-reaper/Dockerfile',
    })
    expect(service('auth').envFiles).toEqual(['apps/auth/.env.prod.decrypted'])
    expect(service('tdr-bot-db').envFiles).toEqual([
      'apps/tdr-bot/.env.prod.decrypted',
    ])
    expect(service('tdr-bot').envFiles).toEqual([
      'apps/tdr-bot/.env.prod.decrypted',
    ])
    expect(service('storage').envFiles).toEqual([
      'infra/.env.storage.decrypted',
    ])
    expect(service('prometheus').binds).toEqual([
      'infra/monitoring/prometheus.yml',
      'infra/monitoring/rules',
      '/storage/app-data/prometheus',
    ])
    expect(service('tdr-code').binds).toEqual([
      'infra/local-proxy/entrypoint.sh',
      'apps/tdr-code/deploy/sse-locations.conf',
    ])
    // Named volumes are not bind mounts.
    expect(service('dev-idle-reaper').binds).toEqual(['/var/run/docker.sock'])
  })
})

describe('listImages', () => {
  it('lists the locally built ghcr images, sorted, and never tdr-code', () => {
    const images = listImages(readComposeTree(root))

    expect(images).toEqual([
      {
        name: 'auth',
        image: 'ghcr.io/codemonkey800/lilnas-auth',
        context: '.',
        dockerfile: 'apps/auth/Dockerfile',
        services: ['auth'],
      },
      {
        name: 'dev-idle-reaper',
        image: 'ghcr.io/codemonkey800/lilnas-dev-idle-reaper',
        context: 'apps/dev-idle-reaper',
        dockerfile: 'apps/dev-idle-reaper/Dockerfile',
        services: ['dev-idle-reaper'],
      },
      {
        name: 'tdr-bot',
        image: 'ghcr.io/codemonkey800/lilnas-tdr-bot',
        context: '.',
        dockerfile: 'apps/tdr-bot/Dockerfile',
        services: ['tdr-bot'],
      },
    ])
  })
})

describe('detect', () => {
  it('returns everything empty for an unrelated file', () => {
    expect(run(['README.md'])).toEqual({
      ...EMPTY,
      changedFiles: ['README.md'],
    })
  })

  it('dedupes, trims and sorts changedFiles', () => {
    expect(run([' b.md', 'a.md', 'a.md', '']).changedFiles).toEqual([
      'a.md',
      'b.md',
    ])
  })

  describe('full', () => {
    const expectFull = (result: DetectResult) => {
      expect(result.full).toBe(true)
      expect(result.baseImages).toBe(true)
      expect(result.decrypt).toBe(true)
      expect(imageNames(result)).toEqual(['auth', 'dev-idle-reaper', 'tdr-bot'])
      expect(result.pull).toEqual(['auth', 'dev-idle-reaper', 'tdr-bot'])
      expect([...result.pull, ...result.up].sort()).toEqual(ALL_SERVICES)
      expect(result.forceRecreate).toEqual([])
      expect(result.testPackages).toEqual(ALL_TEST_PACKAGES)
    }

    it('is forced by an unknown base (full: true input)', () => {
      expectFull(run([], { full: true }))
    })

    it('is triggered by a workflow change', () => {
      expectFull(run(['.github/workflows/deploy.yml']))
    })

    it('is triggered by the root compose file', () => {
      expectFull(run(['docker-compose.yml']))
    })

    it('ignores docker-compose.dev.yml', () => {
      expect(run(['docker-compose.dev.yml'])).toEqual({
        ...EMPTY,
        changedFiles: ['docker-compose.dev.yml'],
      })
    })
  })

  describe('base images', () => {
    it('rebuilds the base images and every image built FROM one', () => {
      const result = run(['infra/base-images/lilnas-node-base.Dockerfile'])

      expect(result.baseImages).toBe(true)
      expect(imageNames(result)).toEqual(['auth', 'tdr-bot'])
      expect(result.pull).toEqual(['auth', 'tdr-bot'])
      expect(result.up).toEqual([])
    })

    it('treats build-base-images.sh as a base image change', () => {
      expect(run(['infra/base-images/build-base-images.sh']).baseImages).toBe(
        true,
      )
    })

    it('ignores lilnas-dev.Dockerfile', () => {
      expect(run(['infra/base-images/lilnas-dev.Dockerfile'])).toEqual({
        ...EMPTY,
        changedFiles: ['infra/base-images/lilnas-dev.Dockerfile'],
      })
    })
  })

  describe('images', () => {
    it('rebuilds an image when turbo lists its package as affected', () => {
      const result = run(['packages/utils/src/index.ts'], {
        affectedPackages: ['packages/utils', 'apps/auth'],
      })

      expect(imageNames(result)).toEqual(['auth'])
      expect(result.pull).toEqual(['auth'])
      expect(result.testPackages).toEqual(['packages/utils'])
    })

    it("rebuilds an image when a file under its Dockerfile's directory changes", () => {
      const result = run(['apps/tdr-bot/src/main.ts'])

      expect(imageNames(result)).toEqual(['tdr-bot'])
      expect(result.pull).toEqual(['tdr-bot'])
      expect(result.up).toEqual([])
      expect(result.testPackages).toEqual(['apps/tdr-bot'])
    })

    it('rebuilds an image when its Dockerfile changes', () => {
      expect(imageNames(run(['apps/auth/Dockerfile']))).toEqual(['auth'])
    })

    it('rebuilds a non-root-context image when its context changes', () => {
      const result = run(['apps/dev-idle-reaper/reaper.sh'])

      expect(imageNames(result)).toEqual(['dev-idle-reaper'])
      expect(result.pull).toEqual(['dev-idle-reaper'])
    })

    it('never builds tdr-code, even when apps/tdr-code changes', () => {
      const result = run(['apps/tdr-code/src/server.ts'], {
        affectedPackages: ['apps/tdr-code'],
      })

      expect(result.images).toEqual([])
      expect(result.pull).toEqual([])
      expect(result.up).toEqual([])
      expect(result.forceRecreate).toEqual([])
      expect(result.testPackages).toEqual(['apps/tdr-code'])
    })
  })

  describe('compose files', () => {
    it('ups every service in a changed app deploy.yml', () => {
      const result = run(['apps/tdr-bot/deploy.yml'])

      // deploy.yml lives under the Dockerfile's directory, so the image is rebuilt too.
      expect(result.pull).toEqual(['tdr-bot'])
      expect(result.up).toEqual(['tdr-bot-db'])
    })

    it('ups the tdr-code proxy for its deploy.yml without building anything', () => {
      const result = run(['apps/tdr-code/deploy.yml'])

      expect(result.images).toEqual([])
      expect(result.up).toEqual(['tdr-code'])
    })

    it('ups every service in a changed infra file', () => {
      const result = run(['infra/shared.yml'])

      expect(result.up).toEqual(['prometheus', 'storage'])
      expect(result.forceRecreate).toEqual([])
      expect(result.decrypt).toBe(false)
    })

    it('ignores *.dev.yml files', () => {
      const changed = ['apps/auth/deploy.dev.yml', 'infra/shared.dev.yml']
      const result = run(changed)

      // apps/auth/deploy.dev.yml is under the auth Dockerfile's directory,
      // so the image rebuild still fires; nothing else does.
      expect(result.pull).toEqual(['auth'])
      expect(result.up).toEqual([])
      expect(result.forceRecreate).toEqual([])
      expect(result.decrypt).toBe(false)
    })
  })

  describe('bind mounts', () => {
    it('force-recreates a service whose mounted file changed', () => {
      const result = run(['infra/monitoring/prometheus.yml'])

      expect(result.forceRecreate).toEqual(['prometheus'])
      expect(result.up).toEqual([])
    })

    it('force-recreates a service when a file inside a mounted directory changed', () => {
      expect(run(['infra/monitoring/rules/alerts.yml']).forceRecreate).toEqual([
        'prometheus',
      ])
    })

    it('force-recreates a service when an ancestor of a mounted path changed', () => {
      expect(run(['infra/monitoring']).forceRecreate).toEqual(['prometheus'])
    })

    it('force-recreates the tdr-code proxy for its mounted nginx config', () => {
      expect(run(['infra/local-proxy/entrypoint.sh']).forceRecreate).toEqual([
        'tdr-code',
      ])
    })

    it('wins over up', () => {
      const result = run([
        'infra/shared.yml',
        'infra/monitoring/prometheus.yml',
      ])

      expect(result.forceRecreate).toEqual(['prometheus'])
      expect(result.up).toEqual(['storage'])
    })
  })

  describe('env files', () => {
    it('decrypts and ups the services loading a changed encrypted env file', () => {
      const result = run(['infra/.env.storage'])

      expect(result.decrypt).toBe(true)
      expect(result.up).toEqual(['storage'])
      expect(result.images).toEqual([])
    })

    it('handles string, list and {path} env_file forms', () => {
      const result = run(['apps/tdr-bot/.env.prod'])

      expect(result.decrypt).toBe(true)
      // apps/tdr-bot/.env.prod is under the tdr-bot Dockerfile's directory.
      expect(result.pull).toEqual(['tdr-bot'])
      expect(result.up).toEqual(['tdr-bot-db'])
    })

    it('decrypts and ups every service of an include with an include-level env_file', () => {
      const result = run(['infra/.env.nexus-code'])

      expect(result.decrypt).toBe(true)
      expect(result.up).toEqual(['nexus-code', 'nexus-code-db'])
    })

    it('does not match the .decrypted sibling itself', () => {
      expect(run(['infra/.env.storage.decrypted'])).toEqual({
        ...EMPTY,
        changedFiles: ['infra/.env.storage.decrypted'],
      })
    })
  })

  describe('pull precedence', () => {
    it('removes pulled services from up and forceRecreate', () => {
      const result = run([
        'apps/auth/deploy.yml',
        'apps/auth/.env.prod',
        'apps/auth/src/index.ts',
      ])

      expect(result.pull).toEqual(['auth'])
      expect(result.up).toEqual([])
      expect(result.forceRecreate).toEqual([])
      expect(result.decrypt).toBe(true)
    })
  })

  describe('testPackages', () => {
    it('lists only changed dirs with a test script', () => {
      expect(
        run([
          'packages/utils/src/a.ts',
          'packages/eslint/index.js',
          'apps/dev-idle-reaper/reaper.sh',
        ]).testPackages,
      ).toEqual(['packages/utils'])
    })
  })
})
