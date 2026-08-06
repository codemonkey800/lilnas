import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// ──────────────────────────────────────────────────────────────────────────────
// Schema map (U2 — scaffold only, no auth/verify/request behavior wired yet):
//
//   user · session · account · verification — Better Auth's own tables.
//     Canonical shape per Better Auth 1.6.x's Drizzle/SQLite adapter output,
//     hand-placed here (not machine-generated) so `drizzle-kit generate` —
//     not Better Auth's own migrate tooling — owns migrations for these
//     tables, matching apps/tdr-code/src/db/schema.ts's precedent. `user`
//     carries one addition beyond the canonical shape: `blockedAt` (see its
//     own comment below). Google OAuth wiring (the actual `better-auth`
//     instance, its Drizzle adapter, and any `additionalFields` config
//     needed to round-trip `blockedAt` through it) is U3's job, not this
//     unit's — these tables exist so U3 has somewhere to point the adapter.
//
//   grant — R1-R4: who can reach what. One row per (userId, serviceHost)
//     the user currently has standing access to. Pure current-state: a
//     revoke is a DELETE, never a soft-delete flag — there is no "history"
//     concept for grants the way there is for access_request.
//
//   access_request — R5-R8, R12: the request lifecycle. See the unique-index
//     comment on the table definition below for the load-bearing judgment
//     call on how R6 (absorbing pending state) and R12 (per-pair history)
//     coexist under one schema.
// ──────────────────────────────────────────────────────────────────────────────

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' })
    .notNull()
    .default(false),
  image: text('image'),
  // R16 addition beyond Better Auth's canonical user shape. Judgment call:
  // extended directly on `user` rather than a side table, since "blocked" is
  // a 1:1 property of the identity row, not a separate lifecycle entity with
  // its own history (contrast with `access_request`, which genuinely needs
  // multiple rows over time). A nullable timestamp (not a boolean) follows
  // the same soft-state convention as apps/swole's routines.archivedAt —
  // null means never blocked, a value both flags the block AND records when,
  // for free. U3 will need to add this field to the `better-auth` instance's
  // `user.additionalFields` config so it round-trips through the adapter;
  // U9 is what actually reads/writes it.
  blockedAt: integer('blocked_at', { mode: 'timestamp_ms' }),
  // U9 (R14): "the user list shows only users with at least one grant,
  // current or historical." `grant` itself is pure current-state (a revoke
  // is a DELETE — see that table's own comment) precisely because R1-R4/R7/
  // R11 never needed history there; R14 is the first requirement that does.
  // Rather than turning EVERY grant into a soft-delete row (churning every
  // existing grants.repo.ts/access-cache.service.ts read to add a WHERE
  // revoked_at IS NULL filter, for a fact R14 only ever needs as a
  // yes/no), this single marker is set ONCE — the first time ANY grant is
  // ever inserted for this user (grants.repo.ts's insertGrant) — and NEVER
  // cleared, including when every grant is later revoked. "At least one
  // grant, current or historical" is then exactly `everGrantedAt IS NOT
  // NULL`. Deliberately NOT added to auth.ts's user.additionalFields
  // (unlike blockedAt) — nothing ever reads or writes this field through
  // Better Auth's own adapter surface (only U9's direct Drizzle queries do,
  // the same way blockUser()/unblockUser() already bypass that surface for
  // blockedAt), so round-tripping it through an API this app never calls
  // would be unused surface, not a real need.
  everGrantedAt: integer('ever_granted_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export type UserRow = typeof user.$inferSelect

// Named AuthSessionRow (not SessionRow) so the verify path's own in-memory
// cache (U5) can use "session" vocabulary for its cached-session shape
// without colliding with this table's row type — same defensive naming
// apps/tdr-code/src/db/schema.ts uses for the identical reason.
export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  t => [index('session_user_id_idx').on(t.userId)],
)

export type AuthSessionRow = typeof session.$inferSelect

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', {
      mode: 'timestamp_ms',
    }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => [
    index('account_user_id_idx').on(t.userId),
    // Defense against two account rows aliasing the same provider identity
    // (e.g. the same Google subject linked twice). Partial rather than a
    // plain unique index because Better Auth's credential provider can
    // insert accountId values that aren't provider-scoped for non-social
    // providers — scoping to providerId keeps the constraint meaningful
    // without assuming every row is a Google row. Mirrors
    // apps/tdr-code/src/db/schema.ts's identical defense for Discord.
    uniqueIndex('account_provider_account_unique_idx')
      .on(t.providerId, t.accountId)
      .where(sql`${t.providerId} IS NOT NULL AND ${t.accountId} IS NOT NULL`),
  ],
)

export type AccountRow = typeof account.$inferSelect

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => [index('verification_identifier_idx').on(t.identifier)],
)

export type VerificationRow = typeof verification.$inferSelect

// ──────────────────────────────────────────────────────────────────────────────
// grant — R1-R4
// ──────────────────────────────────────────────────────────────────────────────

export const grant = sqliteTable(
  'grant',
  {
    id: integer().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    serviceHost: text('service_host').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => [
    // Full (non-partial) unique index: a grant is pure current-state, so two
    // rows for the same pair would be a straight duplicate-data bug (e.g. a
    // revoke that deletes one row would silently leave the other granting
    // access). Not explicitly called out in the plan's schema section the
    // way access_request's index is, but the same "correct by construction"
    // rationale applies, so it's added here rather than left to application
    // discipline in U5/U7/U9.
    uniqueIndex('grant_user_service_unique_idx').on(t.userId, t.serviceHost),
  ],
)

export type GrantRow = typeof grant.$inferSelect

// ──────────────────────────────────────────────────────────────────────────────
// pre_authorized_grant — U9 (R15): "add by email" for an address with no
// `user` row yet. Deliberately NOT keyed by userId (grant's own shape) —
// there IS no userId until that person actually signs in with Google for
// the first time, and better-auth mints ids internally at that moment, not
// before. Rows here are keyed by email instead, and are consumed (deleted)
// the moment they bind — see
// src/verify/access-cache.service.ts's bindPreAuthorizedGrant() for the
// binding mechanism and why it runs on that user's first /verify rather
// than a databaseHooks.user.create.after auth-time hook (the more
// "obvious" seam, rejected because it would need AccessCacheService
// injected into buildAuth()'s factory, which is circular:
// AccessCacheService itself depends on AuthService, which only exists once
// AuthModule — the module whose factory would need to inject
// AccessCacheService — has finished constructing). If the admin's
// "pre-authorize by email" action finds an EXISTING user row for that
// email, it writes directly to `grant` instead and never creates a row
// here at all — this table only ever represents a person who has not yet
// signed in.
// ──────────────────────────────────────────────────────────────────────────────

export const preAuthorizedGrant = sqliteTable(
  'pre_authorized_grant',
  {
    id: integer().primaryKey(),
    email: text('email').notNull(),
    serviceHost: text('service_host').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => [
    // Idempotent re-pre-authorization (U9's own test scenario: "pre-
    // authorizing the same email twice is idempotent") — a second call for
    // the same (email, serviceHost) pair is a no-op, not a duplicate row.
    uniqueIndex('pre_authorized_grant_email_service_unique_idx').on(
      t.email,
      t.serviceHost,
    ),
    // The binding lookup's own access path (find every pending
    // pre-authorization for a just-identified email).
    index('pre_authorized_grant_email_idx').on(t.email),
  ],
)

export type PreAuthorizedGrantRow = typeof preAuthorizedGrant.$inferSelect

// ──────────────────────────────────────────────────────────────────────────────
// access_request — R5-R8, R12
// ──────────────────────────────────────────────────────────────────────────────

export const ACCESS_REQUEST_STATUSES = [
  'pending',
  'approved',
  'rejected',
] as const
export type AccessRequestStatus = (typeof ACCESS_REQUEST_STATUSES)[number]

export const accessRequest = sqliteTable(
  'access_request',
  {
    id: integer().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    serviceHost: text('service_host').notNull(),
    status: text('status', { enum: ACCESS_REQUEST_STATUSES })
      .notNull()
      .default('pending'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // Bumped (not replaced) on every re-request absorbed into an existing
    // pending row — see AE1/R6.
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
    // Set exactly when an admin approves or rejects; null while pending.
    decidedAt: integer('decided_at', { mode: 'timestamp_ms' }),
  },
  t => [
    check(
      'access_request_status_check',
      sql`${t.status} IN ('pending','approved','rejected')`,
    ),
    // Correlation: decided_at is set iff the row has left the pending state.
    // Mirrors the ended_at/end_reason correlation checks in
    // apps/tdr-code/src/db/schema.ts (sessions_ended_correlation_check).
    check(
      'access_request_decided_correlation_check',
      sql`(${t.status} = 'pending') = (${t.decidedAt} IS NULL)`,
    ),
    // Judgment call (flagged for review — see U2's final report): a PARTIAL
    // unique index scoped to status = 'pending', not a blanket unique index
    // over the whole table. Reasoning:
    //   - R6 needs "at most one PENDING request per (user, service)" —
    //     enforced by construction, which is exactly what the plan's
    //     "not optional" instruction is about. A concurrent double-insert
    //     race for two simultaneous first-time requests hits this index
    //     and must fall back to an UPDATE/absorb path (U6, per
    //     docs/archive/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md
    //     and .../atomicity-tests-must-reach-the-write-phase-2026-06-03.md).
    //   - R8 says a re-request after a cooldown "creates a fresh queue
    //     item" and R12 wants that history visible inline ("4th request,
    //     rejected 3x") — both read as literally requiring multiple rows
    //     per pair over time. A blanket unique index would make that
    //     impossible outright, which would contradict R8/R12's own wording.
    //   A partial index scoped to 'pending' satisfies both: only one row
    //   may ever be the live pending request for a pair, while any number
    //   of terminal (approved/rejected) rows may coexist as history.
    uniqueIndex('access_request_pending_unique_idx')
      .on(t.userId, t.serviceHost)
      .where(sql`${t.status} = 'pending'`),
    // Full-history lookup across all statuses (R12) — the partial index
    // above can't serve a query that doesn't filter on status = 'pending'.
    index('access_request_user_service_idx').on(t.userId, t.serviceHost),
    // Admin queue's "list all pending requests" scan (R10).
    index('access_request_status_idx').on(t.status),
  ],
)

export type AccessRequestRow = typeof accessRequest.$inferSelect
