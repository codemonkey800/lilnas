import { join } from 'node:path'

import {
  buildAuthArgs,
  buildDownloadArgs,
  ProcessService,
} from 'src/icloudpd/process.service'

const FAKE_BIN = join(__dirname, 'fixtures', 'fake-icloudpd.sh')

const base = { appleId: 'alice@example.com', cookieDir: '/state/cookies/alice' }

describe('argument builders', () => {
  it('puts the common flags on both commands', () => {
    for (const args of [
      buildAuthArgs(base),
      buildDownloadArgs({ ...base, directory: '/photos/alice' }),
    ]) {
      expect(args).toEqual(
        expect.arrayContaining([
          '--username',
          'alice@example.com',
          '--cookie-directory',
          '/state/cookies/alice',
          '--no-progress-bar',
          '--log-level',
          'info',
        ]),
      )
    }
  })

  it('adds --auth-only and both webui providers to the login command', () => {
    const args = buildAuthArgs(base)
    expect(args).toEqual(expect.arrayContaining(['--auth-only']))
    expect(args[args.indexOf('--password-provider') + 1]).toBe('webui')
    expect(args[args.indexOf('--mfa-provider') + 1]).toBe('webui')
    expect(args).not.toContain('--directory')
  })

  it('gives downloads a directory and no webui flags', () => {
    const args = buildDownloadArgs({ ...base, directory: '/photos/alice' })
    expect(args[args.indexOf('--directory') + 1]).toBe('/photos/alice')
    expect(args).not.toContain('--auth-only')
    expect(args).not.toContain('--password-provider')
    expect(args).not.toContain('--mfa-provider')
    expect(args).not.toContain('--recent')
  })

  it('adds --recent only when it is given', () => {
    const args = buildDownloadArgs({
      ...base,
      directory: '/photos/alice',
      recent: 25,
    })
    expect(args[args.indexOf('--recent') + 1]).toBe('25')
  })

  it.each([0, -3, 1.5, Number.NaN])('rejects --recent %p', recent => {
    expect(() =>
      buildDownloadArgs({ ...base, directory: '/photos/alice', recent }),
    ).toThrow(RangeError)
  })

  it('never asks for debug logs or passes a password on the command line', () => {
    for (const args of [
      buildAuthArgs(base),
      buildDownloadArgs({ ...base, directory: '/p', recent: 3 }),
    ]) {
      expect(args).not.toContain('debug')
      expect(args).not.toContain('-p')
      expect(args).not.toContain('--password')
      expect(args[args.indexOf('--log-level') + 1]).toBe('info')
    }
  })
})

describe('ProcessService', () => {
  const service = new ProcessService()
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.ICLOUDPD_BIN = FAKE_BIN
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  function collect(): { lines: string[]; onLine(line: string): void } {
    const lines: string[] = []
    return { lines, onLine: line => lines.push(line) }
  }

  async function waitFor(lines: string[], text: string): Promise<void> {
    const deadline = Date.now() + 5_000
    while (!lines.includes(text)) {
      if (Date.now() > deadline) throw new Error(`no "${text}" line`)
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }

  it('merges stdout and stderr line by line and reports the exit code', async () => {
    const { lines, onLine } = collect()
    const child = service.spawnIcloudpd(['lines'], { onLine })
    expect(child.pid).toBeGreaterThan(0)

    expect(await child.exited).toEqual({ code: 3, signal: null })
    // Every line, including the last one that has no newline, is delivered
    // before `exited` resolves.
    expect([...lines].sort()).toEqual(['err line 1', 'out line 1', 'partial'])
  })

  it('passes arguments verbatim, with no shell in between', async () => {
    const { lines, onLine } = collect()
    const args = ['--username', 'a b; echo hacked', '--directory', '$HOME']
    await service.spawnIcloudpd(['args', ...args], { onLine }).exited
    expect(lines).toEqual(args)
  })

  it('does not hand the backend environment to icloudpd', async () => {
    process.env.POSTGRES_PASSWORD = 'db-secret'
    process.env.IMMICH_API_KEY = 'immich-secret'
    const { lines, onLine } = collect()
    await service.spawnIcloudpd(['env'], { onLine }).exited
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatch(/^db=\[\] key=\[\] path=\[.+\]$/)
    expect(lines[0]).not.toContain('secret')
  })

  it('keeps reading when onLine throws', async () => {
    const seen: string[] = []
    const child = service.spawnIcloudpd(['lines'], {
      onLine: line => {
        seen.push(line)
        throw new Error('boom')
      },
    })
    await child.exited
    expect(seen).toHaveLength(3)
  })

  it('throws when the binary cannot be started', () => {
    process.env.ICLOUDPD_BIN = '/nonexistent/icloudpd'
    expect(() =>
      service.spawnIcloudpd([], { onLine: () => undefined }),
    ).toThrow('could not start icloudpd')
  })

  it('stop() ends a running child with SIGTERM', async () => {
    const { lines, onLine } = collect()
    const child = service.spawnIcloudpd(['wait'], { onLine })
    await waitFor(lines, 'ready')

    await child.stop()
    expect(await child.exited).toEqual({ code: null, signal: 'SIGTERM' })
  })

  it('stop() kills a child that ignores SIGTERM', async () => {
    const { lines, onLine } = collect()
    const child = service.spawnIcloudpd(['ignore-term'], {
      onLine,
      killGraceMs: 300,
    })
    await waitFor(lines, 'ready')

    const started = Date.now()
    await child.stop()
    expect(await child.exited).toEqual({ code: null, signal: 'SIGKILL' })
    expect(Date.now() - started).toBeGreaterThanOrEqual(250)
  })

  it('stop() on a finished child resolves without signalling', async () => {
    const child = service.spawnIcloudpd(['lines'], { onLine: () => undefined })
    await child.exited
    await expect(child.stop()).resolves.toBeUndefined()
  })
})
