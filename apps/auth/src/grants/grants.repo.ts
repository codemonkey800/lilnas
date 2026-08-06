import { and, eq, isNotNull, isNull } from 'drizzle-orm'

import type { Db } from 'src/db/database.module'
import {
  grant,
  type GrantRow,
  preAuthorizedGrant,
  type PreAuthorizedGrantRow,
  user,
  type UserRow,
} from 'src/db/schema'

// Local to this file, mirroring apps/swole/src/db/exercises.ts's own
// per-file Executor pattern rather than a shared cross-file type — works
// against either the live `db` (U5's boot-time preload reads) or a `tx`
// (U7's approve write, and U9's pre-authorization bind, each pairing a
// grant write with another table's write in one transaction).
export type Executor = Pick<Db, 'select' | 'insert' | 'update' | 'delete'>

// ──────────────────────────────────────────────────────────────────────────────
// grants + pre_authorized_grant table access: the boot-time preload reads
// AccessCacheService uses to populate its in-memory maps (R1-R4 grants,
// R16's enforcement half for blocked users), plus every grant/blockedAt/
// pre-authorization WRITE this app performs — admin.controller.ts's approve/
// reject path and users.service.ts's block/unblock/grant-edit/pre-authorize
// mutations all go through the functions below rather than touching the
// `grant`/`user`/`preAuthorizedGrant` tables directly. The natural home for
// a "blocked users" read is here rather than a separate users-repo file,
// since this is where the plan's own U5 task description put it, and every
// later addition has followed that same precedent rather than splitting
// grant-adjacent access across multiple repo files.
// ──────────────────────────────────────────────────────────────────────────────

export type GrantPair = { userId: string; serviceHost: string }

// Every grant row in the table. Homelab scale (tens of users, tens of
// services — see the plan's "Preload grants and blocked accounts at boot"
// Key Technical Decision) means the whole set fits trivially in memory, so
// this full-table scan is the ENTIRE database cost AccessCacheService ever
// pays for grants — spent once at boot, never per-request (R2).
export function listAllGrants(db: Db): GrantPair[] {
  return db
    .select({ userId: grant.userId, serviceHost: grant.serviceHost })
    .from(grant)
    .all()
}

// U7: checked by approveRequest() BEFORE insertGrant() below — grant's
// (userId, serviceHost) unique index (schema.ts) would throw on a second
// insert for an already-granted pair (a double-click, two admins racing on
// the same request, or re-approving a request whose grant a U9 edit already
// created independently), so the write path checks first and treats
// "already granted" as a no-op rather than letting a raw SqliteError
// surface from what should be an idempotent action.
export function grantExists(
  executor: Executor,
  userId: string,
  serviceHost: string,
): boolean {
  return (
    executor
      .select()
      .from(grant)
      .where(and(eq(grant.userId, userId), eq(grant.serviceHost, serviceHost)))
      .get() !== undefined
  )
}

export function insertGrant(
  executor: Executor,
  userId: string,
  serviceHost: string,
  now: Date,
): void {
  executor.insert(grant).values({ userId, serviceHost, createdAt: now }).run()
  // U9 (R14): stamped ONCE, never cleared — see schema.ts's own comment on
  // user.everGrantedAt for why this is the entire mechanism behind "the
  // user list shows a user with at least one grant, current or
  // historical." The WHERE clause (only touch a row that is still NULL) is
  // what makes this a no-op for every grant after a user's first, rather
  // than needing a separate "already set?" read-then-branch.
  executor
    .update(user)
    .set({ everGrantedAt: now })
    .where(and(eq(user.id, userId), isNull(user.everGrantedAt)))
    .run()
}

// U9 (R15's "edit a user's services" / "remove a user"): the DB-level
// counterpart to AccessCacheService.removeGrant()'s in-memory side.
// Deliberately does NOT touch user.everGrantedAt — that marker is
// permanent by design (see insertGrant's own comment), so revoking every
// grant a user has must never make them disappear from the user list.
export function deleteGrant(
  executor: Executor,
  userId: string,
  serviceHost: string,
): void {
  executor
    .delete(grant)
    .where(and(eq(grant.userId, userId), eq(grant.serviceHost, serviceHost)))
    .run()
}

// U9: every service a user currently has standing access to — what the
// admin "edit services" action diffs the submitted desired set against.
// Typed `Executor` (not `Db`) per
// docs/archive/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md
// — callers that read this then write under the SAME transaction (e.g.
// users.service.ts's removeUser()) need to pass a `tx`, not the plain live
// `db`.
export function listGrantsForUser(
  executor: Executor,
  userId: string,
): GrantRow[] {
  return executor.select().from(grant).where(eq(grant.userId, userId)).all()
}

// U9 (R14): the admin user list itself — every user who has ever had a
// grant, current or historical (everGrantedAt IS NOT NULL), regardless of
// whether any grant currently exists. A user whose only history is
// unapproved/pending requests never sets this marker (only insertGrant()
// does), so they correctly stay out of this list.
export function listUsersWithGrantHistory(
  db: Db,
): (typeof user.$inferSelect)[] {
  return db
    .select()
    .from(user)
    .where(isNotNull(user.everGrantedAt))
    .orderBy(user.email)
    .all()
}

// U9 (R15's "pre-authorizing an email that already has a user row attaches
// to the existing user rather than creating a duplicate"): the lookup that
// decides which branch preAuthorize() takes — a real grant for an existing
// user, or a pending pre_authorized_grant row for one that doesn't exist
// yet. Typed `Executor` (not `Db`) for the same read-inside-the-transaction
// reason as listGrantsForUser above — preAuthorize() reads this under the
// SAME `tx` it then writes a grant or pre-authorization row under.
export function findUserByEmail(
  executor: Executor,
  email: string,
): UserRow | undefined {
  return executor.select().from(user).where(eq(user.email, email)).get()
}

// The self-service /me endpoint's own session -> profile lookup — same
// shape as findUserByEmail above, keyed by id (what
// AccessCacheService.resolveSession() actually resolves to) rather than
// email.
export function findUserById(
  executor: Executor,
  userId: string,
): UserRow | undefined {
  return executor.select().from(user).where(eq(user.id, userId)).get()
}

// U9 (R16): the DB-level write for AccessCacheService.blockUser()/
// unblockUser()'s own in-memory Set toggle. `blockedAt: null` unblocks —
// schema.ts's own comment on this column is explicit that null IS "never
// blocked" (not a separate boolean), so clearing it is a real unblock, not
// a soft-delete of a "blocked" record.
export function setBlockedAt(
  executor: Executor,
  userId: string,
  blockedAt: Date | null,
): void {
  executor.update(user).set({ blockedAt }).where(eq(user.id, userId)).run()
}

// ──────────────────────────────────────────────────────────────────────────────
// U9 (R15): pre-authorization by email, for an address with no `user` row
// yet. See schema.ts's own comment on preAuthorizedGrant for why this is a
// separate, email-keyed table rather than an extension of `grant` itself.
// ──────────────────────────────────────────────────────────────────────────────

// Idempotent — U9's own test scenario ("pre-authorizing the same email
// twice is idempotent") is exactly what the table's own unique index
// enforces; onConflictDoNothing() is what turns that constraint from a
// thrown SqliteError into the intended no-op.
export function insertPreAuthorizedGrant(
  executor: Executor,
  email: string,
  serviceHost: string,
  now: Date,
): void {
  executor
    .insert(preAuthorizedGrant)
    .values({ email, serviceHost, createdAt: now })
    .onConflictDoNothing()
    .run()
}

export function findPreAuthorizedGrantsByEmail(
  executor: Executor,
  email: string,
): PreAuthorizedGrantRow[] {
  return executor
    .select()
    .from(preAuthorizedGrant)
    .where(eq(preAuthorizedGrant.email, email))
    .all()
}

// U9's own AccessCacheService.onModuleInit() boot-time preload — mirrors
// listAllGrants()'s identical homelab-scale "whole table fits in memory"
// rationale.
export type PreAuthorizedPair = { email: string; serviceHost: string }

export function listAllPreAuthorizedGrants(db: Db): PreAuthorizedPair[] {
  return db
    .select({
      email: preAuthorizedGrant.email,
      serviceHost: preAuthorizedGrant.serviceHost,
    })
    .from(preAuthorizedGrant)
    .all()
}

// Called once a pending pre-authorization has been materialized into a
// real grant (AccessCacheService.bindPreAuthorizedGrant()) — deleted
// rather than left behind, so a LATER admin revoke of the real grant can
// never be silently undone by a stale row re-binding on the next verify.
export function deletePreAuthorizedGrant(executor: Executor, id: number): void {
  executor.delete(preAuthorizedGrant).where(eq(preAuthorizedGrant.id, id)).run()
}

// Every currently-blocked user id. schema.ts's user.blockedAt is a nullable
// timestamp, not a separate boolean column (see that file's own comment on
// why) — "blocked" is exactly "IS NOT NULL", following the same soft-state
// convention apps/swole's routines.archivedAt uses.
export function listBlockedUserIds(db: Db): string[] {
  return db
    .select({ id: user.id })
    .from(user)
    .where(isNotNull(user.blockedAt))
    .all()
    .map(row => row.id)
}
