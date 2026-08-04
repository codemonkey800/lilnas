import { env } from '@lilnas/utils/env'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { EnvKeys } from 'src/env'
import {
  findPreAuthorizedGrantsByEmail,
  findUserByEmail,
  grantExists,
  insertGrant,
  insertPreAuthorizedGrant,
} from 'src/grants/grants.repo'
import {
  DEFAULT_APPS_DIR,
  DEFAULT_INFRA_DIR,
  scanServiceRegistry,
} from 'src/services/service-registry.service'

import { applyPragmas, type Db, runMigrations } from './database.module'
import type { UserRow } from './schema'
import * as schema from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// U10 (R19): "existing WHITELIST members seeded into grants before the
// first router migrates." Deliberately does NOT hardcode "the 9
// currently-protected hosts" as a literal list — this repo's own history
// shows why that would already be wrong: infra/nexus-code-mbp.yml's
// forward-auth middleware was removed in commit 21b35e9 (Jul 23),
// predating this plan (dated Jul 31), so the plan's own "Verified facts"
// list (naming nexus-code-mbp) is stale against current infra/*.yml.
// scanServiceRegistry() (U8) IS the current, live truth of which routers
// carry forward-auth today — that is its entire purpose (R13's "adding a
// label is sufficient," extended by U8 to also record WHICH middleware
// gates each host) — so filtering its own output for `gatedBy ===
// 'forward-auth'` is both more correct and self-correcting against any
// future drift, rather than a second, independently-maintained source of
// truth that can only ever go stale again. (For the record, as of this
// unit, that resolves to 8 destination hosts — files, grafana, portal,
// prometheus, swole, tdr, traefik, yacht — not 9: `auth.lilnas.io` is
// excluded by the registry's own pre-existing HOST_BLOCKLIST, since it is
// the auth mechanism itself and has no grant concept, matching the plan's
// own "lilnas-auth's own router carries no auth middleware" decision.)
// ──────────────────────────────────────────────────────────────────────────────

export type SeedWhitelistSummary = {
  emailCount: number
  hostCount: number
  grantsWritten: number
}

// Mirrors src/admin/admin.guard.ts's isAdminEmail() normalization exactly
// (trim, lowercase, drop empties, comma-separated) — the same "a stray
// space or differing case in a hand-maintained env var shouldn't silently
// break matching" rationale applies here, and a whitelist entry's
// normalized form must equal whatever a real Google sign-in's `email`
// claim will be for bindPreAuthorizedGrant() (src/verify/
// access-cache.service.ts) to ever match it — that lookup is an exact
// Map-key comparison with no normalization of its own.
export function parseWhitelist(whitelistEnv: string): string[] {
  return [
    ...new Set(
      whitelistEnv
        .split(',')
        .map(entry => entry.trim().toLowerCase())
        .filter(Boolean),
    ),
  ]
}

// The plain, directly-testable seed — mirrors src/services/
// service-registry.service.ts's scanServiceRegistry() and src/auth/
// redirect.ts's resolveRedirectTarget() in taking every input as a
// parameter rather than reading env/DB-discovery internally. One
// BEGIN IMMEDIATE transaction for the WHOLE batch (not one per pair, the
// way src/admin/users.service.ts's preAuthorize() does for a single admin
// action) — this is genuinely one conceptual unit of work with no
// concurrent writers during a cutover seed run, so either every row lands
// or none do, rather than leaving a partial, ambiguous state if the
// process is killed mid-run.
//
// Reuses src/grants/grants.repo.ts's existing exports verbatim — the
// same two branches src/admin/users.service.ts's preAuthorize() already
// established (a real grant for an email with an existing `user` row, a
// pending pre_authorized_grant row otherwise) — rather than introducing a
// third, parallel write path for what is semantically identical to N
// individual pre-authorizations.
export function seedWhitelist(
  db: Db,
  emails: string[],
  protectedHosts: string[],
): SeedWhitelistSummary {
  const now = new Date()
  // Read outside the transaction, once per email — mirrors preAuthorize()'s
  // own "read via the plain db, write via tx" split, batched across every
  // email up front rather than repeated once per (email, host) pair.
  const existingUsersByEmail = new Map<string, UserRow>(
    emails
      .map((email): [string, UserRow | undefined] => [
        email,
        findUserByEmail(db, email),
      ])
      .filter((pair): pair is [string, UserRow] => pair[1] !== undefined),
  )

  let grantsWritten = 0
  db.transaction(
    tx => {
      for (const email of emails) {
        const existingUser = existingUsersByEmail.get(email)
        for (const host of protectedHosts) {
          if (existingUser) {
            if (grantExists(tx, existingUser.id, host)) continue
            insertGrant(tx, existingUser.id, host, now)
          } else {
            const alreadyPreAuthorized = findPreAuthorizedGrantsByEmail(
              tx,
              email,
            ).some(row => row.serviceHost === host)
            if (alreadyPreAuthorized) continue
            insertPreAuthorizedGrant(tx, email, host, now)
          }
          grantsWritten++
        }
      }
    },
    { behavior: 'immediate' },
  )

  return {
    emailCount: emails.length,
    hostCount: protectedHosts.length,
    grantsWritten,
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Standalone CLI entrypoint — run via `node dist/db/seed-whitelist.js`
// (after `pnpm run build`) against the deployed container, e.g.
// `docker-compose exec auth node dist/db/seed-whitelist.js`, with
// WHITELIST set to the REAL production value read from the deploy host's
// infra/.env.forward-auth (this checkout's copy is a placeholder — see the
// plan's own "Verified facts"). See docs/runbooks/lilnas-auth-cutover.md
// for the full procedure. Guarded by `require.main === module` so
// importing seedWhitelist()/parseWhitelist() for tests never runs this.
// ──────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dbPath = env(EnvKeys.DATABASE_PATH, './lilnas-auth.db')
  const sqlite = new BetterSqlite3(dbPath)
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  // Defensive, not load-bearing for the normal deploy order (the app has
  // almost always already booted, and migrated, by the time an operator
  // runs this) — but migrate() is idempotent, so this also makes the
  // script safe to run standalone against a freshly-created, empty DB
  // file without requiring the operator to reason about boot ordering.
  runMigrations(db)

  const emails = parseWhitelist(env(EnvKeys.WHITELIST, ''))
  if (emails.length === 0) {
    console.warn(
      'seed-whitelist: WHITELIST is empty or unset — nothing to seed. ' +
        'Set WHITELIST to the comma-separated list from the deploy host’s ' +
        'infra/.env.forward-auth before running this script.',
    )
  }

  const registry = await scanServiceRegistry(
    DEFAULT_APPS_DIR,
    DEFAULT_INFRA_DIR,
    { includeDevHosts: false },
  )
  const protectedHosts = registry
    .filter(entry => entry.gatedBy === 'forward-auth')
    .map(entry => entry.host)

  const summary = seedWhitelist(db, emails, protectedHosts)
  console.log(
    `seed-whitelist: protected hosts (${protectedHosts.length}) = ` +
      `${protectedHosts.join(', ') || '(none found)'}`,
  )
  console.log(
    `seed-whitelist: seeded ${summary.emailCount} whitelist member(s) ` +
      `across ${summary.hostCount} host(s) — ${summary.grantsWritten} new ` +
      'grant/pre-authorization row(s) written.',
  )

  sqlite.close()
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('seed-whitelist: failed', err)
    process.exitCode = 1
  })
}
