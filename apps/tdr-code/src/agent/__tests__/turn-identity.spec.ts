import { resolveTurnIdentity } from 'src/agent/turn-identity'
import type {
  ConfiguredGithubToken,
  GithubDecryptFailedToken,
  GithubTokenResolution,
  UnconfiguredGithubToken,
} from 'src/crypto/github-token-resolution'
import type {
  ConfiguredIdentity,
  DecryptFailedIdentity,
  IdentityResolution,
  UnconfiguredIdentity,
} from 'src/crypto/identity-resolution'

const USER_ID = '123456789012345678'

// ──────────────────────────────────────────────────────────────────────────────
// Fixture builders — one per state, per axis. Kept as functions (not shared
// constant objects) so each test gets a fresh Buffer instance, matching how
// real resolutions never share Buffer identity across calls.
// ──────────────────────────────────────────────────────────────────────────────

function sshConfigured(): ConfiguredIdentity {
  return {
    kind: 'configured',
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    keyPlaintext: Buffer.from('fake-ssh-key-bytes'),
    fingerprint: 'SHA256:sshfingerprintvalue',
  }
}

function sshUnconfigured(): UnconfiguredIdentity {
  return { kind: 'unconfigured' }
}

function sshDecryptFailed(): DecryptFailedIdentity {
  return { kind: 'decrypt_failed', fingerprint: 'SHA256:sshfingerprintvalue' }
}

function githubConfigured(): ConfiguredGithubToken {
  return {
    kind: 'configured',
    tokenPlaintext: Buffer.from('gho_faketoken1234567890'),
    derivedName: 'The Octocat',
    derivedEmail: '1+octocat@users.noreply.github.com',
    githubLogin: 'octocat',
  }
}

function githubUnconfigured(): UnconfiguredGithubToken {
  return { kind: 'unconfigured' }
}

function githubDecryptFailed(): GithubDecryptFailedToken {
  return { kind: 'decrypt_failed' }
}

describe('resolveTurnIdentity', () => {
  // ────────────────────────────────────────────────────────────────────────
  // Named scenario 1: both configured — GitHub wins for commit identity,
  // SSH key material is STILL present (independent-axis assertion).
  // ────────────────────────────────────────────────────────────────────────
  it('GitHub configured + SSH configured ("both") — GitHub-derived commit identity, githubToken present, SSH key material ALSO present', () => {
    const ssh = sshConfigured()
    const github = githubConfigured()

    const result = resolveTurnIdentity(ssh, github, USER_ID)

    // Commit identity is GitHub-derived, not SSH-derived — exact literal
    // values, not just "is truthy" or "differs from SSH's".
    expect(result.commitName).toBe('The Octocat')
    expect(result.commitEmail).toBe('1+octocat@users.noreply.github.com')

    // GitHub token is present.
    expect(result.githubToken).not.toBeNull()
    expect(Buffer.isBuffer(result.githubToken)).toBe(true)
    expect(result.githubToken?.toString('utf8')).toBe('gho_faketoken1234567890')

    // SSH key material is ALSO present — independent axis, not suppressed by
    // GitHub winning the commit-identity decision.
    expect(result.sshKeyPlaintext).not.toBeNull()
    expect(Buffer.isBuffer(result.sshKeyPlaintext)).toBe(true)
    expect(result.sshKeyPlaintext?.toString('utf8')).toBe('fake-ssh-key-bytes')
    expect(result.signingKeyEligible).toBe(true)

    expect(result.identityConfigured).toBe(true)
    expect(result.githubStatus).toBe('configured')
    expect(result.sshStatus).toBe('configured')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Named scenario 2: GitHub-only.
  // ────────────────────────────────────────────────────────────────────────
  it('GitHub configured + SSH unconfigured ("GitHub-only") — GitHub-derived identity, githubToken present, no SSH key material', () => {
    const result = resolveTurnIdentity(
      sshUnconfigured(),
      githubConfigured(),
      USER_ID,
    )

    expect(result.commitName).toBe('The Octocat')
    expect(result.commitEmail).toBe('1+octocat@users.noreply.github.com')
    expect(result.githubToken?.toString('utf8')).toBe('gho_faketoken1234567890')

    expect(result.sshKeyPlaintext).toBeNull()
    expect(result.signingKeyEligible).toBe(false)

    expect(result.identityConfigured).toBe(true)
    expect(result.githubStatus).toBe('configured')
    expect(result.sshStatus).toBe('unconfigured')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Named scenario 3 (AE3): SSH-only — today's existing, unchanged behavior.
  // ────────────────────────────────────────────────────────────────────────
  it('GitHub unconfigured + SSH configured ("SSH-only") — SSH-derived identity (unchanged), no githubToken', () => {
    const result = resolveTurnIdentity(
      sshConfigured(),
      githubUnconfigured(),
      USER_ID,
    )

    expect(result.commitName).toBe('Ada Lovelace')
    expect(result.commitEmail).toBe('ada@example.com')

    expect(result.githubToken).toBeNull()

    expect(result.sshKeyPlaintext).not.toBeNull()
    expect(result.sshKeyPlaintext?.toString('utf8')).toBe('fake-ssh-key-bytes')
    expect(result.signingKeyEligible).toBe(true)

    expect(result.identityConfigured).toBe(true)
    expect(result.githubStatus).toBe('unconfigured')
    expect(result.sshStatus).toBe('configured')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Named scenario 4: both unconfigured — blocked placeholder, no throw.
  // ────────────────────────────────────────────────────────────────────────
  it('both unconfigured — blocked placeholder identity, both axes report not-configured, does not throw', () => {
    expect(() =>
      resolveTurnIdentity(sshUnconfigured(), githubUnconfigured(), USER_ID),
    ).not.toThrow()

    const result = resolveTurnIdentity(
      sshUnconfigured(),
      githubUnconfigured(),
      USER_ID,
    )

    // Exact placeholder strings, matching git-turn-context.ts's existing
    // `${userId}` / `${userId}@unconfigured` pattern byte-for-byte.
    expect(result.commitName).toBe(USER_ID)
    expect(result.commitEmail).toBe(`${USER_ID}@unconfigured`)

    expect(result.githubToken).toBeNull()
    expect(result.sshKeyPlaintext).toBeNull()
    expect(result.signingKeyEligible).toBe(false)

    expect(result.identityConfigured).toBe(false)
    expect(result.githubStatus).toBe('unconfigured')
    expect(result.sshStatus).toBe('unconfigured')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Named scenario 5: GitHub decrypt_failed + SSH configured — SSH still
  // used; GitHub only "wins" when actually configured.
  // ────────────────────────────────────────────────────────────────────────
  it('GitHub decrypt_failed + SSH configured — SSH-derived identity STILL used; githubStatus reports decrypt_failed distinctly from unconfigured', () => {
    const result = resolveTurnIdentity(
      sshConfigured(),
      githubDecryptFailed(),
      USER_ID,
    )

    expect(result.commitName).toBe('Ada Lovelace')
    expect(result.commitEmail).toBe('ada@example.com')
    expect(result.githubToken).toBeNull()

    expect(result.sshKeyPlaintext).not.toBeNull()
    expect(result.signingKeyEligible).toBe(true)

    expect(result.identityConfigured).toBe(true)
    expect(result.githubStatus).toBe('decrypt_failed')
    expect(result.sshStatus).toBe('configured')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Named scenario 6: GitHub configured + SSH decrypt_failed — GitHub used,
  // SSH push/signing unavailable, sshStatus distinct from unconfigured.
  // ────────────────────────────────────────────────────────────────────────
  it('GitHub configured + SSH decrypt_failed — GitHub-derived identity used, SSH push/signing unavailable, sshStatus reports decrypt_failed distinctly', () => {
    const result = resolveTurnIdentity(
      sshDecryptFailed(),
      githubConfigured(),
      USER_ID,
    )

    expect(result.commitName).toBe('The Octocat')
    expect(result.commitEmail).toBe('1+octocat@users.noreply.github.com')
    expect(result.githubToken?.toString('utf8')).toBe('gho_faketoken1234567890')

    expect(result.sshKeyPlaintext).toBeNull()
    expect(result.signingKeyEligible).toBe(false)

    expect(result.identityConfigured).toBe(true)
    expect(result.githubStatus).toBe('configured')
    expect(result.sshStatus).toBe('decrypt_failed')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Named scenario 7 (AE3, marker-file gap): GitHub configured + SSH
  // unconfigured => identityConfigured true, NOT tied to SSH alone.
  // ────────────────────────────────────────────────────────────────────────
  it('GitHub configured + SSH unconfigured — identityConfigured is true (NOT tied to SSH alone); must not fall through to the SSH-specific verb-block', () => {
    const result = resolveTurnIdentity(
      sshUnconfigured(),
      githubConfigured(),
      USER_ID,
    )

    expect(result.identityConfigured).toBe(true)
    expect(result.sshStatus).toBe('unconfigured')
    expect(result.githubStatus).toBe('configured')
  })

  // ────────────────────────────────────────────────────────────────────────
  // Named scenario 8: all four combinations of {GitHub unconfigured /
  // decrypt_failed} x {SSH unconfigured / decrypt_failed} => identityConfigured
  // is false in every one.
  // ────────────────────────────────────────────────────────────────────────
  describe('identityConfigured is false whenever NEITHER axis is configured', () => {
    const githubNotConfigured: Array<[string, () => GithubTokenResolution]> = [
      ['unconfigured', githubUnconfigured],
      ['decrypt_failed', githubDecryptFailed],
    ]
    const sshNotConfigured: Array<[string, () => IdentityResolution]> = [
      ['unconfigured', sshUnconfigured],
      ['decrypt_failed', sshDecryptFailed],
    ]

    for (const [githubLabel, makeGithub] of githubNotConfigured) {
      for (const [sshLabel, makeSsh] of sshNotConfigured) {
        it(`GitHub ${githubLabel} + SSH ${sshLabel} — identityConfigured is false, blocked placeholder identity used, does not throw`, () => {
          const ssh = makeSsh()
          const github = makeGithub()

          expect(() => resolveTurnIdentity(ssh, github, USER_ID)).not.toThrow()

          const result = resolveTurnIdentity(ssh, github, USER_ID)

          expect(result.identityConfigured).toBe(false)
          expect(result.githubStatus).toBe(githubLabel)
          expect(result.sshStatus).toBe(sshLabel)

          // Neither axis configured => blocked placeholder identity, exact
          // strings, regardless of which specific failure mode (unconfigured
          // vs decrypt_failed) produced the non-configured state.
          expect(result.commitName).toBe(USER_ID)
          expect(result.commitEmail).toBe(`${USER_ID}@unconfigured`)
          expect(result.githubToken).toBeNull()
          expect(result.sshKeyPlaintext).toBeNull()
          expect(result.signingKeyEligible).toBe(false)
        })
      }
    }
  })

  // ────────────────────────────────────────────────────────────────────────
  // Named scenario 9 / Verification: every cell of the full 3x3
  // {configured, unconfigured, decrypt_failed} x {configured, unconfigured,
  // decrypt_failed} matrix, enumerated explicitly and asserted against exact
  // TurnIdentity field values. This is independent of, and overlaps with,
  // the individually-named scenarios above (which exist to give each
  // interesting case a readable, intention-revealing test name) — this
  // block's job is to guarantee no cell of the matrix is ever silently
  // skipped, regardless of how the named scenarios above are organized.
  // ────────────────────────────────────────────────────────────────────────
  describe('full 3x3 matrix cross-check — every {configured, unconfigured, decrypt_failed} combination is exercised', () => {
    const githubStates: Array<[string, () => GithubTokenResolution]> = [
      ['configured', githubConfigured],
      ['unconfigured', githubUnconfigured],
      ['decrypt_failed', githubDecryptFailed],
    ]
    const sshStates: Array<[string, () => IdentityResolution]> = [
      ['configured', sshConfigured],
      ['unconfigured', sshUnconfigured],
      ['decrypt_failed', sshDecryptFailed],
    ]

    const seen = new Set<string>()

    for (const [githubLabel, makeGithub] of githubStates) {
      for (const [sshLabel, makeSsh] of sshStates) {
        seen.add(`${githubLabel}x${sshLabel}`)

        it(`github=${githubLabel}, ssh=${sshLabel}`, () => {
          const ssh = makeSsh()
          const github = makeGithub()
          const result = resolveTurnIdentity(ssh, github, USER_ID)

          // Status passthrough is always exact and never crashes.
          expect(result.githubStatus).toBe(githubLabel)
          expect(result.sshStatus).toBe(sshLabel)

          const githubWins = githubLabel === 'configured'
          const sshWins = !githubWins && sshLabel === 'configured'

          if (githubWins) {
            expect(result.commitName).toBe('The Octocat')
            expect(result.commitEmail).toBe(
              '1+octocat@users.noreply.github.com',
            )
            expect(result.githubToken).not.toBeNull()
          } else if (sshWins) {
            expect(result.commitName).toBe('Ada Lovelace')
            expect(result.commitEmail).toBe('ada@example.com')
            expect(result.githubToken).toBeNull()
          } else {
            expect(result.commitName).toBe(USER_ID)
            expect(result.commitEmail).toBe(`${USER_ID}@unconfigured`)
            expect(result.githubToken).toBeNull()
          }

          if (sshLabel === 'configured') {
            expect(result.sshKeyPlaintext).not.toBeNull()
            expect(result.signingKeyEligible).toBe(true)
          } else {
            expect(result.sshKeyPlaintext).toBeNull()
            expect(result.signingKeyEligible).toBe(false)
          }

          expect(result.identityConfigured).toBe(
            githubWins || sshLabel === 'configured',
          )
        })
      }
    }

    it('sanity: exactly 9 combinations were enumerated (3x3 matrix)', () => {
      expect(seen.size).toBe(9)
    })
  })
})
