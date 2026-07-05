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
  describe('read operations are also blocked (git-upload-pack / git-upload-archive)', () => {
    it('git-upload-pack → exits nonzero with the blocked message', async () => {
      const { code, stderr } = await runWrapper([
        'git@github.com',
        'git-upload-pack',
        '/user/repo',
      ])
      expect(code).not.toBe(0)
      expect(stderr).toContain('git operation blocked')
      expect(stderr).toContain('tdr-code.example.com/git-identity')
    })

    it('git-upload-archive → exits nonzero with the blocked message', async () => {
      const { code, stderr } = await runWrapper([
        'git@github.com',
        'git-upload-archive',
        '/user/repo',
      ])
      expect(code).not.toBe(0)
      expect(stderr).toContain('git operation blocked')
    })

    it('verb found at non-first position is still blocked', async () => {
      // Simulate ssh with extra options before the verb
      const { code, stderr } = await runWrapper([
        '-o',
        'StrictHostKeyChecking=accept-new',
        'git@github.com',
        'git-upload-pack',
        '/user/repo',
      ])
      expect(code).not.toBe(0)
      expect(stderr).toContain('git operation blocked')
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
        '-o',
        'StrictHostKeyChecking=accept-new',
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
