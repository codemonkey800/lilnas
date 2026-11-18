// Inserts a user and a session into a THROWAWAY lilnas-auth database and
// prints a signed session cookie that the running backend accepts.
//
// Never point it at a real database: it refuses a DATABASE_PATH under /data
// or /storage (after resolving symlinks) and exits non-zero.
//
// Signing mirrors Better Auth 1.7.12 (dist/cookies/index.mjs setSessionCookie
// -> better-call's signCookieValue): the cookie value is
//   encodeURIComponent(`${token}.${base64(HMAC-SHA256(secret, token))}`)
// and the cookie is named `lilnas-auth.session_token`, with a `__Secure-`
// prefix when AUTH_HOST is https (src/auth/cookie-names.ts).
//
// Env: DATABASE_PATH, BETTER_AUTH_SECRET, AUTH_HOST (required);
//      MINT_EMAIL (default cookie-rig@example.test).
// Output: the `name=value` pair on stdout; with --json an object
//      { name, value, pair, email, userId } instead. The migrated schema must
//      already exist: start the backend once first.

import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FORBIDDEN_ROOTS = ['/data', '/storage']
const SESSION_TTL_MS = 60 * 60 * 1000

function fail(message) {
  console.error(`mint-session: ${message}`)
  process.exit(1)
}

function required(name) {
  const value = process.env[name]
  if (!value) fail(`${name} is required`)
  return value
}

function resolveDatabasePath(raw) {
  const absolute = path.resolve(raw)
  // Resolve the longest existing ancestor so a symlink into /storage cannot
  // hide behind a harmless-looking path.
  let probe = absolute
  while (!existsSync(probe) && probe !== path.dirname(probe)) {
    probe = path.dirname(probe)
  }
  const real = path.join(realpathSync(probe), path.relative(probe, absolute))
  for (const candidate of [absolute, real]) {
    if (
      FORBIDDEN_ROOTS.some(
        root => candidate === root || candidate.startsWith(`${root}/`),
      )
    ) {
      fail(`refusing to touch ${candidate}: only throwaway databases`)
    }
  }
  if (!existsSync(absolute)) fail(`${absolute} does not exist`)
  return absolute
}

const databasePath = resolveDatabasePath(required('DATABASE_PATH'))
const secret = required('BETTER_AUTH_SECRET')
const authHost = required('AUTH_HOST')
const email = process.env.MINT_EMAIL ?? 'cookie-rig@example.test'

// better-sqlite3 lives in apps/auth/node_modules.
const requireFromApp = createRequire(
  path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../package.json',
  ),
)
const Database = requireFromApp('better-sqlite3')

const cookieName = `${
  new URL(authHost).protocol === 'https:' ? '__Secure-' : ''
}lilnas-auth.session_token`

const token = randomBytes(24).toString('base64url')
const signature = createHmac('sha256', secret).update(token).digest('base64')
const value = encodeURIComponent(`${token}.${signature}`)

const userId = randomUUID()
const now = Date.now()
const db = new Database(databasePath)
try {
  db.pragma('busy_timeout = 5000')
  db.transaction(() => {
    db.prepare(
      `INSERT INTO user (id, name, email, email_verified, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?)`,
    ).run(userId, 'Cookie Rig', email, now, now)
    db.prepare(
      `INSERT INTO session (id, expires_at, token, created_at, updated_at, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(randomUUID(), now + SESSION_TTL_MS, token, now, now, userId)
  })()
} finally {
  db.close()
}

const pair = `${cookieName}=${value}`
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ name: cookieName, value, pair, email, userId }))
} else {
  console.log(pair)
}
