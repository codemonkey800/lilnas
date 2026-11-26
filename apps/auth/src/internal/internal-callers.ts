import { EnvKeys } from 'src/env'

// ──────────────────────────────────────────────────────────────────────────────
// Who may call this app's internal (server-to-server) routes, and what each
// caller may do. InternalTokenGuard knows a caller only by its bearer token:
// the value of the env var named here. A scope names one route; the guarded
// handler declares the scope it needs with @RequireInternalScope().
//
// Adding a caller: add a token env var to src/env.ts, a row here with the
// fewest scopes it needs, a production value in .env.prod, and the same value
// as AUTH_INTERNAL_TOKEN in the caller's own env. See the README's
// "Internal routes" section.
// ──────────────────────────────────────────────────────────────────────────────

export const INTERNAL_SCOPES = [
  // GET /admin/check
  'admin-check',
  // GET /internal/discord-link
  'discord-link:read',
  // POST /internal/discord-identity
  'discord-identity:write',
  // GET /internal/host-activity
  'host-activity:read',
] as const

export type InternalScope = (typeof INTERNAL_SCOPES)[number]

export type InternalCaller = {
  tokenEnv: string
  scopes: readonly InternalScope[]
}

export const INTERNAL_CALLERS: Record<string, InternalCaller> = {
  download: {
    tokenEnv: EnvKeys.INTERNAL_TOKEN_DOWNLOAD,
    scopes: ['admin-check', 'discord-link:read', 'discord-identity:write'],
  },
  'icloud-backup': {
    tokenEnv: EnvKeys.INTERNAL_TOKEN_ICLOUD_BACKUP,
    scopes: ['admin-check'],
  },
  dev: {
    tokenEnv: EnvKeys.INTERNAL_TOKEN_DEV,
    scopes: ['host-activity:read'],
  },
  'dev-idle-reaper': {
    tokenEnv: EnvKeys.INTERNAL_TOKEN_DEV_IDLE_REAPER,
    scopes: ['host-activity:read'],
  },
}
