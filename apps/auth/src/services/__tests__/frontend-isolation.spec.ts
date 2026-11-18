import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'

// Guards the production split of lilnas-auth into two containers (see the
// header comment of apps/auth/deploy.yml): `auth` is the backend and holds
// every secret; `auth-frontend` is the only service Traefik routes to, so it
// must hold none. Each assertion below is a way the frontend could regain
// access to the signing secret, the Google secret or the database, or the
// way Traefik could end up routing to the wrong container.

const REPO_ROOT = path.resolve(__dirname, '../../../../..')

type ComposeService = {
  image?: string
  build?: unknown
  env_file?: unknown
  volumes?: unknown
  ports?: unknown
  secrets?: unknown
  environment?: string[] | Record<string, unknown>
  labels?: string[] | Record<string, unknown>
}
type ComposeFile = { services: Record<string, ComposeService> }

function readYaml<T>(relPath: string): T {
  return parse(fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8')) as T
}

// Compose accepts both list (`KEY=value`) and map forms; normalise to pairs.
function toEntries(
  value: string[] | Record<string, unknown> | undefined,
): Array<[string, string]> {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map(item => {
      const index = item.indexOf('=')
      return index === -1
        ? [item, '']
        : [item.slice(0, index), item.slice(index + 1)]
    })
  }
  return Object.entries(value).map(([key, val]) => [key, String(val ?? '')])
}

const compose = readYaml<ComposeFile>('apps/auth/deploy.yml')

function service(name: string): ComposeService {
  const found = compose.services[name]
  if (!found) throw new Error(`deploy.yml has no service named ${name}`)
  return found
}

const backend = service('auth')
const frontend = service('auth-frontend')

const ALLOWED_FRONTEND_ENV = [
  'AUTH_HOST',
  'REDIRECT_ALLOWED_SUFFIX',
  'AUTH_BACKEND_URL',
  'PROFILE_ALLOWED_ORIGINS',
  'TZ',
  'NODE_ENV',
]

const labelNames = (service: ComposeService): string[] =>
  toEntries(service.labels).map(([name]) => name)

const isAuthRouterOrService = (name: string): boolean =>
  name.startsWith('traefik.http.routers.auth.') ||
  name.startsWith('traefik.http.services.auth.')

describe('auth-frontend isolation', () => {
  describe('auth-frontend', () => {
    it.each(['env_file', 'volumes', 'ports', 'secrets'] as const)(
      'has no %s',
      key => {
        expect(frontend).not.toHaveProperty(key)
      },
    )

    it('sets only allowlisted environment keys', () => {
      const keys = toEntries(frontend.environment).map(([key]) => key)
      expect(keys.length).toBeGreaterThan(0)
      const unexpected = keys.filter(key => !ALLOWED_FRONTEND_ENV.includes(key))
      expect(unexpected).toEqual([])
    })

    it('uses literal environment values, never ${...} interpolation', () => {
      const entries = toEntries(frontend.environment)
      const interpolated = entries
        .filter(([, value]) => value.includes('${'))
        .map(([key]) => key)
      expect(interpolated).toEqual([])
    })
  })

  describe('auth (backend)', () => {
    it('has no traefik.* label', () => {
      const traefik = labelNames(backend).filter(name =>
        name.startsWith('traefik.'),
      )
      expect(traefik).toEqual([])
    })

    it('keeps the env file and the /data volume', () => {
      expect(backend.env_file).toEqual(['.env.prod.decrypted'])
      const targets = (backend.volumes as string[]).map(v => v.split(':')[1])
      expect(targets).toContain('/data')
    })
  })

  describe('Traefik routing', () => {
    it('has the auth router and service labels on auth-frontend', () => {
      const names = labelNames(frontend)
      expect(names).toEqual(
        expect.arrayContaining([
          'traefik.http.routers.auth.rule',
          'traefik.http.routers.auth.entrypoints',
          'traefik.http.routers.auth.tls.certresolver',
          'traefik.http.routers.auth.priority',
          'traefik.http.services.auth.loadbalancer.server.port',
        ]),
      )
    })

    it('has the auth router and service labels on no other service', () => {
      const owners = Object.entries(compose.services)
        .filter(([, service]) =>
          labelNames(service).some(isAuthRouterOrService),
        )
        .map(([name]) => name)
      expect(owners).toEqual(['auth-frontend'])
    })
  })

  describe('image', () => {
    it('is the same image on both services', () => {
      expect(frontend.image).toBeTruthy()
      expect(frontend.image).toBe(backend.image)
    })

    // The CI planner (packages/cli/src/utils/ci-detect.ts listImages())
    // lists a service under an image only when it has both `image` and
    // `build`; a service without `build` would never be pulled on deploy.
    it('has a build block on both services', () => {
      expect(backend.build).toBeTruthy()
      expect(frontend.build).toBeTruthy()
    })
  })

  describe('AUTH_BACKEND_URL', () => {
    const value = (): string => {
      const entry = toEntries(frontend.environment).find(
        ([key]) => key === 'AUTH_BACKEND_URL',
      )
      return entry?.[1] ?? ''
    }

    it('equals the production origin next.config.js bakes into the rewrites', () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const nextConfig = require(
        path.join(REPO_ROOT, 'apps/auth/next.config.js'),
      ) as { PROD_BACKEND_ORIGIN: string }
      expect(value()).toBe(nextConfig.PROD_BACKEND_ORIGIN)
    })

    it('has the same origin as the lilnas-auth forwardauth address in infra/proxy.yml', () => {
      const proxy = readYaml<ComposeFile>('infra/proxy.yml')
      const address = Object.values(proxy.services)
        .flatMap(service => toEntries(service.labels))
        .find(
          ([name]) =>
            name === 'traefik.http.middlewares.lilnas-auth.forwardauth.address',
        )?.[1]
      expect(address).toBeTruthy()
      expect(new URL(value()).origin).toBe(new URL(address ?? '').origin)
    })
  })
})
