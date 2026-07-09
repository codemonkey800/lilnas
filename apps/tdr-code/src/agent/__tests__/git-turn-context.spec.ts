import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { AcpEventHandlers } from 'src/agent/agent.types'
import { GitTurnContext } from 'src/agent/git-turn-context'
import { globalGitWriteLock } from 'src/agent/git-write-lock'

// Mock all external dependencies so tests are pure unit tests.
jest.mock('src/crypto/master-key', () => ({
  loadMasterKey: jest.fn().mockReturnValue(crypto.randomBytes(32)),
}))

// U5: insertEvent is mocked directly (not a real test DB) so tests can
// assert exact call args/counts for the new block/decrypt-failure events
// without needing DB plumbing — mirrors this file's existing style of
// mocking every collaborator at the module boundary.
jest.mock('src/db/events.repo', () => ({
  insertEvent: jest.fn(),
}))

jest.mock('src/db/git-identity.repo', () => ({
  getIdentity: jest.fn().mockReturnValue(undefined),
}))

jest.mock('src/crypto/identity-resolution', () => ({
  resolveIdentity: jest.fn().mockReturnValue({ kind: 'unconfigured' }),
  isConfigured: jest.fn().mockReturnValue(false),
  isDecryptFailed: jest.fn().mockReturnValue(false),
}))

// GitHub-side mocks, mirroring the SSH-side style above exactly. Default to
// "unconfigured" (no row, no token) so every EXISTING SSH-only test in this
// file — which never sets these up — continues to exercise the
// fully-unconfigured GitHub axis without needing per-test setup, per the
// plan's guidance to prefer a beforeEach-style default over duplicating this
// in every test. resolveTurnIdentity itself is NOT mocked — the real U1
// composition runs against whatever these two mocks return, since exercising
// the real composition here catches wiring bugs turn-identity.spec.ts alone
// cannot.
jest.mock('src/crypto/github-token-resolution', () => ({
  resolveGithubToken: jest.fn().mockReturnValue({ kind: 'unconfigured' }),
}))

jest.mock('src/db/github-credential.repo', () => ({
  getGithubCredentialByDiscordUserId: jest.fn().mockReturnValue(undefined),
}))

import { resolveGithubToken } from 'src/crypto/github-token-resolution'
import { isConfigured, resolveIdentity } from 'src/crypto/identity-resolution'
import { insertEvent } from 'src/db/events.repo'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeDb(): any {
  return {}
}

// U5: a mocked AcpEventHandlers passed into GitTurnContextOptions so tests
// can assert the Discord-notice fan-out call (onGitOperationBlocked)
// directly, independent of the insertEvent mock above.
function makeHandlers(): jest.Mocked<AcpEventHandlers> {
  return {
    onToolCall: jest.fn(),
    onToolCallUpdate: jest.fn(),
    onAgentMessageChunk: jest.fn(),
    onAgentMessageImage: jest.fn(),
    onPromptStart: jest.fn(),
    onPromptComplete: jest.fn(),
    onSessionInfoUpdate: jest.fn(),
    onResumeFailed: jest.fn(),
    onUsageUpdate: jest.fn(),
    onGitOperationBlocked: jest.fn(),
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
        handlers: makeHandlers(),
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
        handlers: makeHandlers(),
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
        handlers: makeHandlers(),
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
        handlers: makeHandlers(),
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

      // `configured` marker written — gates scripts/git's local-write block
      const configuredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'configured')),
      )
      expect(configuredWrite).toBeDefined()
      expect(configuredWrite![1]).toBe('SHA256:test')

      // signing_key written — points scripts/git's user.signingkey at the
      // same tmpfs key file used for SSH transport
      const signingKeyWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'signing_key')),
      )
      expect(signingKeyWrite).toBeDefined()
      expect(signingKeyWrite![1]).toBe(keyPath)

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
        handlers: makeHandlers(),
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
        handlers: makeHandlers(),
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())
      ctx.end('ch1')

      const sshWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'ssh_command')),
      )
      expect(sshWrite).toBeDefined()
      expect(sshWrite![1] as string).toContain('git-ssh-wrapper')

      // No `configured` marker for an unconfigured user — scripts/git's
      // local-write block must default to blocked (fail-closed).
      const configuredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'configured')),
      )
      expect(configuredWrite).toBeUndefined()

      // No signing_key either — there's no key to sign with, and this turn
      // can't commit at all until identity is configured.
      const signingKeyWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'signing_key')),
      )
      expect(signingKeyWrite).toBeUndefined()

      writeFileSpy.mockRestore()
    })

    it('does not write a `configured` marker for a decrypt-failed user', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'decrypt_failed',
        fingerprint: 'SHA256:stale',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      const writeFileSpy = jest
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => undefined)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers: makeHandlers(),
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())
      ctx.end('ch1')

      const configuredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'configured')),
      )
      expect(configuredWrite).toBeUndefined()

      const signingKeyWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'signing_key')),
      )
      expect(signingKeyWrite).toBeUndefined()

      writeFileSpy.mockRestore()
    })
  })

  describe('GitHub-linked user — token write + GitHub-derived identity', () => {
    it('writes github_token + gh_configured + GitHub-derived name/email; end() removes it all', async () => {
      const tokenBytes = Buffer.from('gho_faketoken1234567890')
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      ;(resolveGithubToken as jest.Mock).mockReturnValueOnce({
        kind: 'configured',
        tokenPlaintext: Buffer.from(tokenBytes),
        derivedName: 'Jane GH',
        derivedEmail: 'jane@users.noreply.github.com',
        githubLogin: 'janedoe',
      })

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
        handlers: makeHandlers(),
      })
      const mockRelease = jest.fn()

      await ctx.begin('ch1', '123456789012345678', mockRelease)

      const nameWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'name')),
      )
      expect(nameWrite).toBeDefined()
      expect(nameWrite![1]).toBe('Jane GH')

      const emailWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'email')),
      )
      expect(emailWrite).toBeDefined()
      expect(emailWrite![1]).toBe('jane@users.noreply.github.com')

      const tokenWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'github_token')),
      )
      expect(tokenWrite).toBeDefined()
      expect(tokenWrite![2]).toEqual({ mode: 0o600 })

      const ghConfiguredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'gh_configured')),
      )
      expect(ghConfiguredWrite).toBeDefined()

      ctx.end('ch1')

      // Whole idDir removed recursively — covers github_token/gh_configured
      // for free (same recursive-removal path proven for SSH files above).
      expect(rmSyncSpy).toHaveBeenCalledWith(expect.stringContaining('ch1'), {
        recursive: true,
        force: true,
      })

      mkdirSpy.mockRestore()
      writeFileSpy.mockRestore()
      rmSyncSpy.mockRestore()
    })

    it('does not write github_token/gh_configured/signing_key for an SSH-only user (unchanged behavior)', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'configured',
        name: 'SSH Only',
        email: 'sshonly@example.com',
        keyPlaintext: Buffer.from(crypto.randomBytes(64)),
        fingerprint: 'SHA256:sshonly',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(true)
      // GitHub axis stays at the default `unconfigured` mock — no override.

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      const writeFileSpy = jest
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => undefined)
      jest.spyOn(fs, 'rmSync').mockImplementation(() => undefined)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers: makeHandlers(),
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())

      const nameWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'name')),
      )
      expect(nameWrite![1]).toBe('SSH Only')
      const emailWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'email')),
      )
      expect(emailWrite![1]).toBe('sshonly@example.com')

      const tokenWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'github_token')),
      )
      expect(tokenWrite).toBeUndefined()

      const ghConfiguredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'gh_configured')),
      )
      expect(ghConfiguredWrite).toBeUndefined()

      ctx.end('ch1')
      writeFileSpy.mockRestore()
    })

    it('"both" user writes GitHub AND SSH tmpfs artifacts, with name/email GitHub-derived', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'configured',
        name: 'SSH Name',
        email: 'ssh@example.com',
        keyPlaintext: Buffer.from(crypto.randomBytes(64)),
        fingerprint: 'SHA256:both',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(true)
      ;(resolveGithubToken as jest.Mock).mockReturnValueOnce({
        kind: 'configured',
        tokenPlaintext: Buffer.from('gho_bothtoken'),
        derivedName: 'GitHub Name',
        derivedEmail: 'github@users.noreply.github.com',
        githubLogin: 'bothuser',
      })

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      const writeFileSpy = jest
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => undefined)
      jest.spyOn(fs, 'rmSync').mockImplementation(() => undefined)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers: makeHandlers(),
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())

      // Commit identity is GitHub-derived (U1 precedence), not SSH-derived.
      const nameWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'name')),
      )
      expect(nameWrite![1]).toBe('GitHub Name')
      const emailWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'email')),
      )
      expect(emailWrite![1]).toBe('github@users.noreply.github.com')

      // Both GitHub and SSH tmpfs artifacts are present simultaneously.
      const tokenWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'github_token')),
      )
      expect(tokenWrite).toBeDefined()
      const ghConfiguredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'gh_configured')),
      )
      expect(ghConfiguredWrite).toBeDefined()
      const signingKeyWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'signing_key')),
      )
      expect(signingKeyWrite).toBeDefined()
      const configuredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'configured')),
      )
      expect(configuredWrite).toBeDefined()

      writeFileSpy.mockRestore()
    })

    it('CRITICAL REGRESSION GUARD: GitHub-only user (no SSH key at all) still gets the `configured` marker, even with no signing_key/SSH artifacts', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      ;(resolveGithubToken as jest.Mock).mockReturnValueOnce({
        kind: 'configured',
        tokenPlaintext: Buffer.from('gho_githubonly'),
        derivedName: 'GitHub Only',
        derivedEmail: 'ghonly@users.noreply.github.com',
        githubLogin: 'ghonlyuser',
      })

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      const writeFileSpy = jest
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => undefined)
      jest.spyOn(fs, 'rmSync').mockImplementation(() => undefined)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers: makeHandlers(),
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())

      // THE critical assertion: `configured` IS present for a GitHub-only
      // user — scripts/git's own SSH-specific verb-block must NOT fire for
      // this user. Without the identityConfigured fix, this would wrongly
      // be undefined (blocked), breaking AE3/R9/R10.
      const configuredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'configured')),
      )
      expect(configuredWrite).toBeDefined()

      // No SSH-specific artifacts — there's no SSH key at all for this user.
      const signingKeyWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'signing_key')),
      )
      expect(signingKeyWrite).toBeUndefined()
      const keyWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith('ch1.key'),
      )
      expect(keyWrite).toBeUndefined()

      // ssh_command still points at the blocking wrapper (no SSH key to use
      // for non-GitHub remotes/signing) — independent of the GitHub axis.
      const sshWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'ssh_command')),
      )
      expect(sshWrite).toBeDefined()
      expect(sshWrite![1] as string).toContain('git-ssh-wrapper')

      // GitHub artifacts ARE present.
      const tokenWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'github_token')),
      )
      expect(tokenWrite).toBeDefined()
      const ghConfiguredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'gh_configured')),
      )
      expect(ghConfiguredWrite).toBeDefined()

      writeFileSpy.mockRestore()
    })

    it('fully-unconfigured user (neither axis) is unchanged: no configured, no signing_key, no github_token, no gh_configured', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      // GitHub axis stays at the default `unconfigured` mock.

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      const writeFileSpy = jest
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => undefined)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers: makeHandlers(),
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())

      const configuredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'configured')),
      )
      expect(configuredWrite).toBeUndefined()
      const signingKeyWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'signing_key')),
      )
      expect(signingKeyWrite).toBeUndefined()
      const tokenWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'github_token')),
      )
      expect(tokenWrite).toBeUndefined()
      const ghConfiguredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'gh_configured')),
      )
      expect(ghConfiguredWrite).toBeUndefined()

      // Blocked-placeholder identity, matching today's exact values.
      const nameWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'name')),
      )
      expect(nameWrite![1]).toBe('123456789012345678')
      const emailWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'email')),
      )
      expect(emailWrite![1]).toBe('123456789012345678@unconfigured')

      writeFileSpy.mockRestore()
    })

    it('GitHub token decrypt failure: does not write github_token/gh_configured, does not throw', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      ;(resolveGithubToken as jest.Mock).mockReturnValueOnce({
        kind: 'decrypt_failed',
      })

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      const writeFileSpy = jest
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => undefined)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers: makeHandlers(),
      })

      await expect(
        ctx.begin('ch1', '123456789012345678', jest.fn()),
      ).resolves.toBeUndefined()

      const tokenWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'github_token')),
      )
      expect(tokenWrite).toBeUndefined()
      const ghConfiguredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'gh_configured')),
      )
      expect(ghConfiguredWrite).toBeUndefined()
      // A decrypt-failed GitHub axis with an unconfigured SSH axis means
      // identityConfigured is false overall — no `configured` marker either.
      const configuredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'configured')),
      )
      expect(configuredWrite).toBeUndefined()

      writeFileSpy.mockRestore()
    })

    it('abort() mid-turn removes GitHub tmpfs artifacts identically to SSH ones', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      ;(resolveGithubToken as jest.Mock).mockReturnValueOnce({
        kind: 'configured',
        tokenPlaintext: Buffer.from('gho_aborttoken'),
        derivedName: 'Abort User',
        derivedEmail: 'abort@users.noreply.github.com',
        githubLogin: 'abortuser',
      })

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)
      const rmSyncSpy = jest
        .spyOn(fs, 'rmSync')
        .mockImplementation(() => undefined)

      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers: makeHandlers(),
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())
      ctx.abort('ch1')

      // Same recursive idDir removal as end() — covers github_token/
      // gh_configured for free, identical to the SSH-side abort behavior.
      expect(rmSyncSpy).toHaveBeenCalledWith(expect.stringContaining('ch1'), {
        recursive: true,
        force: true,
      })

      rmSyncSpy.mockRestore()
    })
  })

  describe('sweep()', () => {
    it('sweep() does not throw when KEYS_DIR does not exist', () => {
      expect(() => GitTurnContext.sweep()).not.toThrow()
    })
  })

  describe('U5: block-when-unlinked event logging + Discord notice', () => {
    it('unlinked GitHub user (unconfigured) → exactly one gh_blocked event and one onGitOperationBlocked(channelId, "github", "unconfigured") call', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      ;(resolveGithubToken as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      const handlers = makeHandlers()
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers,
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())

      // Exactly one gh_blocked event (the SSH axis is ALSO unconfigured, so
      // git_push_blocked fires too — this test asserts on the GitHub-side
      // call specifically, not total call count).
      const ghBlockedCalls = (insertEvent as jest.Mock).mock.calls.filter(
        ([, opts]) => opts.type === 'gh_blocked',
      )
      expect(ghBlockedCalls).toHaveLength(1)
      expect(ghBlockedCalls[0]![1]).toMatchObject({
        type: 'gh_blocked',
        channelId: 'ch1',
        level: 'warn',
        context: { discordUserId: '123456789012345678', channelId: 'ch1' },
        generationId: 1,
      })

      expect(handlers.onGitOperationBlocked).toHaveBeenCalledWith(
        'ch1',
        'github',
        'unconfigured',
      )
    })

    it('GitHub token decrypt failure → exactly one github_token_decrypt_failed event, distinct from gh_blocked', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      ;(resolveGithubToken as jest.Mock).mockReturnValueOnce({
        kind: 'decrypt_failed',
      })

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      const handlers = makeHandlers()
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers,
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())

      const decryptFailedCalls = (insertEvent as jest.Mock).mock.calls.filter(
        ([, opts]) => opts.type === 'github_token_decrypt_failed',
      )
      expect(decryptFailedCalls).toHaveLength(1)
      const ghBlockedCalls = (insertEvent as jest.Mock).mock.calls.filter(
        ([, opts]) => opts.type === 'gh_blocked',
      )
      expect(ghBlockedCalls).toHaveLength(0)

      expect(handlers.onGitOperationBlocked).toHaveBeenCalledWith(
        'ch1',
        'github',
        'decrypt_failed',
      )
    })

    it('retroactive fix: unconfigured SSH user → a git_push_blocked event (no prior call site existed before U5)', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      // GitHub axis stays at the default `unconfigured` mock.

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      const handlers = makeHandlers()
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers,
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())

      const pushBlockedCalls = (insertEvent as jest.Mock).mock.calls.filter(
        ([, opts]) => opts.type === 'git_push_blocked',
      )
      expect(pushBlockedCalls).toHaveLength(1)
      expect(pushBlockedCalls[0]![1]).toMatchObject({
        type: 'git_push_blocked',
        channelId: 'ch1',
        level: 'warn',
        context: { discordUserId: '123456789012345678', channelId: 'ch1' },
      })

      expect(handlers.onGitOperationBlocked).toHaveBeenCalledWith(
        'ch1',
        'ssh',
        'unconfigured',
      )
    })

    it('retroactive fix: SSH decrypt failure → a git_key_decrypt_failed event', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'decrypt_failed',
        fingerprint: 'SHA256:stale',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      // GitHub axis stays at the default `unconfigured` mock.

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      const handlers = makeHandlers()
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers,
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())

      const keyDecryptFailedCalls = (
        insertEvent as jest.Mock
      ).mock.calls.filter(([, opts]) => opts.type === 'git_key_decrypt_failed')
      expect(keyDecryptFailedCalls).toHaveLength(1)

      expect(handlers.onGitOperationBlocked).toHaveBeenCalledWith(
        'ch1',
        'ssh',
        'decrypt_failed',
      )
    })

    it('CRITICAL: fully-configured "both" user → ZERO block events and ZERO onGitOperationBlocked calls', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'configured',
        name: 'Both User',
        email: 'both@example.com',
        keyPlaintext: Buffer.from(crypto.randomBytes(64)),
        fingerprint: 'SHA256:bothconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(true)
      ;(resolveGithubToken as jest.Mock).mockReturnValueOnce({
        kind: 'configured',
        tokenPlaintext: Buffer.from('gho_bothconfigured'),
        derivedName: 'Both GH',
        derivedEmail: 'both@users.noreply.github.com',
        githubLogin: 'bothconfigured',
      })

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      const handlers = makeHandlers()
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers,
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())

      expect(insertEvent).not.toHaveBeenCalled()
      expect(handlers.onGitOperationBlocked).not.toHaveBeenCalled()
    })

    it('edge case: GitHub configured + SSH decrypt-failed → ZERO block events at turn start (identityConfigured is true, single-axis guard suppresses notices)', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'decrypt_failed',
        fingerprint: 'SHA256:staleboth',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      ;(resolveGithubToken as jest.Mock).mockReturnValueOnce({
        kind: 'configured',
        tokenPlaintext: Buffer.from('gho_githubwins'),
        derivedName: 'GitHub Wins',
        derivedEmail: 'ghwins@users.noreply.github.com',
        githubLogin: 'ghwinsuser',
      })

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      const writeFileSpy = jest
        .spyOn(fs, 'writeFileSync')
        .mockImplementation(() => undefined)

      const handlers = makeHandlers()
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers,
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())

      // Finding #2: the identityConfigured guard suppresses ALL per-axis block
      // events when the combined identity IS configured (GitHub is configured
      // here, so identityConfigured = true). A user who can push via GitHub
      // should not get SSH-block spam at turn start.
      expect(insertEvent).not.toHaveBeenCalled()
      expect(handlers.onGitOperationBlocked).not.toHaveBeenCalled()

      // Turn is NOT blocked overall — the `configured` marker is still
      // written because GitHub-derived identity satisfies identityConfigured.
      const configuredWrite = writeFileSpy.mock.calls.find(([p]) =>
        (p as string).endsWith(path.join('ch1', 'configured')),
      )
      expect(configuredWrite).toBeDefined()

      writeFileSpy.mockRestore()
    })

    it('error path: insertEvent itself throws → logged via the double-fault path, does not crash begin()', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      // GitHub axis stays at the default `unconfigured` mock.
      ;(insertEvent as jest.Mock).mockImplementation(() => {
        throw new Error('SQLITE_BUSY')
      })

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      const handlers = makeHandlers()
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers,
      })

      await expect(
        ctx.begin('ch1', '123456789012345678', jest.fn()),
      ).resolves.toBeUndefined()

      // The handler must never be notified when the DB insert itself failed
      // — onGitOperationBlocked only fires after a successful insert.
      expect(handlers.onGitOperationBlocked).not.toHaveBeenCalled()

      // jest.clearAllMocks() (this file's afterEach) resets call history but
      // NOT a custom mockImplementation — restore the default no-throw
      // behavior explicitly so later tests in this file aren't affected.
      ;(insertEvent as jest.Mock).mockImplementation(() => undefined)
    })

    it('scoping check: block-event logic fires exactly once per axis per begin() call (not per file-write)', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      ;(resolveGithubToken as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      const handlers = makeHandlers()
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: 1,
        handlers,
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())

      // Both axes unconfigured → exactly two events total (one per axis),
      // never more, regardless of how many tmpfs files begin() writes.
      expect(insertEvent).toHaveBeenCalledTimes(2)
      expect(handlers.onGitOperationBlocked).toHaveBeenCalledTimes(2)
    })

    it('does not insert an event or notify when generationId is null', async () => {
      ;(resolveIdentity as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })
      ;(isConfigured as unknown as jest.Mock).mockReturnValueOnce(false)
      ;(resolveGithubToken as jest.Mock).mockReturnValueOnce({
        kind: 'unconfigured',
      })

      jest.spyOn(fs, 'mkdirSync').mockImplementation(() => undefined)
      jest.spyOn(fs, 'writeFileSync').mockImplementation(() => undefined)

      const handlers = makeHandlers()
      const ctx = new GitTurnContext({
        db: makeDb(),
        generationId: null,
        handlers,
      })

      await ctx.begin('ch1', '123456789012345678', jest.fn())

      expect(insertEvent).not.toHaveBeenCalled()
      expect(handlers.onGitOperationBlocked).not.toHaveBeenCalled()
    })
  })
})
