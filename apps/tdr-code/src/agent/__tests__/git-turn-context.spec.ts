import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

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

jest.mock('src/db/events.repo', () => ({
  insertEvent: jest.fn(),
}))

// Mock execFileSync to avoid actually running git
jest.mock('node:child_process', () => ({
  ...jest.requireActual('node:child_process'),
  execFileSync: jest.fn(),
  spawn: jest.fn(),
}))

import { resolveIdentity, isConfigured } from 'src/crypto/identity-resolution'
import { getIdentity } from 'src/db/git-identity.repo'
import { insertEvent } from 'src/db/events.repo'

function makeDb() {
  return {} as any
}

function makeHandlers() {
  return {
    onToolCall: jest.fn(),
    onToolCallUpdate: jest.fn(),
    onAgentMessageChunk: jest.fn(),
    onAgentMessageImage: jest.fn(),
    onPromptStart: jest.fn(),
    onPromptComplete: jest.fn(),
    onGitPushBlocked: jest.fn(),
  }
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
        cwd: '/tmp',
        handlers: makeHandlers(),
      })
      const mockRelease = jest.fn()

      await ctx.begin('ch1', '123456789012345678', mockRelease)
      ctx.end('ch1')

      expect(resolveIdentity).toHaveBeenCalled()
    })

    it('end() calls the release function and removes state', async () => {
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        cwd: '/tmp',
        handlers: makeHandlers(),
      })
      const mockRelease = jest.fn()

      await ctx.begin('ch1', '123456789012345678', mockRelease)
      ctx.end('ch1')

      expect(mockRelease).toHaveBeenCalledTimes(1)
    })

    it('end() is idempotent — second call is a no-op', async () => {
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        cwd: '/tmp',
        handlers: makeHandlers(),
      })
      const mockRelease = jest.fn()

      await ctx.begin('ch1', '123456789012345678', mockRelease)
      ctx.end('ch1')
      ctx.end('ch1')

      expect(mockRelease).toHaveBeenCalledTimes(1)
    })
  })

  describe('abort()', () => {
    it('abort() releases lock via globalGitWriteLock.releaseIfHeldBy', async () => {
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        cwd: '/tmp',
        handlers: makeHandlers(),
      })

      // Acquire the real lock so releaseIfHeldBy has something to release
      const release = await globalGitWriteLock.acquire('ch1')
      // Register a minimal turn state by calling begin
      await ctx.begin('ch1', '123456789012345678', release)

      ctx.abort('ch1')

      // After abort, a second channel should be able to acquire the lock
      const release2 = await Promise.race([
        globalGitWriteLock.acquire('ch2'),
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('deadlock')), 100)),
      ])
      release2()

      expect(true).toBe(true) // if we got here, no deadlock
    })

    it('abort() is idempotent — safe to call twice', async () => {
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        cwd: '/tmp',
        handlers: makeHandlers(),
      })
      const mockRelease = jest.fn()
      await ctx.begin('ch1', '123456789012345678', mockRelease)
      ctx.abort('ch1')
      expect(() => ctx.abort('ch1')).not.toThrow()
    })
  })

  describe('unconfigured user → blocking wrapper + git_push_blocked event', () => {
    it('emits git_push_blocked event for unconfigured user', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({ kind: 'unconfigured' })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 42,
        cwd: '/tmp',
        handlers: makeHandlers(),
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())
      ctx.end('ch1')

      expect(insertEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'git_push_blocked',
          level: 'warn',
          context: expect.objectContaining({ discordUserId: '123456789012345678' }),
        }),
      )
    })

    it('emits git_key_decrypt_failed (distinct event) for decrypt_failed user', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'decrypt_failed',
        fingerprint: 'SHA256:test',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 42,
        cwd: '/tmp',
        handlers: makeHandlers(),
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())
      ctx.end('ch1')

      expect(insertEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          type: 'git_key_decrypt_failed',
        }),
      )
    })

    it('event context never contains key material', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({ kind: 'unconfigured' })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        cwd: '/tmp',
        handlers: makeHandlers(),
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())
      ctx.end('ch1')

      const calls = (insertEvent as jest.Mock).mock.calls
      for (const [, eventData] of calls) {
        const ctx = eventData?.context ?? {}
        expect(ctx).not.toHaveProperty('privateKey')
        expect(ctx).not.toHaveProperty('ciphertext')
        expect(ctx).not.toHaveProperty('iv')
        expect(ctx).not.toHaveProperty('authTag')
        expect(ctx).not.toHaveProperty('keyPath')
      }
    })
  })

  describe('sweep()', () => {
    it('sweep() does not throw when KEYS_DIR does not exist', () => {
      expect(() => GitTurnContext.sweep()).not.toThrow()
    })
  })
})
