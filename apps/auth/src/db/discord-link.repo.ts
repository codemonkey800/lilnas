import { and, desc, eq, isNull, sql } from 'drizzle-orm'

import { normalizeEmail } from 'src/admin/normalize-email'

import type { Db } from './database.module'
import {
  discordIdentity,
  type DiscordIdentityRow,
  discordLink,
  type DiscordLinkRow,
  user,
} from './schema'

// ──────────────────────────────────────────────────────────────────────────────
// discord_identity + discord_link table access.
//
// Every read and write against either table goes through this file — the
// observation path (tdr-bot reporting "this Discord account just ran
// /download"), the admin link/unlink mutations, and the two pick-from-a-list
// columns the admin UI renders. See schema.ts's own header comment above
// `discordIdentity` for WHY the roster and the link are separate tables and
// why nothing in this system ever accepts a hand-typed Discord handle; this
// file is the query surface that follows from that shape.
//
// Placed in src/db/ rather than a feature folder (contrast
// src/grants/grants.repo.ts, src/requests/requests.repo.ts) because it has
// two unrelated consumers already — the admin link UI and the
// observation/attribution path — so neither feature folder is its natural
// owner. src/db/auth-session.repo.ts set that same precedent for the same
// reason.
// ──────────────────────────────────────────────────────────────────────────────

// Local to this file, mirroring src/grants/grants.repo.ts's own per-file
// Executor type rather than importing that one. Deliberate: a src/db/ module
// importing from src/grants/ would invert this app's layering (the feature
// repos depend on src/db/, never the reverse). The two definitions are
// structurally identical, so a caller holding either can pass a `tx` here.
export type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>

// ──────────────────────────────────────────────────────────────────────────────
// Roster (discord_identity) — observation, not assertion
// ──────────────────────────────────────────────────────────────────────────────

export type UpsertIdentityInput = {
  discordUserId: string
  username: string
  // Optional as well as nullable: Discord's globalName is genuinely null for
  // accounts that never set one, and a caller decoding an upstream payload
  // that simply omitted the field shouldn't have to spell `?? null` itself.
  // Both forms collapse to SQL NULL below.
  displayName?: string | null
}

// Three outcomes, not a bare void, because the caller's next action differs
// per outcome: 'inserted' is a brand-new Discord account appearing on the
// roster for the first time, 'updated' means a label actually CHANGED (the
// rename-detection mechanism — see below), and 'unchanged' means nothing but
// the clock moved. An admin notification is worth sending for the first two
// and is pure noise for the third, which is the entire reason this function
// reports rather than swallowing the distinction.
export type UpsertIdentityOutcome = 'inserted' | 'updated' | 'unchanged'

// Records one OBSERVATION of a Discord account.
//
// `lastSeenAt` is bumped on every call regardless of outcome — that is what
// "observed" means, and it's what lets the admin roster sort by recency and
// lets a stale entry be recognised as stale. `username`/`displayName` are
// rewritten whenever they differ from what's stored, which IS the rename
// detection: schema.ts is explicit that both columns are a cache, not an
// identity (nothing keys off them), so a rename is handled by overwriting
// the cache and telling the caller it happened. `firstSeenAt` is written
// once at insert and never touched again.
//
// Read-then-write against a row a concurrent observation can be inserting at
// the same moment, so callers that care about atomicity must pass a `tx`
// opened with BEGIN IMMEDIATE, per
// docs/archive/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md.
// The losing side of an unwrapped race would either throw on the
// discord_user_id primary key or report 'inserted' twice; under the
// immediate transaction it serializes and the second call correctly reports
// 'unchanged'.
export function upsertIdentity(
  executor: Executor,
  input: UpsertIdentityInput,
  now: Date,
): UpsertIdentityOutcome {
  const displayName = input.displayName ?? null

  const existing = findIdentity(executor, input.discordUserId)

  if (!existing) {
    executor
      .insert(discordIdentity)
      .values({
        discordUserId: input.discordUserId,
        username: input.username,
        displayName,
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .run()
    return 'inserted'
  }

  const renamed =
    existing.username !== input.username || existing.displayName !== displayName

  // One UPDATE either way — the labels are set unconditionally (writing the
  // same values back is free) so there is no second code path to keep in
  // sync. Only the RETURN value branches.
  executor
    .update(discordIdentity)
    .set({ username: input.username, displayName, lastSeenAt: now })
    .where(eq(discordIdentity.discordUserId, input.discordUserId))
    .run()

  return renamed ? 'updated' : 'unchanged'
}

export function findIdentity(
  executor: Executor,
  discordUserId: string,
): DiscordIdentityRow | undefined {
  return executor
    .select()
    .from(discordIdentity)
    .where(eq(discordIdentity.discordUserId, discordUserId))
    .get()
}

// ──────────────────────────────────────────────────────────────────────────────
// Link (discord_link) — the admin-made assertion
// ──────────────────────────────────────────────────────────────────────────────

// What the attribution path actually wants when it resolves a Discord
// snowflake: the lilnas person, not the join row. Returning the joined
// `user` columns (rather than a DiscordLinkRow the caller would then have to
// re-query `user` with) keeps that a single query, and keeps the "render a
// link by joining, never by denormalising a label into it" rule schema.ts
// states from leaking into every call site.
export type LinkedUser = { userId: string; email: string; name: string }

export function findLinkByDiscordUserId(
  executor: Executor,
  discordUserId: string,
): LinkedUser | undefined {
  return executor
    .select({ userId: user.id, email: user.email, name: user.name })
    .from(discordLink)
    .innerJoin(user, eq(user.id, discordLink.userId))
    .where(eq(discordLink.discordUserId, discordUserId))
    .get()
}

// The other direction, returning the raw link row — the admin "is this user
// already linked?" check before an insert, which needs the link's own id and
// createdAt rather than user columns it already has in hand.
export function findLinkByUserId(
  executor: Executor,
  userId: string,
): DiscordLinkRow | undefined {
  return executor
    .select()
    .from(discordLink)
    .where(eq(discordLink.userId, userId))
    .get()
}

export type LinkByEmail = { userId: string; discordUserId: string }

// Email-keyed lookup for callers that only know an address (the admin API
// takes an email for the same reason pre-authorization does — it's what a
// human has).
//
// Matched case-insensitively on BOTH sides: the argument through
// normalizeEmail() (the one normalization rule this app has — see
// src/admin/normalize-email.ts), and the stored column through SQL lower().
// Normalizing only the argument — what grants.repo.ts's findUserByEmail()
// does — is enough there because that lookup's inputs are compared against
// addresses this app's own admin flows normalized on the way in. It is NOT
// enough here: `user.email` is written by Better Auth straight from Google's
// userinfo response, never through normalizeEmail(), so a stored address
// with any uppercase in it would silently fail to match a correctly
// normalized query and report "not linked" for someone who is. Homelab
// scale (tens of users) makes the resulting unindexed lower() scan a
// non-issue; a wrong answer would not be.
export function findLinkByEmail(
  executor: Executor,
  email: string,
): LinkByEmail | undefined {
  return executor
    .select({
      userId: discordLink.userId,
      discordUserId: discordLink.discordUserId,
    })
    .from(discordLink)
    .innerJoin(user, eq(user.id, discordLink.userId))
    .where(sql`lower(${user.email}) = ${normalizeEmail(email)}`)
    .get()
}

// ──────────────────────────────────────────────────────────────────────────────
// The admin UI's two pick-from-a-list columns
// ──────────────────────────────────────────────────────────────────────────────

// Left column: lilnas users with no Discord link yet. A LEFT JOIN with an IS
// NULL guard rather than a NOT IN subquery — same plan, and it keeps the
// "one-to-one, enforced by discord_link_user_id_unique_idx" reading obvious.
//
// Blocked users are excluded (blockedAt IS NULL): schema.ts's own comment on
// that column is explicit that null means "never blocked", so this is the
// standard soft-state filter, not a special case. Offering a blocked account
// as a link target would invite an admin to attribute future Discord jobs to
// someone the system has deliberately cut off.
export function listUnlinkedUsers(executor: Executor): LinkedUser[] {
  return executor
    .select({ userId: user.id, email: user.email, name: user.name })
    .from(user)
    .leftJoin(discordLink, eq(discordLink.userId, user.id))
    .where(and(isNull(discordLink.id), isNull(user.blockedAt)))
    .orderBy(user.email)
    .all()
}

// Right column: Discord accounts this system has seen that aren't linked to
// anyone. Ordered most-recently-seen first — an admin linking an account
// almost always just watched it run /download, so the row they want is at
// the top. No blocked-equivalent filter exists on this side: the roster is
// an observation log with no notion of standing.
export function listUnlinkedIdentities(
  executor: Executor,
): DiscordIdentityRow[] {
  return executor
    .select({
      discordUserId: discordIdentity.discordUserId,
      username: discordIdentity.username,
      displayName: discordIdentity.displayName,
      firstSeenAt: discordIdentity.firstSeenAt,
      lastSeenAt: discordIdentity.lastSeenAt,
    })
    .from(discordIdentity)
    .leftJoin(
      discordLink,
      eq(discordLink.discordUserId, discordIdentity.discordUserId),
    )
    .where(isNull(discordLink.id))
    .orderBy(desc(discordIdentity.lastSeenAt))
    .all()
}

// Every existing link, flattened for display. Both sides' labels come from
// their own tables at read time (the link itself stores none — schema.ts's
// "A PURE JOIN" comment), so a Discord rename recorded by upsertIdentity()
// shows up here immediately with nothing else to update.
export type LinkListEntry = {
  userId: string
  email: string
  name: string
  discordUserId: string
  username: string
  displayName: string | null
  createdAt: Date
}

export function listLinks(executor: Executor): LinkListEntry[] {
  return executor
    .select({
      userId: user.id,
      email: user.email,
      name: user.name,
      discordUserId: discordIdentity.discordUserId,
      username: discordIdentity.username,
      displayName: discordIdentity.displayName,
      createdAt: discordLink.createdAt,
    })
    .from(discordLink)
    .innerJoin(user, eq(user.id, discordLink.userId))
    .innerJoin(
      discordIdentity,
      eq(discordIdentity.discordUserId, discordLink.discordUserId),
    )
    .orderBy(user.email)
    .all()
}

// ──────────────────────────────────────────────────────────────────────────────
// Link mutations
// ──────────────────────────────────────────────────────────────────────────────

export type InsertLinkInput = { userId: string; discordUserId: string }

// Deliberately NOT onConflictDoNothing() (contrast
// grants.repo.ts's insertPreAuthorizedGrant, which is idempotent by design).
// A conflict here is never a harmless repeat: it means either this user or
// this Discord account is ALREADY linked — to possibly someone else — and
// both unique indexes exist precisely so that case surfaces instead of being
// absorbed. The same goes for the two foreign keys: linking a snowflake with
// no discord_identity row is exactly the hand-typed-handle mistake the
// schema is shaped to make impossible, and it must throw rather than be
// silently dropped. Callers check with findLinkByUserId()/
// findLinkByDiscordUserId() first (under the same transaction) and turn a
// real conflict into a clear API error.
export function insertLink(
  executor: Executor,
  input: InsertLinkInput,
  now: Date,
): void {
  executor
    .insert(discordLink)
    .values({
      userId: input.userId,
      discordUserId: input.discordUserId,
      createdAt: now,
    })
    .run()
}

// Unlink. Returns rows changed for the same reason grants.repo.ts's
// setBlockedAt() does: a DELETE matching nothing is a silent no-op in
// SQLite, not an error, so without the count the admin API could not tell
// "unlinked" from "there was nothing to unlink" and would report success
// either way.
//
// Note what this does NOT touch: the discord_identity row survives. The
// roster is an observation log — unlinking asserts "this account is not that
// person", never "this account was never seen" — so the identity stays
// available to be re-linked to whoever it actually belongs to.
export function deleteLinkForUser(executor: Executor, userId: string): number {
  return executor
    .delete(discordLink)
    .where(eq(discordLink.userId, userId))
    .run().changes
}
