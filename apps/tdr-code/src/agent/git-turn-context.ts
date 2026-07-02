import fs from 'node:fs'
import path from 'node:path'

import { isConfigured, resolveIdentity } from 'src/crypto/identity-resolution'
import { loadMasterKey } from 'src/crypto/master-key'
import type { Db } from 'src/db/database.module'
import { getIdentity } from 'src/db/git-identity.repo'

import { globalGitWriteLock } from './git-write-lock'

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
    } catch {
      // Ignore if already exists
    }

    const masterKey = loadMasterKey()
    const row = getIdentity(this.opts.db, userId)
    const resolution = resolveIdentity(row, masterKey)

    const state: TurnState = {
      channelId,
      keyPath: null,
      identityDir: null,
      release,
    }
    this.activeTurns.set(channelId, state)

    const { db, generationId } = this.opts
    const idDir = path.join(IDENTITY_DIR, channelId)

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

      fs.mkdirSync(idDir, { recursive: true, mode: 0o700 })
      fs.writeFileSync(path.join(idDir, 'name'), resolution.name, {
        mode: 0o600,
      })
      fs.writeFileSync(path.join(idDir, 'email'), resolution.email, {
        mode: 0o600,
      })
      fs.writeFileSync(path.join(idDir, 'ssh_command'), sshCommand, {
        mode: 0o600,
      })
      state.identityDir = idDir
    } else {
      // No identity or decrypt failure → write identity files with blocking wrapper.
      const reason =
        resolution.kind === 'decrypt_failed'
          ? 'key_decrypt_failed'
          : 'unconfigured'

      fs.mkdirSync(idDir, { recursive: true, mode: 0o700 })
      fs.writeFileSync(path.join(idDir, 'name'), userId, { mode: 0o600 })
      fs.writeFileSync(path.join(idDir, 'email'), `${userId}@unconfigured`, {
        mode: 0o600,
      })
      fs.writeFileSync(path.join(idDir, 'ssh_command'), WRAPPER_SCRIPT, {
        mode: 0o600,
      })
      state.identityDir = idDir
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
      } catch {
        // Ignore — sweep() will catch orphans on next boot
      }
    }

    // 3. Best-effort identity dir removal.
    if (state.identityDir) {
      const idDir = state.identityDir
      state.identityDir = null
      try {
        fs.rmSync(idDir, { recursive: true, force: true })
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
    try {
      if (fs.existsSync(KEYS_DIR)) {
        const files = fs.readdirSync(KEYS_DIR)
        for (const file of files) {
          if (file.endsWith('.key')) {
            try {
              fs.rmSync(path.join(KEYS_DIR, file), { force: true })
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
            } catch {
              /* ignore */
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }
}
