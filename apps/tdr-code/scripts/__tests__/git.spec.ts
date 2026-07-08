import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const WRAPPER = path.resolve(__dirname, '../git')

async function runWrapper(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return execFileAsync('bash', [WRAPPER, ...args], {
    env: {
      ...process.env,
      TDR_CHANNEL_ID: 'test-channel',
      TDR_REAL_GIT: '/usr/bin/git',
      ...env,
    },
  })
    .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch(err => ({
      code: (err as NodeJS.ErrnoException & { code: number }).code ?? 1,
      stdout: (err as { stdout?: string }).stdout ?? '',
      stderr: (err as { stderr?: string }).stderr ?? '',
    }))
}

const CHANNEL_ID = 'ch1'

// Verbs that create commits under the placeholder identity, or push/pull
// them — see the wrapper's own header comment for the rationale per verb.
const BLOCKED_VERBS = [
  'commit',
  'commit-tree',
  'merge',
  'rebase',
  'cherry-pick',
  'revert',
  'am',
  'push',
  'pull',
]

// Read-only, inert-until-pushed, or needed for normal agent workflow.
const ALLOWED_VERBS = [
  'status',
  'diff',
  'log',
  'show',
  'add',
  'branch',
  'checkout',
  'switch',
  'stash',
  'fetch',
  'clone',
  'reset',
  'tag',
]

// Fake git executable used as TDR_REAL_GIT so tests assert against a known,
// stable exit code/output instead of real git's behavior against a
// non-repo cwd.
function writeFakeGit(dir: string): string {
  const fakeGit = path.join(dir, 'fake-git')
  fs.writeFileSync(
    fakeGit,
    '#!/usr/bin/env bash\necho ran-real-git "$@"\nexit 0\n',
    { mode: 0o755 },
  )
  return fakeGit
}

describe('scripts/git wrapper', () => {
  describe('no identity dir — passthrough', () => {
    it('delegates to TDR_REAL_GIT when no identity dir exists', async () => {
      // Use a non-existent channel so no identity dir is present
      const { code } = await runWrapper(['--version'], {
        TDR_CHANNEL_ID: 'no-such-channel',
      })
      // git --version exits 0
      expect(code).toBe(0)
    })

    it('works without TDR_CHANNEL_ID set', async () => {
      const { code } = await runWrapper(['--version'], {
        TDR_CHANNEL_ID: '',
      })
      expect(code).toBe(0)
    })
  })

  describe('with identity dir', () => {
    let runDir: string
    let idDir: string
    let fakeGit: string

    beforeEach(() => {
      runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-git-test-'))
      idDir = path.join(runDir, 'identity', CHANNEL_ID)
      fs.mkdirSync(idDir, { recursive: true })
      fs.writeFileSync(path.join(idDir, 'name'), 'Jane Doe')
      fs.writeFileSync(path.join(idDir, 'email'), 'jane@example.com')
      fakeGit = writeFakeGit(runDir)
    })

    afterEach(() => {
      fs.rmSync(runDir, { recursive: true, force: true })
    })

    function run(args: string[]) {
      return runWrapper(args, {
        TDR_CHANNEL_ID: CHANNEL_ID,
        TDR_CODE_RUN_DIR: runDir,
        TDR_REAL_GIT: fakeGit,
      })
    }

    it('exports GIT_AUTHOR_NAME and GIT_AUTHOR_EMAIL from identity files', async () => {
      const envFakeGit = path.join(runDir, 'env-fake-git')
      fs.writeFileSync(envFakeGit, '#!/usr/bin/env bash\nenv\n', {
        mode: 0o755,
      })

      // `status` is never in the blocked set, so this is a deterministic
      // passthrough regardless of whether `configured` exists.
      const { stdout } = await runWrapper(['status'], {
        TDR_CHANNEL_ID: CHANNEL_ID,
        TDR_CODE_RUN_DIR: runDir,
        TDR_REAL_GIT: envFakeGit,
      })

      expect(stdout).toContain('GIT_AUTHOR_NAME=Jane Doe')
      expect(stdout).toContain('GIT_AUTHOR_EMAIL=jane@example.com')
      expect(stdout).toContain('GIT_COMMITTER_NAME=Jane Doe')
      expect(stdout).toContain('GIT_COMMITTER_EMAIL=jane@example.com')
    })

    it('wrapper script passes bash syntax check', async () => {
      const { code } = await execFileAsync('bash', ['-n', WRAPPER])
        .then(() => ({ code: 0 }))
        .catch((e: { code?: number }) => ({ code: e.code ?? 1 }))
      expect(code).toBe(0)
    })

    describe('commit signing', () => {
      it('exports GIT_CONFIG_* for SSH commit signing when signing_key is present', async () => {
        const envFakeGit = path.join(runDir, 'env-fake-git')
        fs.writeFileSync(envFakeGit, '#!/usr/bin/env bash\nenv\n', {
          mode: 0o755,
        })
        const signingKeyPath = path.join(runDir, 'dummy.key')
        fs.writeFileSync(path.join(idDir, 'signing_key'), signingKeyPath)

        // `status` is never in the blocked set, so this is a deterministic
        // passthrough regardless of whether `configured` exists.
        const { stdout } = await runWrapper(['status'], {
          TDR_CHANNEL_ID: CHANNEL_ID,
          TDR_CODE_RUN_DIR: runDir,
          TDR_REAL_GIT: envFakeGit,
        })

        expect(stdout).toContain('GIT_CONFIG_COUNT=4')
        expect(stdout).toContain('GIT_CONFIG_KEY_0=gpg.format')
        expect(stdout).toContain('GIT_CONFIG_VALUE_0=ssh')
        expect(stdout).toContain('GIT_CONFIG_KEY_1=user.signingkey')
        expect(stdout).toContain(`GIT_CONFIG_VALUE_1=${signingKeyPath}`)
        expect(stdout).toContain('GIT_CONFIG_KEY_2=commit.gpgsign')
        expect(stdout).toContain('GIT_CONFIG_VALUE_2=true')
        expect(stdout).toContain('GIT_CONFIG_KEY_3=gpg.ssh.program')
        expect(stdout).toContain('GIT_CONFIG_VALUE_3=ssh-keygen')
      })

      it('does not export GIT_CONFIG_* when signing_key is absent', async () => {
        const envFakeGit = path.join(runDir, 'env-fake-git')
        fs.writeFileSync(envFakeGit, '#!/usr/bin/env bash\nenv\n', {
          mode: 0o755,
        })

        const { stdout } = await runWrapper(['status'], {
          TDR_CHANNEL_ID: CHANNEL_ID,
          TDR_CODE_RUN_DIR: runDir,
          TDR_REAL_GIT: envFakeGit,
        })

        expect(stdout).not.toContain('GIT_CONFIG_COUNT')
      })
    })

    describe('local-write block — `configured` file absent (fail-closed default)', () => {
      it.each(BLOCKED_VERBS)(
        'blocks "git %s" with a nonzero exit and an identity-configured message',
        async verb => {
          const { code, stderr } = await run([verb])
          expect(code).not.toBe(0)
          expect(stderr).toContain(`git ${verb} is blocked`)
          expect(stderr).toContain('your git identity is not configured')
          expect(stderr).toContain('/git')
        },
      )

      it.each(ALLOWED_VERBS)('does not block "git %s"', async verb => {
        const { code, stdout } = await run([verb])
        expect(code).toBe(0)
        expect(stdout).toContain(`ran-real-git ${verb}`)
      })

      it('detects the verb after `-C <path>`', async () => {
        const { code, stderr } = await run(['-C', '/tmp', 'commit', '-m', 'x'])
        expect(code).not.toBe(0)
        expect(stderr).toContain('git commit is blocked')
      })

      it('detects the verb after `-c <key>=<value>`', async () => {
        const { code, stderr } = await run(['-c', 'user.name=x', 'push'])
        expect(code).not.toBe(0)
        expect(stderr).toContain('git push is blocked')
      })

      it('consumes multiple repeated `-c` pairs before finding the verb', async () => {
        const { code, stderr } = await run(['-c', 'a=b', '-c', 'c=d', 'rebase'])
        expect(code).not.toBe(0)
        expect(stderr).toContain('git rebase is blocked')
      })

      it('falls through safely when a trailing -C has no value', async () => {
        // Malformed invocation: GIT_VERB stays empty (matches no blocked
        // verb), so it falls through to the real git rather than erroring
        // inside the wrapper itself.
        const { code, stdout } = await run(['-C'])
        expect(code).toBe(0)
        expect(stdout).toContain('ran-real-git -C')
      })
    })

    describe('local-write block — `configured` file present', () => {
      beforeEach(() => {
        fs.writeFileSync(path.join(idDir, 'configured'), 'SHA256:test')
      })

      it.each(BLOCKED_VERBS)(
        'does not block "git %s" once identity is configured',
        async verb => {
          const { code, stdout } = await run([verb])
          expect(code).toBe(0)
          expect(stdout).toContain(`ran-real-git ${verb}`)
        },
      )
    })

    describe('identity dir present but `configured` was never written', () => {
      it('still blocks — the exact write-was-skipped failure mode this design defends against', async () => {
        // idDir already has name/email (from beforeEach) but no
        // `configured` and no `ssh_command` — simulates an incomplete or
        // partially-failed turn setup.
        const { code, stderr } = await run(['commit'])
        expect(code).not.toBe(0)
        expect(stderr).toContain('git commit is blocked')
      })
    })
  })
})
