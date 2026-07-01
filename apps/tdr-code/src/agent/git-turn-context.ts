import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

import { resolveIdentity, isConfigured } from 'src/crypto/identity-resolution'
import { loadMasterKey } from 'src/crypto/master-key'
import { getIdentity } from 'src/db/git-identity.repo'
import type { Db } from 'src/db/database.module'
import { insertEvent } from 'src/db/events.repo'
import type { AcpEventHandlers } from './agent.types'

import { globalGitWriteLock } from './git-write-lock'

// Tmpfs directory for per-turn key files (Decision #6).
// /run is preferred over /dev/shm (often world-accessible).
const KEYS_DIR = '/run/tdr-code/keys'

// Path to the SSH blocking wrapper (Decision #6).
// Resolved relative to this file so it works in both source and dist.
const WRAPPER_SCRIPT = path.resolve(
  __dirname,
  '../../scripts/git-ssh-wrapper.sh',
)

// Path to the shared workspace .git config (written per-turn under the lock).
function gitConfigPath(cwd: string): string {
  return path.join(cwd, '.git', 'config')
}

// ──────────────────────────────────────────────────────────────────────────────
// Per-turn identity context — one instance shared across all channels.
// ──────────────────────────────────────────────────────────────────────────────

export interface GitTurnContextOptions {
  db: Db
  generationId: number | null
  cwd: string
  handlers: AcpEventHandlers
  onGitPushBlocked?: (channelId: string, reason: string) => void
}

// State per channel's active turn (cleared at turn end).
interface TurnState {
  channelId: string
  keyPath: string | null
  release: (() => void) | null
}

export class GitTurnContext {
  private readonly activeTurns = new Map<string, TurnState>()

  constructor(private readonly opts: GitTurnContextOptions) {}

  // Call AFTER executePrompt's synchronous prologue and AFTER gitLock.acquire().
  // Writes identity to .git/config and decrypts a key to tmpfs.
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
    } catch {
      // Ignore if already exists
    }

    const masterKey = loadMasterKey()
    const row = getIdentity(this.opts.db, userId)
    const resolution = resolveIdentity(row, masterKey)

    const state: TurnState = {
      channelId,
      keyPath: null,
      release,
    }
    this.activeTurns.set(channelId, state)

    const { db, generationId, cwd } = this.opts

    if (isConfigured(resolution)) {
      // Write key to tmpfs, then set .git/config.
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

      applyGitConfig(cwd, resolution.name, resolution.email, sshCommand)
    } else {
      // No identity or decrypt failure → install the blocking wrapper.
      applyGitConfig(cwd, userId, `${userId}@unconfigured`, WRAPPER_SCRIPT)

      const reason =
        resolution.kind === 'decrypt_failed'
          ? 'key_decrypt_failed'
          : 'unconfigured'

      // Emit enforcement events. Guard on generationId (schema writer invariant).
      if (generationId != null) {
        try {
          insertEvent(db, {
            generationId,
            channelId,
            sessionId: null,
            type:
              resolution.kind === 'decrypt_failed'
                ? 'git_key_decrypt_failed'
                : 'git_push_blocked',
            level: 'warn',
            context: {
              discordUserId: userId,
              reason,
              // fingerprint is safe to log (plaintext in backup); keyPath/ciphertext/iv/authTag are NOT
              ...(resolution.kind === 'decrypt_failed'
                ? { keyFingerprint: resolution.fingerprint }
                : {}),
            },
            createdAt: new Date(),
          })
        } catch {
          // Best-effort — never fail the turn for a logging error
        }
      }
    }
  }

  // Call at the TOP of executePrompt's finally block, before the drain guard.
  // Releases the lock first, then removes the tmpfs key (Decision #4 ordering).
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
      } catch {
        // Ignore — sweep() will catch orphans on next boot
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
        } catch { /* ignore */ }
      }
    }
    globalGitWriteLock.releaseIfHeldBy(channelId)
  }

  // Boot-time and shutdown sweep — removes all orphaned key files in KEYS_DIR.
  // Tmpfs is also wiped on reboot, but this handles restarts without a reboot.
  static sweep(): void {
    try {
      if (!fs.existsSync(KEYS_DIR)) return
      const files = fs.readdirSync(KEYS_DIR)
      for (const file of files) {
        if (file.endsWith('.key')) {
          try {
            fs.rmSync(path.join(KEYS_DIR, file), { force: true })
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
}

// ──────────────────────────────────────────────────────────────────────────────

function applyGitConfig(
  cwd: string,
  name: string,
  email: string,
  sshCommand: string,
): void {
  // Use `git config --local` for atomic writes — serialized by the lock.
  execFileSync('git', ['config', '--local', 'user.name', name], { cwd })
  execFileSync('git', ['config', '--local', 'user.email', email], { cwd })
  execFileSync('git', ['config', '--local', 'core.sshCommand', sshCommand], {
    cwd,
  })
}
