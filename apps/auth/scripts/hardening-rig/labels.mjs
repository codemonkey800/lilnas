// Prints the rig copy of the auth-frontend Traefik labels from
// apps/auth/deploy.yml, one `key=value` per line, so the rig tests the lines
// that ship. Plain Node, no dependencies.
//
//   node labels.mjs [--deploy <file>] [--domain rig.test] [--amount <n>]
//                   [--no-ipstrategy]
//
// Changes made to each line, and nothing else:
//   - traefik.enable=true is dropped (the production Traefik only routes
//     containers that carry it; the rig Traefik uses exposedByDefault=true
//     plus a `hardening-rig=1` constraint, which is added here)
//   - router, service and middleware names get the `rig-` prefix, in keys
//     and in the router's `middlewares=` list
//   - Host(`auth.lilnas.io`) becomes Host(`auth.<domain>`)
//   - tls.certresolver=le becomes tls=true (the rig has no resolver and
//     serves Traefik's default self-signed certificate)
//   - --amount replaces the inflightreq amount; --no-ipstrategy drops the
//     sourcecriterion.ipstrategy line (the control case)
//
// Exits non-zero when an expected line is missing, so a renamed middleware
// or a dropped label fails the rig instead of silently testing less.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

function fail(message) {
  console.error(`labels: ${message}`)
  process.exit(1)
}

function option(name, fallback) {
  const index = process.argv.indexOf(name)
  if (index === -1) return fallback
  const value = process.argv[index + 1]
  if (value === undefined) fail(`${name} needs a value`)
  return value
}

const deployFile = option('--deploy', path.resolve(HERE, '../../deploy.yml'))
const domain = option('--domain', 'rig.test')
const amount = option('--amount', undefined)
const dropIpStrategy = process.argv.includes('--no-ipstrategy')

if (amount !== undefined && !/^[1-9]\d*$/.test(amount)) {
  fail('--amount must be a positive integer')
}

// Every `- traefik.…` list item in the file. Only auth-frontend carries
// Traefik labels (frontend-isolation.spec.ts keeps them off `auth`).
const raw = readFileSync(deployFile, 'utf8')
  .split('\n')
  .map(line => line.match(/^\s*-\s+(traefik\..*?)\s*$/)?.[1])
  .filter(Boolean)
  .map(item => item.replace(/^(['"])(.*)\1$/, '$2'))

if (raw.length === 0) fail(`no traefik labels in ${deployFile}`)

const ROUTER = /^traefik\.http\.routers\.([^.]+)\./
const SERVICE = /^traefik\.http\.services\.([^.]+)\./
const MIDDLEWARE = /^traefik\.http\.middlewares\.([^.]+)\./

const rename = name => `rig-${name}`
const seen = {
  middlewares: false,
  amount: false,
  ipstrategy: false,
  certresolver: false,
}

const labels = []
for (const label of raw) {
  const separator = label.indexOf('=')
  if (separator === -1) fail(`label without '=': ${label}`)
  let key = label.slice(0, separator)
  let value = label.slice(separator + 1)

  if (key === 'traefik.enable') continue

  key = key
    .replace(ROUTER, (_, name) => `traefik.http.routers.${rename(name)}.`)
    .replace(SERVICE, (_, name) => `traefik.http.services.${rename(name)}.`)
    .replace(
      MIDDLEWARE,
      (_, name) => `traefik.http.middlewares.${rename(name)}.`,
    )

  if (/^traefik\.http\.routers\.[^.]+\.middlewares$/.test(key)) {
    value = value
      .split(',')
      .map(name => rename(name.trim()))
      .join(',')
    seen.middlewares = true
  }
  if (/^traefik\.http\.routers\.[^.]+\.rule$/.test(key)) {
    value = value.replace(
      /Host\(`auth\.lilnas\.io`\)/g,
      `Host(\`auth.${domain}\`)`,
    )
    if (value.includes('lilnas.io'))
      fail(`rule still names lilnas.io: ${value}`)
  }
  if (/\.tls\.certresolver$/.test(key)) {
    key = key.replace(/\.tls\.certresolver$/, '.tls')
    value = 'true'
    seen.certresolver = true
  }
  if (/\.inflightreq\.amount$/.test(key)) {
    seen.amount = true
    if (amount !== undefined) value = amount
  }
  if (/\.inflightreq\.sourcecriterion\.ipstrategy\./.test(key)) {
    seen.ipstrategy = true
    if (dropIpStrategy) continue
  }
  labels.push(`${key}=${value}`)
}

for (const [what, found] of Object.entries(seen)) {
  if (!found) fail(`deploy.yml has no ${what} line for the auth router`)
}
for (const label of labels) {
  const name =
    label.match(ROUTER)?.[1] ??
    label.match(SERVICE)?.[1] ??
    label.match(MIDDLEWARE)?.[1]
  if (!name?.startsWith('rig-')) fail(`unprefixed name in ${label}`)
}

labels.push('hardening-rig=1')
console.log(labels.join('\n'))
