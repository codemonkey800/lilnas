import { env } from '@lilnas/utils/env'
import { Inject, Injectable } from '@nestjs/common'
import { and, eq } from 'drizzle-orm'
import { PinoLogger } from 'nestjs-pino'

import {
  isGithubConfigured,
  resolveGithubToken,
} from 'src/crypto/github-token-resolution'
import { loadMasterKey } from 'src/crypto/master-key'
import type { Db } from 'src/db/database.module'
import { DB } from 'src/db/database.module'
import {
  getDiscordUserIdForUser,
  getGithubCredential,
} from 'src/db/github-credential.repo'
import { account, githubCredential } from 'src/db/schema'
import { EnvKeys } from 'src/env'
import { LOG_EVENTS } from 'src/logging/log-events'

import type {
  GithubStatusResponseDto,
  UnlinkGithubResponseDto,
} from './github-link.dto'

// GitHub's OAuth-app grant-revocation endpoint (R13's "best-effort revoke").
// DELETE, not the single-token variant — revokes the ENTIRE app-to-user
// grant, which matches this app's one-token-per-user-per-app model (see the
// plan's External References section for the endpoint-choice rationale).
function revokeGrantUrl(clientId: string): string {
  return `https://api.github.com/applications/${clientId}/grant`
}

// GithubLinkService.unlink(userId) is the ONE method both self-unlink
// (DELETE /git/github, userId from the session) and break-glass clear
// (DELETE /git/github/:userId, flat-admin) call — there is no code-level
// difference between the two at this layer; only the controller-level
// resolution of `userId` differs (session vs. route param).
//
// Deliberately uses getGithubCredential (U1's inner-join-against-`account`
// accessor), NOT a new raw-row accessor — per this unit's brief, an
// orphaned github_credential row (no matching `account` row) is already
// invisible everywhere else in the app (U1's read-side invariant), so
// treating it identically here (a no-op, since getGithubCredential returns
// undefined for both "truly unlinked" and "orphaned") is consistent rather
// than special-casing cleanup for a state the rest of the app already
// treats as not-linked. A github_credential row can still exist on disk
// after this no-op, but it is unreachable via any read path and un-revoked
// only because there is no token this service can prove is real work to
// revoke in this same no-op branch.
@Injectable()
export class GithubLinkService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly logger: PinoLogger,
  ) {}

  // Read-only status for the CURRENT session user (GET /git/github/status,
  // U4 addition — see this file's own note in github-link.dto.ts's
  // GithubStatusResponseSchema comment for the full rationale). Deliberately
  // uses getGithubCredential (U1's inner-join-against-`account` accessor),
  // never a raw github_credential read, for the same reason unlink() above
  // does — an orphaned row must read as not-linked here too. No log call:
  // mirrors git-identity.controller.ts's own GET routes, which are
  // read-only and log nothing.
  getStatus(userId: string): GithubStatusResponseDto {
    const discordUserId = getDiscordUserIdForUser(this.db, userId)
    const row = getGithubCredential(this.db, userId)

    if (!row) {
      return { discordUserId, linked: false }
    }

    return {
      discordUserId,
      linked: true,
      derivedName: row.derivedName,
      derivedEmail: row.derivedEmail,
    }
  }

  async unlink(userId: string): Promise<UnlinkGithubResponseDto> {
    this.logger.warn(
      { userId, event: LOG_EVENTS.githubUnlinkRequested },
      'GitHub unlink requested',
    )

    const row = getGithubCredential(this.db, userId)
    if (!row) {
      // No-op: either truly unlinked, or an orphaned github_credential row
      // (see this file's header comment) — both report as "not linked"
      // everywhere else in the app, so unlink is a no-op here too. Not an
      // error (double-clicking "Unlink" or break-glass-clearing an
      // already-unlinked user must succeed silently, per R13).
      this.logger.warn(
        {
          userId,
          unlinked: false,
          event: LOG_EVENTS.githubUnlinkCompleted,
        },
        'GitHub unlink completed (no-op — nothing linked)',
      )
      return { unlinked: false }
    }

    // Best-effort revoke at GitHub BEFORE deleting local rows — decrypt the
    // token only for this one outbound call, never returned to any caller
    // (R7). If decryption itself fails (decrypt_failed), there is nothing
    // decryptable to send; skip the HTTP call entirely rather than sending a
    // garbage/empty token, and proceed straight to deleting local rows.
    const masterKey = loadMasterKey()
    const resolution = resolveGithubToken(row, masterKey)
    if (isGithubConfigured(resolution)) {
      await this.bestEffortRevoke(userId, resolution.tokenPlaintext)
      // Best-effort zeroize the plaintext buffer (mirrors git-identity's own
      // discipline for its decrypted SSH key plaintext).
      resolution.tokenPlaintext.fill(0)
    } else {
      this.logger.warn(
        {
          userId,
          event: LOG_EVENTS.githubRevokeFailed,
          reason: 'decrypt_failed',
        },
        'Skipping GitHub revoke call — stored token could not be decrypted',
      )
    }

    // Delete BOTH the github_credential row and the account row in one
    // BEGIN IMMEDIATE transaction (begin-immediate-for-read-then-write-
    // mutations convention) — a failed delete on either side rolls back the
    // other, so the only reachable "torn" state is the same read-side-
    // handled orphan U1's inner join already covers (an account row
    // surviving with no github_credential row reads as not-linked; the
    // reverse is impossible once both deletes are in one transaction).
    // Every statement inside this callback goes through `tx`, never the
    // outer `this.db` — a stray outer-db call would commit unconditionally
    // and bypass the rollback (see auth-session.repo.ts/github-credential
    // .repo.ts's own tx-only discipline for read-then-write mutations).
    this.db.transaction(
      tx => {
        tx.delete(account)
          .where(
            and(eq(account.userId, userId), eq(account.providerId, 'github')),
          )
          .run()
        tx.delete(githubCredential)
          .where(eq(githubCredential.userId, userId))
          .run()
      },
      { behavior: 'immediate' },
    )

    this.logger.warn(
      {
        userId,
        unlinked: true,
        event: LOG_EVENTS.githubUnlinkCompleted,
      },
      'GitHub unlink completed',
    )
    return { unlinked: true }
  }

  // Best-effort DELETE /applications/{client_id}/grant, Basic Auth
  // (client_id:client_secret), body { access_token }. 204 = success; 422
  // (malformed/already-revoked token) and any other non-2xx are expected,
  // tolerable failure modes — caught and logged at warn with the response
  // status only (never the response body, never err.message/err.stack, per
  // the structured-logging convention — this path handles token material).
  // Never throws; the caller proceeds to delete local rows regardless of
  // outcome (R13's "best-effort").
  private async bestEffortRevoke(
    userId: string,
    tokenPlaintext: Buffer,
  ): Promise<void> {
    const clientId = env(EnvKeys.GITHUB_CLIENT_ID)
    const clientSecret = env(EnvKeys.GITHUB_CLIENT_SECRET)
    const basicAuth = Buffer.from(
      `${clientId}:${clientSecret}`,
      'utf8',
    ).toString('base64')

    try {
      const response = await fetch(revokeGrantUrl(clientId), {
        method: 'DELETE',
        headers: {
          Authorization: `Basic ${basicAuth}`,
          'Content-Type': 'application/json',
          Accept: 'application/vnd.github+json',
        },
        body: JSON.stringify({
          access_token: tokenPlaintext.toString('utf8'),
        }),
        signal: AbortSignal.timeout(10_000),
      })

      if (response.status !== 204) {
        this.logger.warn(
          {
            userId,
            status: response.status,
            event: LOG_EVENTS.githubRevokeFailed,
          },
          'GitHub grant-revocation call returned a non-success status',
        )
      }
    } catch (error) {
      // Network-level failure (DNS, timeout, connection reset, ...) — never
      // log err.message/err.stack on this path (structured-logging
      // convention); coarsen to err.name/class only.
      this.logger.warn(
        {
          userId,
          event: LOG_EVENTS.githubRevokeFailed,
          errName:
            error instanceof Error
              ? error.name
              : (error as object)?.constructor?.name,
        },
        'GitHub grant-revocation call failed (network error)',
      )
    }
  }
}
