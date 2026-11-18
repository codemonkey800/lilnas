import fs from 'fs'
import path from 'path'
import { parse } from 'yaml'

// Every router with a Host(...) rule under lilnas.io must either be gated by
// lilnas-auth, be stripped of lilnas-auth's cookies by lilnas-cookie-strip,
// or be named in EXEMPT below with a reason. A new open router with neither
// middleware therefore fails here instead of silently receiving lilnas-auth's
// session cookies.

const REPO_ROOT = path.resolve(__dirname, '../../../../..')

const GATED = 'lilnas-auth'
const STRIPPED = 'lilnas-cookie-strip'

const EXEMPT: Record<string, string> = {
  auth: "the login UI needs its own lilnas-auth cookies, so it can't have them stripped",
  emby: 'must not depend on auth being up (decided 2026-11-17)',
  immich: 'must not depend on auth being up (decided 2026-11-17)',
  turbo: 'must not depend on auth being up (decided 2026-11-17)',
}

const EXPECTED_STRIPPED = [
  'dashcam',
  'equations',
  'storage',
  'tdr-code',
  'theater',
  'theater-ws',
]

type ComposeFile = {
  services?: Record<string, { labels?: string[] | Record<string, unknown> }>
}

type Router = { name: string; file: string; middlewares: string[] }

function composeFiles(): string[] {
  const files: string[] = []
  const appsDir = path.join(REPO_ROOT, 'apps')
  for (const app of fs.readdirSync(appsDir)) {
    const file = path.join(appsDir, app, 'deploy.yml')
    if (fs.existsSync(file)) files.push(file)
  }
  const infraDir = path.join(REPO_ROOT, 'infra')
  for (const entry of fs.readdirSync(infraDir)) {
    if (entry.endsWith('.yml') && !entry.endsWith('.dev.yml')) {
      files.push(path.join(infraDir, entry))
    }
  }
  return files.sort()
}

// Labels are list entries `key=value` (some quoted; the YAML parser removes
// the quotes) or, in map form, key: value.
function labelEntries(labels: string[] | Record<string, unknown>): string[] {
  if (Array.isArray(labels)) return labels.map(String)
  return Object.entries(labels).map(([key, value]) => `${key}=${String(value)}`)
}

const ROUTER_LABEL =
  /^traefik\.http\.routers\.([^.]+)\.(rule|middlewares)=(.*)$/

function collectRouters(): Router[] {
  const routers: Router[] = []
  for (const file of composeFiles()) {
    const doc = parse(fs.readFileSync(file, 'utf-8')) as ComposeFile | null
    const rel = path.relative(REPO_ROOT, file)
    for (const service of Object.values(doc?.services ?? {})) {
      const byName = new Map<string, { rule?: string; middlewares: string[] }>()
      for (const entry of labelEntries(service.labels ?? [])) {
        const match = ROUTER_LABEL.exec(entry.trim())
        if (!match) continue
        const [, name, kind, value] = match
        if (!name || value === undefined) continue
        const info = byName.get(name) ?? { middlewares: [] }
        if (kind === 'rule') info.rule = value
        else
          info.middlewares = value
            .split(',')
            .map(m => m.trim())
            .filter(Boolean)
        byName.set(name, info)
      }
      for (const [name, info] of byName) {
        if (info.rule && /Host\(`[^`]*\.?lilnas\.io`\)/.test(info.rule)) {
          routers.push({ name, file: rel, middlewares: info.middlewares })
        }
      }
    }
  }
  return routers
}

// A middleware reference may carry a provider suffix (`lilnas-auth@docker`).
function hasMiddleware(router: Router, middleware: string): boolean {
  return router.middlewares.some(
    m => m === middleware || m.startsWith(`${middleware}@`),
  )
}

describe('router cookie coverage', () => {
  const routers = collectRouters()

  it('finds the lilnas.io routers (guards the collector itself)', () => {
    const names = routers.map(r => r.name)
    expect(names).toEqual(expect.arrayContaining(['portal', 'dashcam', 'emby']))
    expect(new Set(names).size).toBe(names.length)
  })

  it.each(routers.map(r => [r.name, r] as const))(
    'router %s is exactly one of gated, stripped or exempt',
    (name, router) => {
      const states = [
        hasMiddleware(router, GATED) ? 'gated' : undefined,
        hasMiddleware(router, STRIPPED) ? 'stripped' : undefined,
        name in EXEMPT ? 'exempt' : undefined,
      ].filter(Boolean)

      // Message names the router and file so a failure says what to fix.
      expect({ router: `${name} (${router.file})`, states }).toEqual({
        router: `${name} (${router.file})`,
        states: [expect.stringMatching(/^(gated|stripped|exempt)$/)],
      })
      expect(states).toHaveLength(1)
    },
  )

  it('every exemption names a router that still exists, with a reason', () => {
    const names = new Set(routers.map(r => r.name))
    for (const [name, reason] of Object.entries(EXEMPT)) {
      expect({ name, exists: names.has(name) }).toEqual({ name, exists: true })
      expect(reason.length).toBeGreaterThan(0)
    }
  })

  it('the stripped set is exactly the six expected routers', () => {
    const stripped = routers
      .filter(r => hasMiddleware(r, STRIPPED))
      .map(r => r.name)
      .sort()
    expect(stripped).toEqual(EXPECTED_STRIPPED)
  })
})
