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

// Like runWrapper, but also writes to and closes the child's stdin. Needed
// for `git credential fill`, which reads its request from stdin. Note:
// execFile's options object has no `input` field (that's execSync/
// spawnSync-only) — the child's stdin stream must be written and ended
// directly, or a stdin-reading command like `git credential fill` hangs
// waiting for EOF that never comes.
function runWrapperWithStdin(
  args: string[],
  stdin: string,
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise(resolve => {
    const child = execFile(
      'bash',
      [WRAPPER, ...args],
      {
        env: {
          ...process.env,
          TDR_CHANNEL_ID: 'test-channel',
          TDR_REAL_GIT: '/usr/bin/git',
          ...env,
        },
      },
      (err, stdout, stderr) => {
        const code = err
          ? ((err as NodeJS.ErrnoException & { code: number }).code ?? 1)
          : 0
        resolve({ code, stdout, stderr })
      },
    )
    child.stdin?.write(stdin)
    child.stdin?.end()
  })
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

      it('does not export GIT_CONFIG_* when neither signing_key nor github_token is present', async () => {
        const envFakeGit = path.join(runDir, 'env-fake-git')
        fs.writeFileSync(envFakeGit, '#!/usr/bin/env bash\nenv\n', {
          mode: 0o755,
        })

        // idDir already has no signing_key/github_token from beforeEach —
        // explicit here for clarity even though the prior test already
        // covers this by omission.
        expect(fs.existsSync(path.join(idDir, 'signing_key'))).toBe(false)
        expect(fs.existsSync(path.join(idDir, 'github_token'))).toBe(false)

        const { stdout } = await runWrapper(['status'], {
          TDR_CHANNEL_ID: CHANNEL_ID,
          TDR_CODE_RUN_DIR: runDir,
          TDR_REAL_GIT: envFakeGit,
        })

        expect(stdout).not.toContain('GIT_CONFIG_COUNT')
        expect(stdout).not.toContain('GIT_CONFIG_KEY_')
      })
    })

    describe('GitHub HTTPS credential injection', () => {
      it('exports GIT_CONFIG_* for both signing and the GitHub credential helper when both files are present', async () => {
        const envFakeGit = path.join(runDir, 'env-fake-git')
        fs.writeFileSync(envFakeGit, '#!/usr/bin/env bash\nenv\n', {
          mode: 0o755,
        })
        const signingKeyPath = path.join(runDir, 'dummy.key')
        fs.writeFileSync(path.join(idDir, 'signing_key'), signingKeyPath)
        fs.writeFileSync(path.join(idDir, 'github_token'), 'ghtoken-abc123')

        const { stdout } = await runWrapper(['status'], {
          TDR_CHANNEL_ID: CHANNEL_ID,
          TDR_CODE_RUN_DIR: runDir,
          TDR_REAL_GIT: envFakeGit,
        })

        // Combined count: 4 signing pairs + 1 credential-helper pair.
        expect(stdout).toContain('GIT_CONFIG_COUNT=5')

        // Signing block occupies indices 0-3, byte-for-byte identical to
        // the signing-only case (see "commit signing" describe block).
        expect(stdout).toContain('GIT_CONFIG_KEY_0=gpg.format')
        expect(stdout).toContain('GIT_CONFIG_VALUE_0=ssh')
        expect(stdout).toContain('GIT_CONFIG_KEY_1=user.signingkey')
        expect(stdout).toContain(`GIT_CONFIG_VALUE_1=${signingKeyPath}`)
        expect(stdout).toContain('GIT_CONFIG_KEY_2=commit.gpgsign')
        expect(stdout).toContain('GIT_CONFIG_VALUE_2=true')
        expect(stdout).toContain('GIT_CONFIG_KEY_3=gpg.ssh.program')
        expect(stdout).toContain('GIT_CONFIG_VALUE_3=ssh-keygen')

        // Credential helper occupies index 4, scoped to github.com only.
        expect(stdout).toContain(
          'GIT_CONFIG_KEY_4=credential.https://github.com.helper',
        )
        const valueLine = stdout
          .split('\n')
          .find(line => line.startsWith('GIT_CONFIG_VALUE_4='))
        expect(valueLine).toBeDefined()
        expect(valueLine).toContain('username=x-access-token')
        expect(valueLine).toContain(`cat "${path.join(idDir, 'github_token')}"`)
      })

      it('exports only the credential helper (GIT_CONFIG_COUNT=1) when only github_token is present — the core AE3 assertion', async () => {
        const envFakeGit = path.join(runDir, 'env-fake-git')
        fs.writeFileSync(envFakeGit, '#!/usr/bin/env bash\nenv\n', {
          mode: 0o755,
        })
        fs.writeFileSync(path.join(idDir, 'github_token'), 'ghtoken-abc123')

        // No signing_key: a GitHub-only user needs no SSH key to push.
        expect(fs.existsSync(path.join(idDir, 'signing_key'))).toBe(false)

        const { stdout } = await runWrapper(['status'], {
          TDR_CHANNEL_ID: CHANNEL_ID,
          TDR_CODE_RUN_DIR: runDir,
          TDR_REAL_GIT: envFakeGit,
        })

        expect(stdout).toContain('GIT_CONFIG_COUNT=1')
        expect(stdout).toContain(
          'GIT_CONFIG_KEY_0=credential.https://github.com.helper',
        )
        const valueLine = stdout
          .split('\n')
          .find(line => line.startsWith('GIT_CONFIG_VALUE_0='))
        expect(valueLine).toBeDefined()
        expect(valueLine).toContain('username=x-access-token')
        expect(valueLine).toContain(`cat "${path.join(idDir, 'github_token')}"`)

        // No signing config leaked into the same run.
        expect(stdout).not.toContain('gpg.format')
        expect(stdout).not.toContain('user.signingkey')
      })

      it('exports GIT_CONFIG_COUNT=4 identically to today, byte-for-byte, when only signing_key is present (regression guard)', async () => {
        const envFakeGit = path.join(runDir, 'env-fake-git')
        fs.writeFileSync(envFakeGit, '#!/usr/bin/env bash\nenv\n', {
          mode: 0o755,
        })
        const signingKeyPath = path.join(runDir, 'dummy.key')
        fs.writeFileSync(path.join(idDir, 'signing_key'), signingKeyPath)

        expect(fs.existsSync(path.join(idDir, 'github_token'))).toBe(false)

        const { stdout } = await runWrapper(['status'], {
          TDR_CHANNEL_ID: CHANNEL_ID,
          TDR_CODE_RUN_DIR: runDir,
          TDR_REAL_GIT: envFakeGit,
        })

        // Identical assertions to the pre-existing signing-only test in the
        // "commit signing" describe block above — this generalization must
        // not change a single byte of the signing-only path.
        expect(stdout).toContain('GIT_CONFIG_COUNT=4')
        expect(stdout).toContain('GIT_CONFIG_KEY_0=gpg.format')
        expect(stdout).toContain('GIT_CONFIG_VALUE_0=ssh')
        expect(stdout).toContain('GIT_CONFIG_KEY_1=user.signingkey')
        expect(stdout).toContain(`GIT_CONFIG_VALUE_1=${signingKeyPath}`)
        expect(stdout).toContain('GIT_CONFIG_KEY_2=commit.gpgsign')
        expect(stdout).toContain('GIT_CONFIG_VALUE_2=true')
        expect(stdout).toContain('GIT_CONFIG_KEY_3=gpg.ssh.program')
        expect(stdout).toContain('GIT_CONFIG_VALUE_3=ssh-keygen')
        expect(stdout).not.toContain('GIT_CONFIG_KEY_4')
        expect(stdout).not.toContain('credential.https://github.com.helper')
      })

      // Unconditional scoping proof (baseline, no real git required): the
      // exported config KEY string is the URL-scoped
      // `credential.https://github.com.helper`, never a blanket
      // `credential.helper` — this is what makes the scoping possible at
      // all, and is asserted regardless of whether a real git binary is
      // available to drive the fuller integration test below.
      it('scopes the credential helper key to https://github.com, never a blanket credential.helper', async () => {
        const envFakeGit = path.join(runDir, 'env-fake-git')
        fs.writeFileSync(envFakeGit, '#!/usr/bin/env bash\nenv\n', {
          mode: 0o755,
        })
        fs.writeFileSync(path.join(idDir, 'github_token'), 'ghtoken-abc123')

        const { stdout } = await runWrapper(['status'], {
          TDR_CHANNEL_ID: CHANNEL_ID,
          TDR_CODE_RUN_DIR: runDir,
          TDR_REAL_GIT: envFakeGit,
        })

        expect(stdout).toContain(
          'GIT_CONFIG_KEY_0=credential.https://github.com.helper',
        )
        // Must never widen to a blanket helper that would apply to every
        // remote regardless of host.
        expect(stdout).not.toMatch(/^GIT_CONFIG_KEY_\d+=credential\.helper$/m)
      })

      // Security-relevant integration test: proves the credential helper is
      // scoped to https://github.com specifically, using REAL git's own
      // credential-helper resolution (`git credential fill`) rather than
      // only asserting the injected config string — `git push`/`git fetch`
      // resolve credentials via this exact codepath before ever opening an
      // HTTP connection, so exercising it here proves the scoping actually
      // works end-to-end, not just that the right key/value strings were
      // exported. Confirmed locally that a real `git` binary is available
      // (git 2.53.0); the guard below keeps this test from failing the
      // whole suite on a stripped-down CI image that lacks git on PATH —
      // it skips (not fails) in that case, falling back to the
      // unconditional scoping-string proof above.
      //
      // HOME is pointed at an empty, isolated directory (rather than
      // inheriting the test runner's real ~/.gitconfig) so no ambient
      // credential.helper on the host machine or CI runner can supply a
      // credential for the non-GitHub host and mask a scoping bug as a
      // false pass.
      it('does not send the GitHub token as a credential for a non-GitHub HTTPS host (real git credential resolution)', async () => {
        const hasRealGit = await execFileAsync('which', ['git'])
          .then(() => true)
          .catch(() => false)
        if (!hasRealGit) {
          console.warn(
            'skipping real-git credential-scoping test: no git on PATH',
          )
          return
        }

        fs.writeFileSync(path.join(idDir, 'github_token'), 'ghtoken-abc123')
        expect(fs.existsSync(path.join(idDir, 'signing_key'))).toBe(false)

        const isolatedHome = fs.mkdtempSync(
          path.join(os.tmpdir(), 'tdr-git-test-home-'),
        )
        try {
          // github.com: the scoped helper fires and returns our token via
          // real git's own credential-helper protocol.
          const githubResult = await runWrapperWithStdin(
            ['credential', 'fill'],
            'protocol=https\nhost=github.com\n',
            {
              HOME: isolatedHome,
              TDR_CHANNEL_ID: CHANNEL_ID,
              TDR_CODE_RUN_DIR: runDir,
              TDR_REAL_GIT: 'git',
            },
          )
          expect(githubResult.code).toBe(0)
          expect(githubResult.stdout).toContain('username=x-access-token')
          expect(githubResult.stdout).toContain('password=ghtoken-abc123')

          // gitlab.com: the scoped helper does NOT fire. With no ambient
          // credential source (isolated HOME) and no TTY to prompt, git
          // must fail cleanly rather than ever emitting our GitHub token.
          const gitlabResult = await runWrapperWithStdin(
            ['credential', 'fill'],
            'protocol=https\nhost=gitlab.com\n',
            {
              HOME: isolatedHome,
              TDR_CHANNEL_ID: CHANNEL_ID,
              TDR_CODE_RUN_DIR: runDir,
              TDR_REAL_GIT: 'git',
            },
          )
          expect(gitlabResult.code).not.toBe(0)
          expect(gitlabResult.stdout).not.toContain('ghtoken-abc123')
          expect(gitlabResult.stdout).not.toContain('x-access-token')
        } finally {
          fs.rmSync(isolatedHome, { recursive: true, force: true })
        }
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
