import { Command, Flags } from '@oclif/core'
import * as fs from 'fs'
import * as path from 'path'

import { getMonorepoRoot } from '../../utils/paths'
import {
  decryptedPathFor,
  decryptEnvFile,
  dotenvxBin,
  gitTrackedFiles,
  listEncryptedEnvFiles,
  writeFileAtomic0600,
} from '../../utils/secrets'

export class SecretsDecrypt extends Command {
  static override description =
    'Decrypt every committed dotenvx env file (apps/*/.env.prod, infra/.env*) into a mode-0600 `<file>.decrypted` sibling for docker compose'

  static override examples = [
    '<%= config.bin %> secrets decrypt',
    '<%= config.bin %> secrets decrypt --keys /path/to/.env.keys',
    '<%= config.bin %> secrets decrypt --dry-run',
    '# Refuse to commit a plaintext .env* file (dotenvx 2.38.0 — `dotenvx protect` edits the global git config instead, so use the hook):',
    'pnpm exec dotenvx ext precommit --install',
  ]

  static override flags = {
    keys: Flags.string({
      char: 'k',
      description: 'dotenvx private keys file (default: <repo root>/.env.keys)',
    }),
    'dry-run': Flags.boolean({
      description: 'List what would be decrypted without running dotenvx',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(SecretsDecrypt)
    const dryRun = flags['dry-run']
    const root = getMonorepoRoot()
    const keysFile = flags.keys
      ? path.resolve(flags.keys)
      : path.join(root, '.env.keys')

    const files = listEncryptedEnvFiles(root, gitTrackedFiles(root))

    if (files.length === 0) {
      this.warn('no encrypted env files are tracked — nothing to decrypt')
      return
    }

    if (!dryRun) {
      if (!fs.existsSync(keysFile)) {
        return this.error(
          `dotenvx keys file not found: ${keysFile}\n` +
            'Copy the host .env.keys there or pass --keys <path>.',
          { exit: 1 },
        )
      }

      if (!fs.existsSync(dotenvxBin(root))) {
        return this.error(
          `${path.relative(root, dotenvxBin(root))} is missing — run \`pnpm install\` first`,
          { exit: 1 },
        )
      }
    }

    let failed = 0

    for (const file of files) {
      const rel = path.relative(root, file)
      const target = decryptedPathFor(file)
      const relTarget = path.relative(root, target)

      if (dryRun) {
        this.log(`would decrypt ${rel} -> ${relTarget}`)
        continue
      }

      const result = decryptEnvFile({ root, file, keysFile })

      if (!result.ok) {
        failed += 1
        this.logToStderr(`FAILED ${rel}: ${result.error}`)
        continue
      }

      writeFileAtomic0600(target, result.content)
      this.log(`decrypted ${rel} -> ${relTarget}`)
    }

    if (failed > 0) {
      this.error(`${failed} of ${files.length} env files failed to decrypt`, {
        exit: 1,
      })
    }
  }
}
