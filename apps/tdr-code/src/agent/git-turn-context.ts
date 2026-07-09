import fs from 'node:fs'
import path from 'node:path'

import { resolveGithubToken } from 'src/crypto/github-token-resolution'
import { isConfigured, resolveIdentity } from 'src/crypto/identity-resolution'
import { loadMasterKey } from 'src/crypto/master-key'
import type { Db } from 'src/db/database.module'
import { insertEvent } from 'src/db/events.repo'
import { getIdentity } from 'src/db/git-identity.repo'
import { getGithubCredentialByDiscordUserId } from 'src/db/github-credential.repo'
import type { EventType } from 'src/db/schema'
import { getBackendLogger } from 'src/logging/backend-logger'
import { LOG_EVENTS } from 'src/logging/log-events'

import type { AcpEventHandlers } from './agent.types'
import { globalGitWriteLock } from './git-write-lock'
import type { AxisStatus } from './turn-identity'
import { resolveTurnIdentity } from './turn-identity'

// Non-DI (plain class, instantiated via `new` in SessionManagerService's
// constructor, not DI) — module-scope since sweep() is static and cannot use
// `this`. Uses getBackendLogger() (src/logging/backend-logger.ts), fetched
// AT LOG TIME inside each method body below, never at module-eval time.

// Tmpfs directory for per-turn key files (Decision #6).
// /run is preferred over /dev/shm (often world-accessible).
// Override TDR_CODE_RUN_DIR for local dev on macOS (e.g. /tmp/tdr-code).
const RUN_DIR = process.env.TDR_CODE_RUN_DIR ?? '/run/tdr-code'
const KEYS_DIR = `${RUN_DIR}/keys`

// Tmpfs directory for per-turn identity files read by the git PATH wrapper.
const IDENTITY_DIR = `${RUN_DIR}/identity`

// Path to the SSH blocking wrapper (Decision #6).
// Resolved relative to this file so it works in both source and dist.
const WRAPPER_SCRIPT = path.resolve(
  __dirname,
  '../../scripts/git-ssh-wrapper.sh',
)

// ──────────────────────────────────────────────────────────────────────────────
// Per-turn identity context — one instance shared across all channels.
// ──────────────────────────────────────────────────────────────────────────────

export interface GitTurnContextOptions {
  db: Db
  generationId: number | null
  // U5: fan-out target for the Discord-visible block notice — the same
  // AcpEventHandlers instance SessionManagerService already holds via its
  // own ACP_EVENT_HANDLERS injection. GitTurnContext is a plain class (not
  // DI-instantiated), so this is threaded through the options object rather
  // than @Inject'd directly.
  handlers: AcpEventHandlers
}

// State per channel's active turn (cleared at turn end).
interface TurnState {
  channelId: string
  keyPath: string | null
  identityDir: string | null
  release: (() => void) | null
}

export class GitTurnContext {
  private readonly activeTurns = new Map<string, TurnState>()
  // Per-process deduplication: once a channel+axis pair has received a Discord
  // block notice this bot generation, skip subsequent notices so fully-
  // unconfigured users don't get spammed on every turn.
  private readonly notifiedBlockChannels = new Set<string>()

  constructor(private readonly opts: GitTurnContextOptions) {}

  // Call AFTER executePrompt's synchronous prologue and AFTER gitLock.acquire().
  // Writes identity files to tmpfs and (for configured users) decrypts the key.
  // The lock must already be held by the caller (executePrompt passes the release fn).
  async begin(
    channelId: string,
    userId: string,
    release: () => void,
  ): Promise<void> {
    // Defensive mkdir — /run dirs are wiped on reboot; a missing dir would
    // silently block every configured turn (Decision #4 risk note).
    try {
      fs.mkdirSync(KEYS_DIR, { recursive: true, mode: 0o700 })
      fs.mkdirSync(IDENTITY_DIR, { recursive: true, mode: 0o700 })
    } catch (err) {
      // Ignore if already exists — plain filesystem mkdir errors on a fixed
      // tmpfs path (EEXIST/EACCES/...), not secret-bearing, so { err } is safe.
      getBackendLogger().debug(
        { channelId, err },
        'KEYS_DIR/IDENTITY_DIR mkdir failed (may already exist)',
      )
    }

    const masterKey = loadMasterKey()
    const row = getIdentity(this.opts.db, userId)
    const resolution = resolveIdentity(row, masterKey)
    // GitHub axis (Plan A U1) — resolved with the SAME masterKey already
    // loaded above for the SSH axis; no second loadMasterKey() call needed.
    const githubRow = getGithubCredentialByDiscordUserId(this.opts.db, userId)
    const githubResolution = resolveGithubToken(githubRow, masterKey)
    // U1: compose both already-resolved axes into the single combined
    // decision the rest of this method applies — see turn-identity.ts for
    // the full precedence rationale (GitHub wins commit name/email once
    // configured; identityConfigured generalizes the `configured` marker
    // below to "either axis," not SSH alone).
    const turnIdentity = resolveTurnIdentity(
      resolution,
      githubResolution,
      userId,
    )
    getBackendLogger().debug(
      {
        channelId,
        sshStatus: turnIdentity.sshStatus,
        githubStatus: turnIdentity.githubStatus,
        fingerprint:
          resolution.kind !== 'unconfigured'
            ? resolution.fingerprint
            : undefined,
      },
      'Git identity resolved for turn',
    )

    const state: TurnState = {
      channelId,
      keyPath: null,
      identityDir: null,
      release,
    }
    this.activeTurns.set(channelId, state)

    const idDir = path.join(IDENTITY_DIR, channelId)
    // Belt-and-suspenders: nuke any stale contents from a prior turn whose
    // end()/sweep() best-effort rm did not succeed. Without this, an
    // axis-conditional writeFileSync below (github_token, signing_key,
    // configured, gh_configured, ssh_command) that the current turn does NOT
    // write silently inherits whatever the previous turn left there.
    try {
      fs.rmSync(idDir, { recursive: true, force: true })
    } catch {
      /* fresh mkdir below */
    }
    fs.mkdirSync(idDir, { recursive: true, mode: 0o700 })
    state.identityDir = idDir

    // name/email now come from the combined TurnIdentity decision (U1) for
    // EVERY branch — GitHub-derived when linked, else SSH-derived, else the
    // same blocked-placeholder strings this file always wrote directly
    // (turn-identity.ts's blockedPlaceholder() is byte-for-byte compatible
    // with the old inline `userId` / `${userId}@unconfigured` values).
    fs.writeFileSync(path.join(idDir, 'name'), turnIdentity.commitName, {
      mode: 0o600,
    })
    fs.writeFileSync(path.join(idDir, 'email'), turnIdentity.commitEmail, {
      mode: 0o600,
    })

    if (isConfigured(resolution)) {
      // Write key to tmpfs, then write identity files for the git wrapper.
      const keyPath = path.join(KEYS_DIR, `${channelId}.key`)
      fs.writeFileSync(keyPath, resolution.keyPlaintext, { mode: 0o600 })
      // Best-effort zeroize plaintext.
      resolution.keyPlaintext.fill(0)
      state.keyPath = keyPath

      const sshCommand =
        `ssh -i ${keyPath}` +
        ` -o IdentitiesOnly=yes` +
        ` -o StrictHostKeyChecking=accept-new` +
        ` -F /dev/null` +
        // Disable connection multiplexing — without this, a prior turn's
        // authenticated connection can bleed into the next turn's SSH session,
        // defeating per-turn attribution (Decision #6).
        ` -o ControlMaster=no` +
        ` -o ControlPath=none`

      fs.writeFileSync(path.join(idDir, 'ssh_command'), sshCommand, {
        mode: 0o600,
      })
      // Commit signing (SSH format) — the wrapper points user.signingKey at
      // this same tmpfs key file. Safe to use directly (no ssh-agent) because
      // validateAndFingerprint already rejected passphrase-protected keys.
      fs.writeFileSync(path.join(idDir, 'signing_key'), keyPath, {
        mode: 0o600,
      })
    } else {
      // No SSH identity or decrypt failure → point GIT_SSH_COMMAND at the
      // blocking wrapper. This is independent of the GitHub axis: a
      // GitHub-only user still gets this (they simply have no SSH key to
      // push to a non-GitHub remote or sign with), which is exactly R10's
      // "SSH key required only for non-GitHub remotes / signing" contract.
      fs.writeFileSync(path.join(idDir, 'ssh_command'), WRAPPER_SCRIPT, {
        mode: 0o600,
      })
    }

    if (turnIdentity.githubToken !== null) {
      // GitHub axis configured — write the per-turn HTTPS push credential /
      // `gh` auth token to tmpfs, mirroring the SSH key's mode-0600 tmpfs
      // write above. Read by scripts/gh (GH_TOKEN) and scripts/git's
      // credential.https://github.com.helper injection.
      fs.writeFileSync(
        path.join(idDir, 'github_token'),
        turnIdentity.githubToken,
        { mode: 0o600 },
      )
      // Best-effort zeroize plaintext, mirroring resolution.keyPlaintext.fill(0)
      // above — this is exactly why turn-identity.ts kept githubToken as a
      // Buffer rather than a string.
      turnIdentity.githubToken.fill(0)
      // Positive gate signal for scripts/gh and the HTTPS credential-helper
      // injection specifically — presence, not content, is the gate (content
      // is an arbitrary debug marker, mirroring `configured` below).
      fs.writeFileSync(path.join(idDir, 'gh_configured'), 'true', {
        mode: 0o600,
      })
    }

    if (turnIdentity.identityConfigured) {
      // Positive gate signal for the `scripts/git` PATH wrapper's local-write
      // block: presence means "this turn has SOME way to attribute/push
      // commits" — GitHub OR SSH (U1's identityConfigured), NOT SSH alone.
      // CRITICAL: this is the fix for the gap the plan's Key Technical
      // Decisions/Open Questions called out at length — leaving this keyed
      // to `isConfigured(resolution)` (SSH only) would wrongly block a
      // GitHub-only user (no SSH key at all) at scripts/git's pre-existing
      // verb-block, contradicting AE3/R9/R10. Content (fingerprint when SSH
      // is the configured axis, else a stable debug value) is a free debug
      // value per the header comment in scripts/git — presence is what
      // matters, not content. Deliberately NOT written when
      // identityConfigured is false, so the wrapper's check defaults to
      // blocked (fail-closed) if this write is ever skipped.
      fs.writeFileSync(
        path.join(idDir, 'configured'),
        resolution.kind === 'configured' ? resolution.fingerprint : 'github',
        { mode: 0o600 },
      )
    }

    // U5 (R16): structured block-event logging + Discord-visible notice, one
    // call per axis, ONLY when that axis did NOT resolve to `configured` AND
    // the combined identity is also not configured — a single-axis-configured
    // user has SOMETHING attributable/pushable and should not get per-turn
    // block notices for the OTHER axis they intentionally left unconfigured.
    // Discord notices are further deduplicated per channel+axis per bot
    // generation via notifiedBlockChannels (see logBlockEvent) so even
    // fully-unconfigured users only see the notice once, not every turn.
    if (!turnIdentity.identityConfigured) {
      if (turnIdentity.sshStatus !== 'configured') {
        this.logBlockEvent(
          channelId,
          userId,
          'ssh',
          turnIdentity.sshStatus,
          turnIdentity.sshStatus === 'decrypt_failed'
            ? 'git_key_decrypt_failed'
            : 'git_push_blocked',
        )
      }
      if (turnIdentity.githubStatus !== 'configured') {
        this.logBlockEvent(
          channelId,
          userId,
          'github',
          turnIdentity.githubStatus,
          turnIdentity.githubStatus === 'decrypt_failed'
            ? 'github_token_decrypt_failed'
            : 'gh_blocked',
        )
      }
    }
  }

  // U5: shared by both axis branches in begin() above — inserts the
  // structured block/decrypt-failure event, then (only after that insert
  // succeeds, still inside the same try) fans out the Discord-visible
  // notice via AcpEventHandlers. Never lets a fault on either half crash the
  // turn: a DB error degrades to log-only via the registered
  // gitBlockEventInsertFailed slug (mirrors composite-acp-handler.ts's
  // handleWriterError double-fault posture exactly), and a synchronous
  // handler-side throw (shouldn't happen given CompositeAcpHandler's own
  // internal try/catch fan-out, but defense in depth costs one more
  // try/catch) is swallowed rather than propagated.
  private logBlockEvent(
    channelId: string,
    userId: string,
    kind: 'ssh' | 'github',
    status: AxisStatus,
    type: EventType,
  ): void {
    // reason is never 'configured' here — callers only invoke this when
    // status !== 'configured' — but AxisStatus is a 3-member union, so this
    // narrows for the AcpEventHandlers call below without a cast.
    const reason: 'unconfigured' | 'decrypt_failed' =
      status === 'decrypt_failed' ? 'decrypt_failed' : 'unconfigured'

    if (this.opts.generationId == null) return
    try {
      // context carries ONLY safe scalars (discordUserId, channelId) —
      // NEVER err/err.message/anything derived from the decrypt failure.
      // This context object is written verbatim to a column the console UI
      // surfaces, a MORE persistent exposure surface than a pino log line,
      // so the structured-logging convention's "never put decrypt-failure
      // detail on a key-material-adjacent path" rule applies here too.
      insertEvent(this.opts.db, {
        generationId: this.opts.generationId,
        channelId,
        type,
        level: 'warn',
        context: { discordUserId: userId, channelId },
        createdAt: new Date(),
      })
      // Notify AFTER the DB insert succeeds, still inside this try — mirrors
      // composite-acp-handler.ts's own "notify after the write succeeds"
      // convention. Discord notice is deduplicated per channel+axis per bot
      // generation: once a channel has been told its axis is blocked, skip
      // subsequent per-turn repeats (the DB insert above still runs every
      // turn for operator observability).
      const notifyKey = `${channelId}:${kind}`
      if (!this.notifiedBlockChannels.has(notifyKey)) {
        this.notifiedBlockChannels.add(notifyKey)
        try {
          this.opts.handlers.onGitOperationBlocked(channelId, kind, reason)
        } catch (err) {
          getBackendLogger().debug(
            { channelId, kind, reason, err },
            'onGitOperationBlocked handler threw (swallowed)',
          )
        }
      }
    } catch (err) {
      getBackendLogger().warn(
        {
          event: LOG_EVENTS.gitBlockEventInsertFailed,
          channelId,
          kind,
          reason,
          type,
          err,
        },
        'Block/decrypt-failure event insert failed (log-only, no retry)',
      )
    }
  }

  // Call at the TOP of executePrompt's finally block, before the drain guard.
  // Releases the lock first, then removes tmpfs files (Decision #4 ordering).
  end(channelId: string): void {
    const state = this.activeTurns.get(channelId)
    if (!state) return
    this.activeTurns.delete(channelId)

    // 1. Release the lock synchronously first.
    if (state.release) {
      state.release()
      state.release = null
    }

    // 2. Best-effort async key removal.
    if (state.keyPath) {
      const kp = state.keyPath
      state.keyPath = null
      try {
        fs.rmSync(kp, { force: true })
      } catch (err) {
        // Ignore — sweep() will catch orphans on next boot. keyPath is a
        // tmpfs PATH (never key bytes), but is logged under the field name
        // `keyPath` deliberately — that's one of backend-logger.ts's own
        // poison-pill redact paths (defense-in-depth against a future edit
        // that starts putting key content there instead of just a path).
        getBackendLogger().debug(
          { channelId, keyPath: kp, err },
          'Tmpfs key removal failed (sweep will catch orphan)',
        )
      }
    }

    // 3. Best-effort identity dir removal.
    if (state.identityDir) {
      const idDir = state.identityDir
      state.identityDir = null
      try {
        fs.rmSync(idDir, { recursive: true, force: true })
      } catch (err) {
        // Ignore — sweep() will catch orphans on next boot
        getBackendLogger().debug(
          { channelId, identityDir: idDir, err },
          'Tmpfs identity dir removal failed (sweep will catch orphan)',
        )
      }
    }
  }

  // Belt-and-suspenders: called from force-kill paths (teardown, proc error/exit,
  // onApplicationShutdown). Releases the lock only if this channel holds it;
  // idempotent with end().
  abort(channelId: string): void {
    const state = this.activeTurns.get(channelId)
    if (state) {
      this.activeTurns.delete(channelId)
      if (state.release) {
        state.release = null
      }
      if (state.keyPath) {
        const kp = state.keyPath
        state.keyPath = null
        try {
          fs.rmSync(kp, { force: true })
        } catch {
          /* ignore */
        }
      }
      if (state.identityDir) {
        const idDir = state.identityDir
        state.identityDir = null
        try {
          fs.rmSync(idDir, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      }
    }
    globalGitWriteLock.releaseIfHeldBy(channelId)
  }

  // Boot-time and shutdown sweep — removes all orphaned tmpfs files from a
  // previous crash. Tmpfs is also wiped on reboot, but this handles restarts
  // without a reboot.
  static sweep(): void {
    let keysRemoved = 0
    let identityDirsRemoved = 0

    try {
      if (fs.existsSync(KEYS_DIR)) {
        const files = fs.readdirSync(KEYS_DIR)
        for (const file of files) {
          if (file.endsWith('.key')) {
            try {
              fs.rmSync(path.join(KEYS_DIR, file), { force: true })
              keysRemoved++
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      /* ignore */
    }

    try {
      if (fs.existsSync(IDENTITY_DIR)) {
        const entries = fs.readdirSync(IDENTITY_DIR, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            try {
              fs.rmSync(path.join(IDENTITY_DIR, entry.name), {
                recursive: true,
                force: true,
              })
              identityDirsRemoved++
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      /* ignore */
    }

    getBackendLogger().info(
      {
        event: LOG_EVENTS.gitIdentitySweepComplete,
        keysRemoved,
        identityDirsRemoved,
      },
      'Boot/shutdown sweep of orphaned tmpfs files complete',
    )
  }
}
