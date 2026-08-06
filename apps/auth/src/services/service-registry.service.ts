import { env } from '@lilnas/utils/env'
import { Injectable } from '@nestjs/common'
import fs from 'fs/promises'
import { PinoLogger } from 'nestjs-pino'
import path from 'path'

import { EnvKeys } from 'src/env'

// ──────────────────────────────────────────────────────────────────────────────
// U8 (R13): "adding a Traefik label is sufficient for a service to appear in
// the admin UI." Adapted from apps/portal/src/utils/hosts.ts's
// getHostsFromFiles()/extractHostsFromLabels — deliberately NOT
// getHostsFromDocker(), whose docker.sock mount would grant this
// internet-facing container effective host root (plan's Key Technical
// Decisions: "Compose-file label parsing, not the Docker socket"). Reads the
// read-only compose-label bind mount U2 already established
// (deploy.yml/deploy.dev.yml's /repo/apps, /repo/infra — the SAME container
// paths in both dev and prod, so this file needs no dev-vs-prod branching on
// WHERE it reads from, only on which HOSTS it keeps — see includeDevHosts
// below).
//
// Extends portal's own extraction with the one thing it does not do:
// correlating each ROUTER's `rule` (for its Host(...)) with that SAME
// router's own `middlewares` value, so the admin UI can distinguish a host
// still on the old `forward-auth` middleware from one already migrated to
// `lilnas-auth` — the entire point of this unit, and what makes the admin UI
// useful during a staged, per-router migration (R18) rather than only after
// it completes.
// ──────────────────────────────────────────────────────────────────────────────

const HOST_REGEX = /Host\(`([\S]+\.lilnas\.io)`\)/
const ROUTER_RULE_LABEL = /^traefik\.http\.routers\.([^.]+)\.rule=(.*)$/
const ROUTER_MIDDLEWARES_LABEL =
  /^traefik\.http\.routers\.([^.]+)\.middlewares=(.*)$/

// Ported verbatim from apps/portal/src/utils/hosts.ts's HOST_BLOCKLIST — U8's
// own test scenarios require these stay filtered here too, matching portal's
// existing precedent rather than re-deriving it from scratch.
const HOST_BLOCKLIST = new Set(['auth', 'edge'])

// Exported (unlike the constants below staying private) so U10's
// seed-whitelist.ts CLI entrypoint scans the exact same compose-label
// bind-mount paths this service does, rather than duplicating the literal
// strings and risking the two drifting apart.
export const DEFAULT_APPS_DIR = '/repo/apps'
export const DEFAULT_INFRA_DIR = '/repo/infra'
const CACHE_TTL_MS = 30_000

export type MiddlewareStatus = 'lilnas-auth' | 'forward-auth' | 'none'

export type ServiceRegistryEntry = {
  host: string
  gatedBy: MiddlewareStatus
}

type RouterInfo = {
  host: string | undefined
  middlewares: string[]
}

function isBlocklisted(host: string): boolean {
  return HOST_BLOCKLIST.has(host.replace('.lilnas.io', ''))
}

// Groups a flat list of raw Traefik labels (from however many services and
// files they came from — router names are already globally unique in any
// working Traefik config, since they are merged dynamic-config keys, so
// flattening first and parsing once is equivalent to, and simpler than,
// tracking file/service boundaries) by router name, correlating each
// router's OWN rule with its OWN middlewares — the correlation portal's
// hosts.ts never needed, since it only ever cared about the flat set of
// hosts, never which middleware gated which.
function parseRouters(labels: string[]): Map<string, RouterInfo> {
  const routers = new Map<string, RouterInfo>()

  function getOrCreate(name: string): RouterInfo {
    let info = routers.get(name)
    if (!info) {
      info = { host: undefined, middlewares: [] }
      routers.set(name, info)
    }
    return info
  }

  for (const label of labels) {
    const ruleMatch = ROUTER_RULE_LABEL.exec(label)
    if (ruleMatch) {
      const [, routerName, ruleValue] = ruleMatch
      if (routerName && ruleValue) {
        const host = HOST_REGEX.exec(ruleValue)?.at(1)
        if (host) {
          getOrCreate(routerName).host = host
        }
      }
      continue
    }

    const middlewaresMatch = ROUTER_MIDDLEWARES_LABEL.exec(label)
    if (middlewaresMatch) {
      const [, routerName, middlewaresValue] = middlewaresMatch
      if (routerName && middlewaresValue) {
        getOrCreate(routerName).middlewares = middlewaresValue
          .split(',')
          .map(m => m.trim())
          .filter(Boolean)
      }
    }
  }

  return routers
}

// R18's per-router migration ordering means a host can, correctly, carry a
// router still on `forward-auth` — that is the expected, safe steady state
// for every host not yet migrated, not an error condition. `lilnas-auth`
// takes precedence whenever present across a host's routers (the
// security-relevant question this admin UI exists to answer is "has the NEW
// protection landed here yet", so that signal wins over a same-host
// unrelated/legacy middleware — e.g. apps/swole/deploy.yml's
// swole-metrics-deny router, which is neither forward-auth nor lilnas-auth
// and so never affects a host's classification either way).
function classify(middlewareSets: string[][]): MiddlewareStatus {
  const all = middlewareSets.flat()
  if (all.includes('lilnas-auth')) return 'lilnas-auth'
  if (all.includes('forward-auth')) return 'forward-auth'
  return 'none'
}

async function readComposeLabels(filePath: string): Promise<string[]> {
  try {
    const { parse } = await import('yaml')
    const content = await fs.readFile(filePath, 'utf-8')
    // Parsed to `unknown` and narrowed manually below, rather than cast
    // straight to a `{ services?: Record<string, { labels?: string[] }> }`
    // shape — yaml's own parse() returns `any`, so that cast was an
    // unchecked assertion over untrusted file content, asserting `labels`
    // is always list-form when Docker Compose accepts EITHER a list
    // (`labels: ["a=b"]`) or a map (`labels: {a: "b"}`). Under map form,
    // the old code's `.flatMap` folded the object in as a single
    // non-string element, which HOST_REGEX/ROUTER_RULE_LABEL/
    // ROUTER_MIDDLEWARES_LABEL below would then stringify to
    // "[object Object]" and match nothing — that service silently vanishes
    // from the registry, with no warning and no type error.
    const doc = parse(content) as unknown
    if (!doc || typeof doc !== 'object') {
      return []
    }
    const services = (doc as { services?: unknown }).services
    if (!services || typeof services !== 'object') {
      return []
    }

    const labels: string[] = []
    for (const service of Object.values(services as Record<string, unknown>)) {
      if (!service || typeof service !== 'object') {
        continue
      }
      const serviceLabels = (service as { labels?: unknown }).labels
      if (Array.isArray(serviceLabels)) {
        for (const label of serviceLabels) {
          if (typeof label === 'string') {
            labels.push(label)
          }
        }
      } else if (serviceLabels && typeof serviceLabels === 'object') {
        // Map form — re-flattened to the SAME `key=value` string shape the
        // list form already produces, so HOST_REGEX/ROUTER_RULE_LABEL/
        // ROUTER_MIDDLEWARES_LABEL above need no changes to handle either
        // form.
        for (const [key, value] of Object.entries(
          serviceLabels as Record<string, unknown>,
        )) {
          labels.push(`${key}=${String(value)}`)
        }
      }
    }
    return labels
  } catch {
    // Error path: an unparseable or absent compose file is skipped without
    // failing the whole scan — matches apps/portal/src/utils/hosts.ts's
    // identical per-file try/catch.
    return []
  }
}

async function listComposeFilePaths(
  appsDir: string,
  infraDir: string,
  onWarn: (dir: string, err: unknown) => void,
): Promise<string[]> {
  const appDeployFiles = await (async () => {
    try {
      const entries = await fs.readdir(appsDir, { withFileTypes: true })
      return entries
        .filter(e => e.isDirectory())
        .map(e => path.join(appsDir, e.name, 'deploy.yml'))
    } catch (err) {
      onWarn(appsDir, err)
      return []
    }
  })()

  const infraFiles = await (async () => {
    try {
      const entries = await fs.readdir(infraDir, { withFileTypes: true })
      return entries
        .filter(
          e =>
            e.isFile() &&
            e.name.endsWith('.yml') &&
            !e.name.endsWith('.dev.yml'),
        )
        .map(e => path.join(infraDir, e.name))
    } catch (err) {
      onWarn(infraDir, err)
      return []
    }
  })()

  return [...appDeployFiles, ...infraFiles]
}

export type ScanOptions = {
  // U8's own test scenario: "*.dev.lilnas.io hosts are excluded in
  // production and included in development." Passed explicitly rather than
  // read from process.env inside this function — mirrors
  // src/auth/redirect.ts's resolveRedirectTarget()'s own "no env reads
  // inside this module" rationale, for the same test-predictability reason.
  includeDevHosts: boolean
  // Error path: "the bind mount being missing degrades to an empty registry
  // with a logged warning, and does not crash the process." A plain
  // callback (not a class instance) keeps this function's own testable
  // behavior fully deterministic and framework-agnostic — the injectable
  // class below is what wires this to a real PinoLogger.
  onWarn?: (dir: string, err: unknown) => void
}

// The plain, directly-testable scan — apps/auth's established
// pattern (mirrors src/auth/redirect.ts's resolveRedirectTarget) of keeping
// the actual logic in a parameterized plain function, with the injectable
// class below as a thin wrapper supplying real config, caching, and
// logging.
export async function scanServiceRegistry(
  appsDir: string,
  infraDir: string,
  options: ScanOptions,
): Promise<ServiceRegistryEntry[]> {
  const onWarn = options.onWarn ?? (() => {})
  const filePaths = await listComposeFilePaths(appsDir, infraDir, onWarn)
  const labelArrays = await Promise.all(filePaths.map(readComposeLabels))
  const routers = parseRouters(labelArrays.flat())

  // Grouping by host (rather than emitting one entry per router) is what
  // makes a multi-router host — e.g. apps/swole/deploy.yml's swole +
  // swole-metrics-deny shape — appear exactly once, classified by whichever
  // of its routers carries the most security-relevant middleware.
  const middlewaresByHost = new Map<string, string[][]>()
  for (const { host, middlewares } of routers.values()) {
    if (!host) continue
    if (!options.includeDevHosts && host.endsWith('.dev.lilnas.io')) continue
    if (isBlocklisted(host)) continue
    const sets = middlewaresByHost.get(host) ?? []
    sets.push(middlewares)
    middlewaresByHost.set(host, sets)
  }

  return [...middlewaresByHost.entries()]
    .map(([host, sets]) => ({ host, gatedBy: classify(sets) }))
    .sort((a, b) => a.host.localeCompare(b.host))
}

const LOG_EVENTS = {
  registryScanWarning: 'service-registry-scan-warning',
} as const

@Injectable()
export class ServiceRegistryService {
  private cache:
    | { entries: ServiceRegistryEntry[]; expiresAtMs: number }
    | undefined

  constructor(private readonly logger: PinoLogger) {}

  // "A filesystem walk per admin page load is fine, per verify request is
  // not — though the verify path never calls this." The cache exists
  // anyway, as the plan asks, so a page that fetches this more than once
  // (or a burst of near-simultaneous admin page loads) doesn't repeat the
  // walk needlessly; CACHE_TTL_MS is a fixed constant rather than a new
  // env-tunable, since the plan does not ask for one and 30s already
  // satisfies "adding a label is visible on the next admin page load"
  // without a config knob nobody requested.
  async getServices(): Promise<ServiceRegistryEntry[]> {
    if (this.cache && this.cache.expiresAtMs > Date.now()) {
      return this.cache.entries
    }

    const entries = await scanServiceRegistry(
      DEFAULT_APPS_DIR,
      DEFAULT_INFRA_DIR,
      {
        includeDevHosts: env(EnvKeys.NODE_ENV, 'development') !== 'production',
        onWarn: (dir, err) => {
          // Coarsened to err.name only, never err.message/err.stack — per
          // docs/archive/solutions/conventions/tdr-code-structured-logging-convention-2026-07-03.md's
          // redaction hierarchy, matching src/verify/access-cache.service.ts's
          // identical choice for its own session-lookup-failure log line.
          this.logger.warn(
            {
              event: LOG_EVENTS.registryScanWarning,
              dir,
              errName: err instanceof Error ? err.name : undefined,
            },
            'service-registry: could not read a compose directory; degrading to an empty registry for this scan',
          )
        },
      },
    )

    this.cache = { entries, expiresAtMs: Date.now() + CACHE_TTL_MS }
    return entries
  }
}
