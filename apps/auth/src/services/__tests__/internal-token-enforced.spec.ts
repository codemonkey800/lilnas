import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'

// Guards production enforcement of InternalTokenGuard. Without
// INTERNAL_TOKEN_ENFORCE=true on the `auth` service, /internal/* and
// /admin/check only log a missing or wrong token and let the call through,
// so every container on the compose network could reach them. The value must
// be a literal so it cannot be dropped by an unset variable on the deploy
// host. The frontend holds no token and gains no internal setting, and the
// dev stack stays in observe mode.

const REPO_ROOT = path.resolve(__dirname, '../../../../..')

type ComposeService = {
  environment?: string[] | Record<string, unknown>
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

function service(compose: ComposeFile, name: string): ComposeService {
  const found = compose.services[name]
  if (!found) throw new Error(`compose file has no service named ${name}`)
  return found
}

const prod = readYaml<ComposeFile>('apps/auth/deploy.yml')
const dev = readYaml<ComposeFile>('apps/auth/deploy.dev.yml')

describe('INTERNAL_TOKEN_ENFORCE', () => {
  it('is the literal `true` on the auth backend in deploy.yml', () => {
    const entries = toEntries(service(prod, 'auth').environment).filter(
      ([key]) => key === 'INTERNAL_TOKEN_ENFORCE',
    )
    expect(entries).toEqual([['INTERNAL_TOKEN_ENFORCE', 'true']])
  })

  it('is not interpolated', () => {
    const entry = toEntries(service(prod, 'auth').environment).find(
      ([key]) => key === 'INTERNAL_TOKEN_ENFORCE',
    )
    expect(entry?.[1]).not.toContain('$')
  })

  it('leaves auth-frontend without any INTERNAL environment key', () => {
    const keys = toEntries(service(prod, 'auth-frontend').environment)
      .map(([key]) => key)
      .filter(key => key.includes('INTERNAL'))
    expect(keys).toEqual([])
  })

  it('is not set by any service in deploy.dev.yml', () => {
    const setters = Object.entries(dev.services)
      .filter(([, svc]) =>
        toEntries(svc.environment).some(
          ([key]) => key === 'INTERNAL_TOKEN_ENFORCE',
        ),
      )
      .map(([name]) => name)
    expect(setters).toEqual([])
  })
})
