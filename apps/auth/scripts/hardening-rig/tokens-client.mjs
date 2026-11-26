// Internal-token client for tokens.sh (plan 022). Runs the real, built
// clients against the rig backend and prints markdown rows
// `check | expected | observed | result`. Never prints a token.
//
//   node tokens-client.mjs clients <enforce|observe>
//       AuthClient (packages/utils/dist) and HostActivityService
//       (apps/dev/dist), run inside a container on the rig network.
//       Needs RIG_ROOT (the worktree, mounted at the same path), RIG_TOKENS
//       (a directory with one file per token) and RIG_AUTH_URL.
//   node tokens-client.mjs log <enforce|observe> < backend.log
//       Checks the backend's internal-auth lines against the requests the
//       rig made, in order. Run on the host.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const [command, mode] = process.argv.slice(2)
if (
  !['clients', 'log'].includes(command) ||
  !['enforce', 'observe'].includes(mode)
) {
  console.error('usage: tokens-client.mjs <clients|log> <enforce|observe>')
  process.exit(2)
}
const enforce = mode === 'enforce'

let failed = 0
function row(check, expected, observed, pass) {
  if (!pass) failed += 1
  const cell = s => String(s).replaceAll('|', '\\|').replaceAll('\n', ' ')
  console.log(
    `| ${cell(`${mode}: ${check}`)} | ${cell(expected)} | ${cell(observed)} | ${pass ? 'PASS' : 'FAIL'} |`,
  )
}

// What the rig sends, in order, and what the guard should log for each.
// tokens.sh runs the clients (AuthClient, then HostActivityService), then the
// reaper function, then the open routes, which log nothing.
const EXPECTED_LOG = [
  ['ok', 'download', 'admin-check'],
  ['ok', 'download', 'discord-link:read'],
  ['ok', 'download', 'discord-identity:write'],
  ['ok', 'icloud-backup', 'admin-check'],
  ['forbidden', 'icloud-backup', 'discord-identity:write'],
  ['missing', null, 'admin-check'],
  ['missing', null, 'discord-link:read'],
  ['missing', null, 'discord-identity:write'],
  ['invalid', null, 'admin-check'],
  ['invalid', null, 'discord-link:read'],
  ['invalid', null, 'discord-identity:write'],
  ['ok', 'dev', 'host-activity:read'],
  ['missing', null, 'host-activity:read'],
  ['ok', 'dev-idle-reaper', 'host-activity:read'],
  ['missing', null, 'host-activity:read'],
  ['forbidden', 'download', 'host-activity:read'],
]

async function settle(fn) {
  try {
    const value = await fn()
    return {
      ok: true,
      text: `resolved ${JSON.stringify(value) ?? 'undefined'}`,
    }
  } catch (err) {
    return {
      ok: false,
      text: `rejected: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

async function clients() {
  const root = process.env.RIG_ROOT
  const tokens = process.env.RIG_TOKENS
  const authUrl = process.env.RIG_AUTH_URL
  const token = name => readFileSync(join(tokens, name), 'utf8').trim()
  const require = createRequire(join(root, 'package.json'))
  const { AuthClient } = require(
    join(root, 'packages/utils/dist/auth/client.js'),
  )
  const { HostActivityService } = require(
    join(root, 'apps/dev/dist/activity/host-activity.service.js'),
  )

  // Each case passes the token to the constructor; '' means no header
  // (an explicit argument wins over AUTH_INTERNAL_TOKEN, which is unset here).
  delete process.env.AUTH_INTERNAL_TOKEN
  const identity = {
    discordUserId: '100000000000000001',
    username: 'rig-user',
    displayName: null,
  }
  const reject = (status, route) =>
    enforce ? `rejects "${route} failed with ${status}..."` : 'resolves'
  const asExpected = (r, status, route) =>
    enforce ? !r.ok && r.text.includes(`${route} failed with ${status} `) : r.ok

  // 1. download token: all three resolve in both modes.
  const download = new AuthClient(authUrl, token('download'))
  let r = await settle(() => download.checkIsAdmin('admin@rig.test'))
  row(
    'download checkIsAdmin',
    'resolves {"isAdmin":true}',
    r.text,
    r.ok && r.text.includes('"isAdmin":true'),
  )
  r = await settle(() =>
    download.getDiscordLink({ discordUserId: identity.discordUserId }),
  )
  row('download getDiscordLink', 'resolves', r.text, r.ok)
  r = await settle(() => download.registerDiscordIdentity(identity))
  row('download registerDiscordIdentity', 'resolves', r.text, r.ok)

  // 2. icloud-backup token: admin-check only.
  const icloud = new AuthClient(authUrl, token('icloud-backup'))
  r = await settle(() => icloud.checkIsAdmin('nobody@rig.test'))
  row(
    'icloud-backup checkIsAdmin',
    'resolves {"isAdmin":false}',
    r.text,
    r.ok && r.text.includes('"isAdmin":false'),
  )
  r = await settle(() => icloud.registerDiscordIdentity(identity))
  row(
    'icloud-backup registerDiscordIdentity',
    reject(403, 'POST /internal/discord-identity'),
    r.text,
    asExpected(r, 403, 'POST /internal/discord-identity'),
  )

  // 3. no token, then a token no caller holds.
  for (const [label, value] of [
    ['no token', ''],
    ['wrong token', token('wrong')],
  ]) {
    const client = new AuthClient(authUrl, value)
    r = await settle(() => client.checkIsAdmin('admin@rig.test'))
    row(
      `${label} checkIsAdmin`,
      reject(401, 'GET /admin/check'),
      r.text,
      asExpected(r, 401, 'GET /admin/check'),
    )
    r = await settle(() =>
      client.getDiscordLink({ discordUserId: identity.discordUserId }),
    )
    row(
      `${label} getDiscordLink`,
      reject(401, 'GET /internal/discord-link'),
      r.text,
      asExpected(r, 401, 'GET /internal/discord-link'),
    )
    r = await settle(() => client.registerDiscordIdentity(identity))
    row(
      `${label} registerDiscordIdentity`,
      reject(401, 'POST /internal/discord-identity'),
      r.text,
      asExpected(r, 401, 'POST /internal/discord-identity'),
    )
  }

  // 4. HostActivityService, the built class; it reads AUTH_URL and
  // AUTH_INTERNAL_TOKEN from the env per call. A fresh instance per case so
  // its 30 s cache cannot answer for the backend.
  process.env.AUTH_URL = authUrl
  const isActivity = a =>
    a !== null &&
    typeof a === 'object' &&
    typeof a.activeUsers === 'number' &&
    a.host === 'app.rig.test'
  process.env.AUTH_INTERNAL_TOKEN = token('dev')
  let activity = await new HostActivityService().get('app.rig.test', 2)
  row(
    'dev HostActivityService.get (dev token)',
    'activity object',
    JSON.stringify(activity),
    isActivity(activity),
  )
  delete process.env.AUTH_INTERNAL_TOKEN
  activity = await new HostActivityService().get('app.rig.test', 2)
  row(
    'dev HostActivityService.get (no token)',
    enforce ? 'null' : 'activity object',
    JSON.stringify(activity),
    enforce ? activity === null : isActivity(activity),
  )
}

function log() {
  const lines = readFileSync(0, 'utf8').split('\n')
  const entries = []
  let unparsed = 0
  for (const line of lines) {
    if (!line.includes('internal-auth')) continue
    try {
      const parsed = JSON.parse(line)
      if (parsed.event === 'internal-auth') entries.push(parsed)
    } catch {
      unparsed += 1
    }
  }
  row(
    'internal-auth lines',
    `${EXPECTED_LOG.length}, one per request`,
    `${entries.length} (unparsed ${unparsed})`,
    entries.length === EXPECTED_LOG.length && unparsed === 0,
  )
  EXPECTED_LOG.forEach(([outcome, caller, scope], i) => {
    const e = entries[i]
    const observed = e
      ? `outcome=${e.outcome} caller=${e.caller} scope=${e.scope} enforced=${e.enforced}`
      : '(no line)'
    row(
      `log line ${i + 1}`,
      `outcome=${outcome} caller=${caller} scope=${scope} enforced=${enforce}`,
      observed,
      !!e &&
        e.outcome === outcome &&
        e.caller === caller &&
        e.scope === scope &&
        e.enforced === enforce,
    )
  })
  const leaked = entries.filter(
    e => 'authorization' in e || 'token' in e || 'headers' in e,
  )
  row(
    'internal-auth lines carry no header/token field',
    '0',
    String(leaked.length),
    leaked.length === 0,
  )
}

if (command === 'clients') await clients()
else log()
process.exit(failed === 0 ? 0 : 1)
