import path from 'path'
import { parse } from 'yaml'

import { Route } from './registry.types'

export const LILNAS_PROXY_NETWORK = 'lilnas-proxy'
export const DEV_HOST_SUFFIX = '.dev.lilnas.io'

// Subset of the compose spec the registry reads; everything is optional and
// loosely typed because the files are user-authored.
export interface ComposeService {
  container_name?: unknown
  labels?: unknown
  networks?: unknown
  ports?: unknown
  env_file?: unknown
}

export interface ComposeFile {
  name?: unknown
  services: Record<string, ComposeService>
}

/**
 * Parses compose YAML with merge keys resolved. Returns undefined for a
 * document without a `services` map; throws on invalid YAML.
 */
export function parseComposeFile(text: string): ComposeFile | undefined {
  const doc: unknown = parse(text, { merge: true, logLevel: 'error' })
  if (!isRecord(doc) || !isRecord(doc.services)) return undefined

  const services: Record<string, ComposeService> = {}
  for (const [name, svc] of Object.entries(doc.services)) {
    services[name] = isRecord(svc) ? svc : {}
  }
  return { name: doc.name, services }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Normalizes compose's list (`k=v`) and map (`k: v`) label forms. */
export function normalizeLabels(labels: unknown): Map<string, string> {
  const result = new Map<string, string>()

  if (Array.isArray(labels)) {
    for (const entry of labels) {
      if (typeof entry !== 'string') continue
      const eq = entry.indexOf('=')
      if (eq === -1) result.set(entry, '')
      else result.set(entry.slice(0, eq), entry.slice(eq + 1))
    }
  } else if (isRecord(labels)) {
    for (const [key, value] of Object.entries(labels)) {
      result.set(key, value == null ? '' : String(value))
    }
  }

  return result
}

/** Network names from either the list or the map form of `networks`. */
export function networkNames(networks: unknown): string[] {
  if (Array.isArray(networks)) {
    return networks.filter((n): n is string => typeof n === 'string')
  }
  if (isRecord(networks)) return Object.keys(networks)
  return []
}

const ROUTER_LABEL = /^traefik\.http\.routers\.([^.]+)\.(.+)$/
const SERVICE_PORT_LABEL =
  /^traefik\.http\.services\.([^.]+)\.loadbalancer\.server\.port$/

function backtickArgs(rule: string, fn: string): string[] {
  const values: string[] = []
  for (const call of rule.matchAll(new RegExp(`\\b${fn}\\(([^)]*)\\)`, 'g'))) {
    for (const arg of (call[1] ?? '').matchAll(/`([^`]*)`/g)) {
      values.push(arg[1] ?? '')
    }
  }
  return values
}

/** One Route per `Host()` per router that has a `rule` label. */
export function routesFromLabels(labels: Map<string, string>): Route[] {
  const routers = new Map<string, Map<string, string>>()
  for (const [key, value] of labels) {
    const [, router, prop] = ROUTER_LABEL.exec(key) ?? []
    if (!router || !prop) continue
    const props = routers.get(router) ?? new Map<string, string>()
    props.set(prop, value)
    routers.set(router, props)
  }

  const ports = new Map<string, number>()
  for (const [key, value] of labels) {
    const [, name] = SERVICE_PORT_LABEL.exec(key) ?? []
    const port = Number(value)
    if (name && Number.isInteger(port)) ports.set(name, port)
  }

  const routes: Route[] = []
  for (const [router, props] of routers) {
    const rule = props.get('rule')
    if (!rule) continue

    const pathPrefix = backtickArgs(rule, 'PathPrefix')[0]
    const gated = (props.get('middlewares') ?? '').includes('lilnas-auth')
    const port = ports.get(props.get('service') || router)

    for (const host of backtickArgs(rule, 'Host')) {
      routes.push({
        router,
        host,
        url: `https://${host}${pathPrefix ?? ''}`,
        ...(pathPrefix !== undefined && { pathPrefix }),
        gated,
        ...(port !== undefined && { port }),
      })
    }
  }
  return routes
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/**
 * Published ports bound to loopback, as written. Long-form entries are
 * rendered as `host_ip:published:target`.
 */
export function loopbackPorts(ports: unknown): string[] {
  if (!Array.isArray(ports)) return []

  const result: string[] = []
  for (const entry of ports) {
    let spec: string | undefined
    if (typeof entry === 'string') {
      spec = entry
    } else if (isRecord(entry) && typeof entry.host_ip === 'string') {
      spec = `${entry.host_ip}:${entry.published ?? ''}:${entry.target ?? ''}`
    }
    if (spec === undefined) continue

    // '[::1]:8090:8080' has colons inside the brackets.
    const ip = spec.startsWith('[')
      ? spec.slice(0, spec.indexOf(']') + 1)
      : (spec.split(':')[0] ?? '')
    if (LOOPBACK_HOSTS.has(ip)) result.push(spec)
  }
  return result
}

export interface EnvFileSpec {
  /** Absolute. */
  path: string
  required: boolean
}

/** `env_file` as a string, a list of strings, or a list of `{ path, required }`. */
export function envFileSpecs(
  envFile: unknown,
  composeDir: string,
): EnvFileSpec[] {
  const entries = Array.isArray(envFile) ? envFile : [envFile]

  const specs: EnvFileSpec[] = []
  for (const entry of entries) {
    if (typeof entry === 'string') {
      specs.push({ path: path.resolve(composeDir, entry), required: true })
    } else if (isRecord(entry) && typeof entry.path === 'string') {
      specs.push({
        path: path.resolve(composeDir, entry.path),
        required: entry.required !== false,
      })
    }
  }
  return specs
}
