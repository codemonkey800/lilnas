import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { GitTurnContext } from 'src/agent/git-turn-context'
import { globalGitWriteLock } from 'src/agent/git-write-lock'

// Mock all external dependencies so tests are pure unit tests.
jest.mock('src/crypto/master-key', () => ({
  loadMasterKey: jest.fn().mockReturnValue(crypto.randomBytes(32)),
}))

jest.mock('src/db/git-identity.repo', () => ({
  getIdentity: jest.fn().mockReturnValue(undefined),
}))

jest.mock('src/crypto/identity-resolution', () => ({
  resolveIdentity: jest.fn().mockReturnValue({ kind: 'unconfigured' }),
  isConfigured: jest.fn().mockReturnValue(false),
  isDecryptFailed: jest.fn().mockReturnValue(false),
}))

import { isConfigured, resolveIdentity } from 'src/crypto/identity-resolution'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDb(): any {
  return {}
}

describe('GitTurnContext', () => {
  afterEach(() => {
    jest.clearAllMocks()
  })

  describe('begin/end lifecycle', () => {
    it('calls resolveIdentity with the row for the userId', async () => {
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
      })
      const mockRelease = jest.fn()

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      await ctx.begin('ch1', '123456789012345678', mockRelease)
      ctx.end('ch1')

      expect(resolveIdentity).toHaveBeenCalled()
    })

    it('end() calls the release function and removes state', async () => {
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
      })
      const mockRelease = jest.fn()

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      await ctx.begin('ch1', '123456789012345678', mockRelease)
      ctx.end('ch1')

      expect(mockRelease).toHaveBeenCalledTimes(1)
    })

    it('end() is idempotent — second call is a no-op', async () => {
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
      })
      const mockRelease = jest.fn()

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      await ctx.begin('ch1', '123456789012345678', mockRelease)
      ctx.end('ch1')
      ctx.end('ch1')

      expect(mockRelease).toHaveBeenCalledTimes(1)
    })
  })

  describe('configured user — key write + identity files', () => {
    it('writes key to tmpfs and writes identity files with ssh_command containing key path', async () => {
      const keyBytes = crypto.randomBytes(64)
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'configured',
        name: 'Jane Doe',
        email: 'jane@example.com',
        keyPlaintext: Buffer.from(keyBytes),
        fingerprint: 'SHA256:test',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(true)

      const mkdirSpy = jest
        .spyOn(fs, 'mkdirSync')
        .mockImplementation(() => undefined)
      const writeFileSpy = jest
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => undefined)
      const rmSyncSpy = jest
        .spyOn(fs, 'rmSync')
        .mockImplementation(() => undefined)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
      })
      const mockRelease = jest.fn()

      await ctx.begin('ch1', '123456789012345678', mockRelease)

      // Key written to tmpfs with restrictive permissions
      const keyWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith('ch1.key'),
      )
      expect(keyWrite).toBeDefined()
      expect(keyWrite![2]).toEqual({ mode: 0o600 })
      const keyPath = keyWrite![0] as string

      // Identity dir created
      expect(mkdirSpy).toHaveBeenCalledWith(
        expect.stringContaining('ch1'),
        expect.objectContaining({ mode: 0o700 }),
      )

      // name and email written to identity dir
      const nameWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'name')),
      )
      expect(nameWrite).toBeDefined()
      expect(nameWrite![1]).toBe('Jane Doe')

      const emailWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'email')),
      )
      expect(emailWrite).toBeDefined()
      expect(emailWrite![1]).toBe('jane@example.com')

      // ssh_command includes per-turn key path and disables multiplexing
      const sshWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'ssh_command')),
      )
      expect(sshWrite).toBeDefined()
      const sshCommand = sshWrite![1] as string
      expect(sshCommand).toContain(`-i ${keyPath}`)
      expect(sshCommand).toContain('IdentitiesOnly=yes')
      expect(sshCommand).toContain('ControlMaster=no')
      expect(sshCommand).toContain('ControlPath=none')
      // Must NOT use the blocking wrapper for a configured user
      expect(sshCommand).not.toContain('git-ssh-wrapper')

      ctx.end('ch1')

      // Key removed after end()
      expect(rmSyncSpy).toHaveBeenCalledWith(keyPath, { force: true })
      // Identity dir removed after end()
      expect(rmSyncSpy).toHaveBeenCalledWith(expect.stringContaining('ch1'), {
        recursive: true,
        force: true,
      })

      mkdirSpy.mockRestore()
      writeFileSpy.mockRestore()
      rmSyncSpy.mockRestore()
    })
  })

  describe('abort()', () => {
    it('abort() releases lock via globalGitWriteLock.releaseIfHeldBy', async () => {
      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
      })

      // Acquire the real lock so releaseIfHeldBy has something to release
      const release = await globalGitWriteLock.acquire('ch1')
      // Register a minimal turn state by calling begin
      await ctx.begin('ch1', '123456789012345678', release)

      ctx.abort('ch1')

      // After abort, a second channel should be able to acquire the lock
      const release2 = await Promise.race([
        globalGitWriteLock.acquire('ch2'),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('deadlock')), 100),
        ),
      ])
      release2()

      expect(true).toBe(true) // if we got here, no deadlock
    })

    it('abort() is idempotent — safe to call twice', async () => {
      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
      })
      const mockRelease = jest.fn()
      await ctx.begin('ch1', '123456789012345678', mockRelease)
      ctx.abort('ch1')
      expect(() => ctx.abort('ch1')).not.toThrow()
    })
  })

  describe('unconfigured user — blocking wrapper', () => {
    it('writes blocking wrapper path as ssh_command for unconfigured user', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      const writeFileSpy = jest
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => undefined)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())
      ctx.end('ch1')

      const sshWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'ssh_command')),
      )
      expect(sshWrite).toBeDefined()
      expect(sshWrite![1] as string).toContain('git-ssh-wrapper')

      writeFileSpy.mockRestore()
    })
  })

  describe('sweep()', () => {
    it('sweep() does not throw when KEYS_DIR does not exist', () => {
      expect(() => GitTurnContext.sweep()).not.toThrow()
    })
  })
})
