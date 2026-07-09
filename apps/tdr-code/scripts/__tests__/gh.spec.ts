import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const WRAPPER = path.resolve(__dirname, '../gh')

async function runWrapper(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return execFileAsync('bash', [WRAPPER, ...args], {
    env: {
      ...process.env,
      TDR_CHANNEL_ID: 'test-channel',
      TDR_REAL_GH: '/usr/bin/gh',
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

// Fake gh executable used as TDR_REAL_GH so tests assert against a known,
// stable marker instead of a real gh binary's behavior (which would also
// require real network/auth setup to invoke at all).
function writeFakeGh(dir: string): string {
  const fakeGh = path.join(dir, 'fake-gh')
  fs.writeFileSync(
    fakeGh,
    '#!/usr/bin/env bash\necho ran-real-gh "$@"\nexit 0\n',
    {
      mode: 0o755,
    },
  )
  return fakeGh
}

describe('scripts/gh wrapper', () => {
  it('wrapper script passes bash syntax check', async () => {
    const { code } = await execFileAsync('bash', ['-n', WRAPPER])
      .then(() => ({ code: 0 }))
      .catch((e: { code?: number }) => ({ code: e.code ?? 1 }))
    expect(code).toBe(0)
  })

  describe('no TDR_CHANNEL_ID set — passthrough (mirrors scripts/git)', () => {
    it('delegates to TDR_REAL_GH unmodified when TDR_CHANNEL_ID is empty', async () => {
      const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-gh-test-'))
      const fakeGh = writeFakeGh(runDir)
      try {
        const { code, stdout } = await runWrapper(['pr', 'list'], {
          TDR_CHANNEL_ID: '',
          TDR_CODE_RUN_DIR: runDir,
          TDR_REAL_GH: fakeGh,
        })
        expect(code).toBe(0)
        expect(stdout).toContain('ran-real-gh pr list')
      } finally {
        fs.rmSync(runDir, { recursive: true, force: true })
      }
    })

    it('does not require an identity dir to exist for a non-turn shell', async () => {
      const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-gh-test-'))
      const fakeGh = writeFakeGh(runDir)
      try {
        // TDR_CODE_RUN_DIR deliberately points somewhere with no identity/
        // subtree at all — passthrough must not care.
        const { code, stdout } = await runWrapper(['auth', 'status'], {
          TDR_CHANNEL_ID: '',
          TDR_CODE_RUN_DIR: runDir,
          TDR_REAL_GH: fakeGh,
        })
        expect(code).toBe(0)
        expect(stdout).toContain('ran-real-gh auth status')
      } finally {
        fs.rmSync(runDir, { recursive: true, force: true })
      }
    })
  })

  describe('TDR_REAL_GH unset — gh not installed on this host', () => {
    it('blocks with the "not installed" message and exits nonzero, even with a valid token present', async () => {
      const runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-gh-test-'))
      const idDir = path.join(runDir, 'identity', CHANNEL_ID)
      fs.mkdirSync(idDir, { recursive: true })
      fs.writeFileSync(path.join(idDir, 'github_token'), 'ghp_validtoken')
      try {
        const { code, stderr, stdout } = await runWrapper(['pr', 'list'], {
          TDR_CHANNEL_ID: CHANNEL_ID,
          TDR_CODE_RUN_DIR: runDir,
          TDR_REAL_GH: '',
        })
        expect(code).not.toBe(0)
        expect(stderr).toContain('gh is not installed on this host')
        expect(stderr).toContain('contact an operator')
        // Distinct-message guarantee: the "not installed" case must never
        // mention /git — that link only helps the per-user linking gap.
        expect(stderr).not.toContain('/git')
        expect(stdout).not.toContain('ran-real-gh')
      } finally {
        fs.rmSync(runDir, { recursive: true, force: true })
      }
    })

    it('blocks before ever reading the identity directory (unreadable/missing TDR_CODE_RUN_DIR causes no different error)', async () => {
      // Points at a run dir that does not exist at all. If the wrapper
      // checked TDR_REAL_GH after trying to read the identity dir, this
      // would either crash differently or behave inconsistently. The
      // check-order guarantee means the result is identical to the
      // "valid run dir, just no token" case above.
      const { code, stderr, stdout } = await runWrapper(['pr', 'list'], {
        TDR_CHANNEL_ID: CHANNEL_ID,
        TDR_CODE_RUN_DIR: '/tmp/tdr-gh-test-nonexistent-run-dir',
        TDR_REAL_GH: '',
      })
      expect(code).not.toBe(0)
      expect(stderr).toContain('gh is not installed on this host')
      expect(stdout).not.toContain('ran-real-gh')
    })
  })

  describe('with identity dir', () => {
    let runDir: string
    let idDir: string
    let fakeGh: string

    beforeEach(() => {
      runDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tdr-gh-test-'))
      idDir = path.join(runDir, 'identity', CHANNEL_ID)
      fs.mkdirSync(idDir, { recursive: true })
      fakeGh = writeFakeGh(runDir)
    })

    afterEach(() => {
      fs.rmSync(runDir, { recursive: true, force: true })
    })

    function run(args: string[]) {
      return runWrapper(args, {
        TDR_CHANNEL_ID: CHANNEL_ID,
        TDR_CODE_RUN_DIR: runDir,
        TDR_REAL_GH: fakeGh,
      })
    }

    describe('github_token present — happy path', () => {
      beforeEach(() => {
        fs.writeFileSync(path.join(idDir, 'github_token'), 'ghp_sekrit123')
      })

      it('exports GH_TOKEN and delegates to TDR_REAL_GH', async () => {
        const envFakeGh = path.join(runDir, 'env-fake-gh')
        fs.writeFileSync(
          envFakeGh,
          '#!/usr/bin/env bash\necho ran-real-gh "$@"\nenv\n',
          {
            mode: 0o755,
          },
        )

        const { code, stdout } = await runWrapper(['pr', 'list'], {
          TDR_CHANNEL_ID: CHANNEL_ID,
          TDR_CODE_RUN_DIR: runDir,
          TDR_REAL_GH: envFakeGh,
        })

        expect(code).toBe(0)
        expect(stdout).toContain('ran-real-gh pr list')
        expect(stdout).toContain('GH_TOKEN=ghp_sekrit123')
      })

      it('passes through arbitrary gh subcommands and args unmodified', async () => {
        const { code, stdout } = await run(['issue', 'create', '--title', 'x'])
        expect(code).toBe(0)
        expect(stdout).toContain('ran-real-gh issue create --title x')
      })
    })

    describe('github_token absent — blocked (not linked)', () => {
      it('prints the friendly link message, exits nonzero, and never invokes the real gh binary', async () => {
        const { code, stderr, stdout } = await run(['pr', 'list'])
        expect(code).not.toBe(0)
        expect(stderr).toContain('gh is blocked')
        expect(stderr).toContain('your GitHub account is not linked')
        expect(stderr).toContain('/git')
        // The fake binary's marker output must never appear — the real gh
        // was never exec'd.
        expect(stdout).not.toContain('ran-real-gh')
      })

      it('blocks regardless of the gh subcommand invoked', async () => {
        const { code, stderr } = await run(['auth', 'status'])
        expect(code).not.toBe(0)
        expect(stderr).toContain('gh is blocked')
      })
    })
  })
})
