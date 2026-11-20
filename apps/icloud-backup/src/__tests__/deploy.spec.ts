import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'

// Guards the production split of icloud-backup into a database, a backend that
// holds every secret, and a frontend that is the only service Traefik routes
// to (see the header comment of apps/icloud-backup/deploy.yml). Each assertion
// is a way the frontend could regain access to the Immich key, the database or
// the iCloud session cookies, or the way a dry-run setting could leak into
// production.

const APP_DIR = path.resolve(__dirname, '../..')

type ComposeService = {
  image?: string
  build?: unknown
  env_file?: unknown
  volumes?: string[]
  ports?: unknown
  secrets?: unknown
  networks?: string[] | Record<string, unknown>
  environment?: string[] | Record<string, unknown>
  labels?: string[] | Record<string, unknown>
}
type ComposeFile = { services: Record<string, ComposeService> }

function readText(file: string): string {
  return fs.readFileSync(path.join(APP_DIR, file), 'utf-8')
}

function readCompose(file: string): ComposeFile {
  return parse(readText(file)) as ComposeFile
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

const prod = readCompose('deploy.yml')
const dev = readCompose('deploy.dev.yml')

function service(compose: ComposeFile, name: string): ComposeService {
  const found = compose.services[name]
  if (!found) throw new Error(`compose file has no service named ${name}`)
  return found
}

const db = service(prod, 'icloud-backup-db')
const backend = service(prod, 'icloud-backup')
const frontend = service(prod, 'icloud-backup-frontend')

const labelNames = (svc: ComposeService): string[] =>
  toEntries(svc.labels).map(([name]) => name)

const traefikLabelNames = (svc: ComposeService): string[] =>
  labelNames(svc).filter(name => name.startsWith('traefik.'))

const SECRET_KEY = /(PASSWORD|SECRET|TOKEN|API_?KEY|COOKIE|CREDENTIAL)/i

const DRY_RUN_ONLY = [
  'ICLOUDPD_RECENT',
  'IMMICH_EMAIL_PLUS_TAG',
  'ACCOUNT_SLUG_PREFIX',
]

describe('icloud-backup deploy.yml', () => {
  it('defines exactly the database, backend and frontend', () => {
    expect(Object.keys(prod.services).sort()).toEqual([
      'icloud-backup',
      'icloud-backup-db',
      'icloud-backup-frontend',
    ])
  })

  describe('icloud-backup-frontend', () => {
    it.each(['env_file', 'volumes', 'ports', 'secrets'] as const)(
      'has no %s',
      key => {
        expect(frontend).not.toHaveProperty(key)
      },
    )

    it('has no secret-looking environment key and no ${...} interpolation', () => {
      const entries = toEntries(frontend.environment)
      expect(
        entries.map(([key]) => key).filter(k => SECRET_KEY.test(k)),
      ).toEqual([])
      expect(
        entries.filter(([, value]) => value.includes('${')).map(([k]) => k),
      ).toEqual([])
    })
  })

  describe('Traefik routing', () => {
    it('routes only the frontend, behind lilnas-auth', () => {
      expect(traefikLabelNames(db)).toEqual([])
      expect(traefikLabelNames(backend)).toEqual([])
      expect(traefikLabelNames(frontend).length).toBeGreaterThan(0)

      const labels = Object.fromEntries(toEntries(frontend.labels))
      const middlewares =
        labels['traefik.http.routers.icloud-backup.middlewares']
      expect(middlewares?.split(',')).toContain('lilnas-auth')
      expect(labels['traefik.http.routers.icloud-backup.rule']).toBe(
        'Host(`icloud-backup.lilnas.io`)',
      )
      expect(
        labels['traefik.http.services.icloud-backup.loadbalancer.server.port'],
      ).toBe('8080')
    })
  })

  describe('icloud-backup (backend)', () => {
    it('mounts exactly the photos and state host paths', () => {
      expect(backend.volumes).toEqual([
        '/storage/photos/icloud-users:/photos',
        '/storage/app-data/icloud-backup:/state',
      ])
    })

    it('loads the decrypted env file and waits for a healthy database', () => {
      expect(backend.env_file).toEqual(['.env.prod.decrypted'])
      expect(db.env_file).toEqual(['.env.prod.decrypted'])
      expect(backend).toHaveProperty(
        'depends_on.icloud-backup-db.condition',
        'service_healthy',
      )
    })
  })

  describe('image', () => {
    it('is the same image on both app services', () => {
      expect(frontend.image).toBeTruthy()
      expect(frontend.image).toBe(backend.image)
    })

    // The CI planner lists a service under an image only when it has both
    // `image` and `build`; a service without `build` would never be pulled.
    it('has a build block on both app services', () => {
      expect(backend.build).toBeTruthy()
      expect(frontend.build).toBeTruthy()
    })
  })

  describe('dry-run-only variables', () => {
    it.each(DRY_RUN_ONLY)('%s is absent', name => {
      expect(readText('deploy.yml')).not.toContain(name)
      for (const svc of Object.values(prod.services)) {
        expect(toEntries(svc.environment).map(([key]) => key)).not.toContain(
          name,
        )
      }
    })
  })
})

describe('icloud-backup deploy.dev.yml', () => {
  const devFrontend = service(dev, 'icloud-backup-dev-frontend')
  const devBackend = service(dev, 'icloud-backup-dev')

  const networkNames = (svc: ComposeService): string[] =>
    Array.isArray(svc.networks) ? svc.networks : Object.keys(svc.networks ?? {})

  it('keeps the frontend off lilnas_default', () => {
    expect(networkNames(devFrontend).sort()).toEqual([
      'icloud-backup-dev',
      'lilnas-proxy',
    ])
  })

  it('gives the dev backend the icloud-backup alias on the private network', () => {
    expect(devBackend.networks).toMatchObject({
      'icloud-backup-dev': { aliases: ['icloud-backup'] },
    })
    expect(networkNames(devBackend)).toContain('lilnas_default')
  })

  it('publishes no ports', () => {
    for (const svc of Object.values(dev.services)) {
      expect(svc).not.toHaveProperty('ports')
    }
  })
})

describe('icloud-backup .env.prod', () => {
  const entries = readText('.env.prod')
    .split('\n')
    .filter(line => line.trim() !== '' && !line.startsWith('#'))
    .map(line => {
      const index = line.indexOf('=')
      return [line.slice(0, index), line.slice(index + 1)] as const
    })
  const secrets = entries.filter(([key]) => key !== 'DOTENV_PUBLIC_KEY_PROD')

  it('has the four production keys', () => {
    expect(secrets.map(([key]) => key).sort()).toEqual([
      'IMMICH_API_KEY',
      'POSTGRES_DB',
      'POSTGRES_PASSWORD',
      'POSTGRES_USER',
    ])
  })

  it('encrypts every value', () => {
    for (const [key, value] of secrets) {
      expect({ key, encrypted: /^"?encrypted:/.test(value) }).toEqual({
        key,
        encrypted: true,
      })
    }
  })

  it.each([...DRY_RUN_ONLY, 'DEV_USER_EMAIL', 'DEV_USER_ID'])(
    'has no dev-only key %s',
    name => {
      expect(entries.map(([key]) => key)).not.toContain(name)
    },
  )
})
