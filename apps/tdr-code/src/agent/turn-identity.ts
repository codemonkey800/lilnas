import type { GithubTokenResolution } from 'src/crypto/github-token-resolution'
import type { IdentityResolution } from 'src/crypto/identity-resolution'

// Pure, framework-free, side-effect-free composition of the two independent
// per-turn identity resolutions (SSH, GitHub) into the single combined
// decision the rest of the per-turn-GitHub-enforcement plan applies (R11).
// Both inputs are ALREADY-DECRYPTED resolutions produced upstream by
// resolveIdentity()/resolveGithubToken() — this module does no I/O, no
// crypto, and no logging of its own; it only re-shapes data that has already
// been resolved and (on failure) already logged by its producers.

// ──────────────────────────────────────────────────────────────────────────────
// Per-axis status — a plain re-export of each resolution's `kind`, kept as
// its own type here (rather than importing IdentityResolution['kind'] /
// GithubTokenResolution['kind'] inline at every call site) so U5 has one
// name to switch on when deciding which block/decrypt-failure event (if any)
// to log for each axis.
// ──────────────────────────────────────────────────────────────────────────────
export type AxisStatus = 'configured' | 'unconfigured' | 'decrypt_failed'

export interface TurnIdentity {
  // Commit author identity for every commit made during this turn.
  //
  // KEY TECHNICAL DECISION (see the plan's "Key Technical Decisions" —
  // "Commit identity is GitHub-derived globally once linked, regardless of
  // which remote or protocol a given push targets"): flow analysis found a
  // genuine ambiguity between R10(a) ("SSH key required for non-GitHub
  // remotes") and R11 ("GitHub identity used when linked", with no
  // remote-scoping stated). The adopted reading takes R11's literal text at
  // face value — a "both" user's name/email is GitHub-derived for EVERY
  // commit once linked, full stop, independent of which remote a given
  // push/commit targets. The SSH key's role is strictly limited to (a)
  // authenticating pushes to non-GitHub remotes over SSH and (b) supplying
  // the signing key — it never supplies name/email once GitHub is linked.
  // This is deliberate, not an oversight: the origin document frames this
  // whole feature as "one identity, zero friction," and a per-remote
  // identity switch would reintroduce exactly the friction R8/R11 exist to
  // remove. Getting this "wrong" has low blast radius by design (a "both"
  // user's non-GitHub commits would show a GitHub noreply email instead of
  // their SSH-configured one — cosmetically odd, not a security or
  // attribution failure; commit-identity precision here is UX, not a
  // security boundary).
  commitName: string
  commitEmail: string

  // Per-turn `gh` CLI / GitHub HTTPS push credential. Only populated from a
  // `configured` GitHub resolution — independent of the commit-identity
  // decision above (a "both" user gets BOTH this token AND sshKeyPlaintext
  // below; neither axis's presence depends on the other).
  //
  // TYPE DECISION: Buffer, not string. GithubTokenResolution's
  // ConfiguredGithubToken.tokenPlaintext is already a Buffer (mirroring
  // ConfiguredIdentity.keyPlaintext's own Buffer type), and the plan's U4
  // explicitly flags that the token may need to stay a Buffer up to the
  // point of being written to the per-turn tmpfs file, so it can be
  // best-effort zeroized afterward the same way SSH key plaintext already
  // is (`resolution.keyPlaintext.fill(0)` in git-turn-context.ts). Widening
  // to `string` here would force an early, irreversible UTF-8 decode that
  // throws away that zeroization option for no benefit to this module (which
  // never inspects the token's contents, only passes it through) — so the
  // Buffer is threaded through unchanged and the decision to decode (if
  // ever) is left to the eventual tmpfs-writing call site in U4.
  githubToken: Buffer | null

  // Per-turn SSH key plaintext, for authenticating pushes to non-GitHub
  // remotes over SSH. Only populated from a `configured` SSH resolution.
  // Buffer (not string) for the same zeroize-after-write reason as
  // githubToken above — this mirrors the existing, already-established
  // pattern for `resolution.keyPlaintext` in git-turn-context.ts, not a new
  // decision introduced by this module.
  sshKeyPlaintext: Buffer | null

  // Whether the SSH key (when present) is eligible to be used as a commit
  // signing key. Today every configured SSH identity is signing-eligible
  // (validateAndFingerprint already rejects passphrase-protected keys before
  // an IdentityResolution can ever reach `configured` — see
  // identity-resolution.ts), so this is currently equivalent to
  // `sshKeyPlaintext !== null`. It is surfaced as its own named field
  // (rather than making call sites re-derive it from a null check) so a
  // future, more selective signing-eligibility rule has one place to change
  // without every downstream reader needing to know the underlying
  // condition shifted.
  signingKeyEligible: boolean

  // Generalizes the pre-existing `scripts/git` wrapper's `configured`
  // tmpfs marker file. TRUE whenever EITHER axis (GitHub OR SSH) resolved to
  // `configured` — this is a NEW, distinct concept from either
  // `githubStatus`/`sshStatus` below, not a derived convenience alias for
  // one of them.
  //
  // WHY THIS EXISTS AS ITS OWN FIELD: today (SSH-only, pre-dating this
  // plan), the `configured` marker file means "SSH resolved," and gates
  // `scripts/git`'s commit/push/pull verb-block. This plan's U4 will change
  // that marker's write condition to key on THIS field instead of the SSH
  // axis alone — because leaving it keyed to SSH alone would mean a
  // GitHub-only user (no SSH key at all) never gets the marker written, and
  // would therefore be wrongly caught by `scripts/git`'s pre-existing
  // SSH-specific verb-block. That would directly contradict this plan's AE3
  // acceptance example ("a GitHub-only user needs no SSH key to push") and
  // R9/R10 ("a user may be GitHub-only, SSH-only, both, or neither"). This
  // field generalizes the marker's MEANING from "SSH resolved" to "this turn
  // has *some* way to attribute and push commits" (GitHub OR SSH) — the
  // correct condition for that pre-existing verb-block to key on now that
  // two independent credential axes exist. It is intentionally NOT the same
  // as "githubStatus === 'configured' || sshStatus === 'configured'" spelled
  // out inline at every call site — keeping it as a single named field here
  // means U4 (and any future reader) has exactly one place to look to
  // understand why a turn is or is not allowed to commit/push at all,
  // separate from which SPECIFIC credential(s) back that turn.
  identityConfigured: boolean

  // Per-axis status, verbatim from each input resolution's `kind` — enough
  // for U5 to decide which of the four block/decrypt-failure events (if any)
  // to log: unconfigured -> git_push_blocked / gh_blocked; decrypt_failed ->
  // git_key_decrypt_failed / github_token_decrypt_failed. Deliberately kept
  // distinct from identityConfigured above (which collapses both axes into
  // one boolean for the marker-file decision) — U5 needs to know WHICH
  // axis(es) failed and HOW, not just whether the turn overall is blocked.
  githubStatus: AxisStatus
  sshStatus: AxisStatus
}

// Placeholder commit identity used when NEITHER axis resolves to
// `configured` — mirrors the exact strings git-turn-context.ts's
// pre-existing unconfigured/decrypt-failed branch already writes to the
// `name`/`email` tmpfs files today (`fs.writeFileSync(...,  userId, ...)`
// and `fs.writeFileSync(..., \`${userId}@unconfigured\`, ...)`), so this
// module's blocked-identity output is byte-for-byte compatible with what
// callers already write — no behavior change for the fully-unconfigured
// case, only a new named place the values come from.
function blockedPlaceholder(userId: string): {
  commitName: string
  commitEmail: string
} {
  return {
    commitName: userId,
    commitEmail: `${userId}@unconfigured`,
  }
}

// Composes an already-resolved SSH IdentityResolution and an already-resolved
// GithubTokenResolution into the single TurnIdentity decision the rest of
// this plan applies. Pure and side-effect-free: no I/O, no crypto, no
// logging — both inputs are already-decrypted (or already-failed) results
// from resolveIdentity()/resolveGithubToken(), which have already done their
// own logging on failure. Never throws.
export function resolveTurnIdentity(
  sshResolution: IdentityResolution,
  githubResolution: GithubTokenResolution,
  userId: string,
): TurnIdentity {
  const githubConfigured = githubResolution.kind === 'configured'
  const sshConfigured = sshResolution.kind === 'configured'

  // Commit identity precedence (R11, see the KEY TECHNICAL DECISION comment
  // on TurnIdentity.commitName above): GitHub wins whenever it is actually
  // `configured` — not merely linked-but-undecryptable. A `decrypt_failed`
  // GitHub resolution does NOT win over a `configured` SSH resolution; it
  // falls through to SSH exactly as if GitHub were unconfigured. Only when
  // neither axis is configured do we fall back to the blocked placeholder.
  const { commitName, commitEmail } = githubConfigured
    ? {
        commitName: githubResolution.derivedName,
        commitEmail: githubResolution.derivedEmail,
      }
    : sshConfigured
      ? { commitName: sshResolution.name, commitEmail: sshResolution.email }
      : blockedPlaceholder(userId)

  return {
    commitName,
    commitEmail,
    githubToken: githubConfigured ? githubResolution.tokenPlaintext : null,
    sshKeyPlaintext: sshConfigured ? sshResolution.keyPlaintext : null,
    signingKeyEligible: sshConfigured,
    // Either axis configured => this turn has SOME way to attribute/push
    // commits. See the field's own doc comment on TurnIdentity for why this
    // is a distinct concept from githubStatus/sshStatus below.
    identityConfigured: githubConfigured || sshConfigured,
    githubStatus: githubResolution.kind,
    sshStatus: sshResolution.kind,
  }
}
