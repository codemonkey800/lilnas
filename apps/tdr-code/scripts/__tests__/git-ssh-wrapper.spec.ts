import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const WRAPPER = path.resolve(__dirname, '../git-ssh-wrapper.sh')

async function runWrapper(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return execFileAsync('bash', [WRAPPER, ...args], {
    env: {
      ...process.env,
      // Override console URL for predictable test output
      TDR_CODE_CONSOLE_URL: 'https://tdr-code.example.com',
    },
  })
    .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }))
    .catch(err => ({
      code: (err as NodeJS.ErrnoException & { code: number }).code ?? 1,
      stdout: (err as { stdout?: string }).stdout ?? '',
      stderr: (err as { stderr?: string }).stderr ?? '',
    }))
}

describe('git-ssh-wrapper.sh', () => {
  describe('read-only operations (allowed)', () => {
    it('git-upload-pack → exit 0 (attempts exec ssh — fails gracefully since no real host)', async () => {
      // The wrapper tries to exec ssh; since the args are fake it will fail
      // at the ssh level, but the wrapper itself exits cleanly via exec.
      // We just verify the wrapper exits without the "blocked" stderr message.
      const { stderr } = await runWrapper([
        'git@github.com',
        'git-upload-pack',
        '/user/repo',
      ])
      // Should NOT contain the push-blocked message
      expect(stderr).not.toContain('git push is blocked')
      expect(stderr).not.toContain('Configure your identity')
    })

    it('git-upload-archive → does not exit with blocked message', async () => {
      const { stderr } = await runWrapper([
        'git@github.com',
        'git-upload-archive',
        '/user/repo',
      ])
      expect(stderr).not.toContain('git push is blocked')
    })
  })

  describe('push is blocked (git-receive-pack)', () => {
    it('exits nonzero', async () => {
      const { code } = await runWrapper([
        'git@github.com',
        'git-receive-pack',
        '/user/repo',
      ])
      expect(code).not.toBe(0)
    })

    it('prints the configure-identity message to stderr', async () => {
      const { stderr } = await runWrapper([
        'git@github.com',
        'git-receive-pack',
        '/user/repo',
      ])
      expect(stderr).toContain('git push is blocked')
      expect(stderr).toContain('tdr-code.example.com/git-identity')
    })

    it('verb found at non-first position is still blocked', async () => {
      // Simulate ssh with extra options before the verb
      const { code, stderr } = await runWrapper([
        '-o', 'StrictHostKeyChecking=accept-new',
        'git@github.com',
        'git-receive-pack',
        '/user/repo',
      ])
      expect(code).not.toBe(0)
      expect(stderr).toContain('git push is blocked')
    })
  })

  describe('default-deny for unrecognized verbs', () => {
    it('no verb in args → exit nonzero with blocked message', async () => {
      const { code, stderr } = await runWrapper(['git@github.com'])
      expect(code).not.toBe(0)
      expect(stderr).toContain('blocked')
    })

    it('unknown verb → exit nonzero', async () => {
      const { code, stderr } = await runWrapper([
        'git@github.com',
        'git-unknown-verb',
        '/user/repo',
      ])
      expect(code).not.toBe(0)
      expect(stderr).toContain('blocked')
    })
  })
})
