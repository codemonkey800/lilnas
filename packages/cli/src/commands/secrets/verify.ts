import { Command } from '@oclif/core'
import * as fs from 'fs'
import * as path from 'path'

import { getMonorepoRoot } from '../../utils/paths'
import {
  gitTrackedFiles,
  isFullyEncrypted,
  listEncryptedEnvFiles,
} from '../../utils/secrets'

export class SecretsVerify extends Command {
  static override description =
    'Check that every committed env file (apps/*/.env.prod, infra/.env*) holds only `encrypted:` values; exits 1 and names the plaintext keys otherwise'

  static override examples = [
    '<%= config.bin %> secrets verify',
    '# Refuse to commit a plaintext .env* file (dotenvx 2.38.0 — `dotenvx protect` edits the global git config instead, so use the hook):',
    'pnpm exec dotenvx ext precommit --install',
  ]

  async run(): Promise<void> {
    await this.parse(SecretsVerify)
    const root = getMonorepoRoot()
    const files = listEncryptedEnvFiles(root, gitTrackedFiles(root))

    if (files.length === 0) {
      this.warn('no encrypted env files are tracked — nothing to verify')
      return
    }

    let plaintext = 0

    for (const file of files) {
      const rel = path.relative(root, file)
      const { ok, plaintextKeys } = isFullyEncrypted(
        fs.readFileSync(file, 'utf8'),
      )

      if (ok) {
        this.log(`ok ${rel}`)
        continue
      }

      plaintext += 1
      this.logToStderr(`PLAINTEXT ${rel}: ${plaintextKeys.join(', ')}`)
    }

    if (plaintext > 0) {
      this.error(
        `${plaintext} of ${files.length} env files contain plaintext values — run \`dotenvx encrypt -f <file>\``,
        { exit: 1 },
      )
    }
  }
}
