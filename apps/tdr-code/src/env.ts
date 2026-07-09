export const EnvKeys = {
  BACKEND_PORT: 'BACKEND_PORT',
  // Phase C: path to the 32-byte AES-256-GCM master key file (chmod 600,
  // outside the Tier-1 backup tree).
  TDR_CODE_MASTER_KEY_FILE: 'TDR_CODE_MASTER_KEY_FILE',
  DISCORD_API_TOKEN: 'DISCORD_API_TOKEN',
  DISCORD_GUILD_ID: 'DISCORD_GUILD_ID',
  // Phase D: Discord OAuth2 app credentials (Better Auth Discord provider).
  // Distinct from DISCORD_API_TOKEN (the bot token) — these come from the
  // same Discord Application's OAuth2 page, not the Bot page.
  DISCORD_CLIENT_ID: 'DISCORD_CLIENT_ID',
  DISCORD_CLIENT_SECRET: 'DISCORD_CLIENT_SECRET',
  // GitHub-linking plan (U2): GitHub OAuth App credentials (Better Auth
  // GitHub provider), used for self-service account-linking, not bot auth.
  // These come from a dedicated GitHub OAuth App's page, distinct from any
  // GitHub bot/PAT token this app might use elsewhere.
  GITHUB_CLIENT_ID: 'GITHUB_CLIENT_ID',
  GITHUB_CLIENT_SECRET: 'GITHUB_CLIENT_SECRET',
  // Phase D: Better Auth session-signing secret (generated, not from Discord)
  // and the app's public base URL used to build OAuth redirect URIs and
  // derive secure-cookie defaults.
  BETTER_AUTH_SECRET: 'BETTER_AUTH_SECRET',
  BETTER_AUTH_URL: 'BETTER_AUTH_URL',
  // Dev-only agent login (see PLAN.md / dev-login.plugin.ts). Both must be
  // set, and only ever in local dev — buildAuth() throws if
  // TDR_CODE_DEV_LOGIN is set while NODE_ENV=production.
  TDR_CODE_DEV_LOGIN: 'TDR_CODE_DEV_LOGIN',
  TDR_CODE_DEV_LOGIN_SECRET: 'TDR_CODE_DEV_LOGIN_SECRET',
  NODE_ENV: 'NODE_ENV',
  CLAUDE_COMMAND: 'CLAUDE_COMMAND',
  CLAUDE_CWD: 'CLAUDE_CWD',
  // Model passed to the spawned Claude agent subprocess (the ACP wrapper
  // reads this directly). Unset -> session-manager.service.ts defaults it
  // to 'sonnet[1m]'. Set a real value here to override the bot-wide default.
  ANTHROPIC_MODEL: 'ANTHROPIC_MODEL',
  AGENT_IDLE_TIMEOUT_SECONDS: 'AGENT_IDLE_TIMEOUT_SECONDS',
  AGENT_MAX_SESSIONS: 'AGENT_MAX_SESSIONS',
  // Phase A: two-process substrate
  DATABASE_PATH: 'DATABASE_PATH',
  BOT_GENERATION_ID: 'BOT_GENERATION_ID',
  SUPERVISE_BOT: 'SUPERVISE_BOT',
  // Supervisor timing knobs (all in milliseconds unless named _SECONDS)
  SUPERVISOR_START_TIMEOUT_MS: 'SUPERVISOR_START_TIMEOUT_MS',
  SUPERVISOR_SIGKILL_GRACE_MS: 'SUPERVISOR_SIGKILL_GRACE_MS',
  SUPERVISOR_STABLE_WINDOW_MS: 'SUPERVISOR_STABLE_WINDOW_MS',
  SUPERVISOR_BACKOFF_BASE_MS: 'SUPERVISOR_BACKOFF_BASE_MS',
  SUPERVISOR_BACKOFF_MAX_MS: 'SUPERVISOR_BACKOFF_MAX_MS',
  SUPERVISOR_CRASH_LOOP_WINDOW_MS: 'SUPERVISOR_CRASH_LOOP_WINDOW_MS',
  SUPERVISOR_CRASH_LOOP_THRESHOLD: 'SUPERVISOR_CRASH_LOOP_THRESHOLD',
  SUPERVISOR_LIVENESS_POLL_MS: 'SUPERVISOR_LIVENESS_POLL_MS',
  // Bot heartbeat + command poller timing
  BOT_HEARTBEAT_MS: 'BOT_HEARTBEAT_MS',
  BOT_COMMAND_POLL_MS: 'BOT_COMMAND_POLL_MS',
  // Heartbeat staleness threshold = heartbeatMs + busy_timeout + margin
  BOT_HEARTBEAT_STALE_THRESHOLD_MS: 'BOT_HEARTBEAT_STALE_THRESHOLD_MS',
  // SSE push (U1): the data_version backstop cadence (dropped-notify
  // catch-up for row changes), the derived-status recompute cadence (kept
  // <= staleThresholdMs() so the online/offline flip stays within budget),
  // and the per-connection keepalive interval. Main-process only — no
  // buildBotEnv allowlist entry (the bot never reads these).
  SSE_FALLBACK_INTERVAL_MS: 'SSE_FALLBACK_INTERVAL_MS',
  SSE_STALENESS_RECOMPUTE_MS: 'SSE_STALENESS_RECOMPUTE_MS',
  SSE_KEEPALIVE_MS: 'SSE_KEEPALIVE_MS',
  // Logs viewer (U2): the windowed-read endpoint's byte-size cap, clamped
  // server-side regardless of what a client requests. Main-process only —
  // no buildBotEnv allowlist entry (the bot never reads log files itself).
  LOG_WINDOW_MAX_BYTES: 'LOG_WINDOW_MAX_BYTES',
  // Logs viewer, Phase 2 U8 (append-delta tail push endpoint): the
  // debounce window for coalescing fs.watch's duplicate 'change' events per
  // write (nodejs/node#3042), the per-connection keepalive cadence (mirrors
  // SSE_KEEPALIVE_MS's role for the unrelated /api/stream endpoint, but this
  // is the tail's OWN knob — the two endpoints share no config), and a flag
  // to switch the watcher to fs.watchFile's polling mode for exotic mounts
  // (NFS/osxfs) where fs.watch's native inotify/kqueue backend is
  // unreliable or unavailable. All main-process only — no buildBotEnv
  // allowlist entry (the bot process never serves the tail endpoint).
  LOG_TAIL_DEBOUNCE_MS: 'LOG_TAIL_DEBOUNCE_MS',
  LOG_TAIL_KEEPALIVE_MS: 'LOG_TAIL_KEEPALIVE_MS',
  LOG_TAIL_POLL_FALLBACK: 'LOG_TAIL_POLL_FALLBACK',
} as const
