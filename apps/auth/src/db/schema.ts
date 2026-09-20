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
// Schema map:
//
//   user · session · account · verification — Better Auth's own tables.
//     Canonical shape per Better Auth 1.6.x's Drizzle/SQLite adapter output,
//     hand-placed here (not machine-generated) so `drizzle-kit generate` —
//     not Better Auth's own migrate tooling — owns migrations for these
//     tables, matching apps/tdr-code/src/db/schema.ts's precedent. `user`
//     carries one addition beyond the canonical shape: `blockedAt` (see its
//     own comment below). Google OAuth wiring (the actual `better-auth`
//     instance, its Drizzle adapter, and any `additionalFields` config
//     needed to round-trip `blockedAt` through it) lives in auth.ts — these
//     tables exist as the shape that adapter points to.
//
//   grant — who can reach what. One row per (userId, serviceHost) the user
//     currently has standing access to. Pure current-state: a revoke is a
//     DELETE, never a soft-delete flag — there is no "history" concept for
//     grants the way there is for access_request.
//
//   access_request — the request lifecycle. See the unique-index comment on
//     the table definition below for the load-bearing judgment call on how
//     absorbing pending state and per-pair history coexist under one
//     schema.
//
//   discord_identity · discord_link — the admin-made bridge between a lilnas
//     user and a Discord account. `discord_identity` is a roster of every
//     Discord account this system has ever OBSERVED (never typed);
//     `discord_link` is the pure join between that roster and `user`. See
//     their own header comment below for why the link is a separate table
//     from the identity, and why neither the link nor the UI ever accepts a
//     hand-typed Discord handle.
// ──────────────────────────────────────────────────────────────────────────────

export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' })
    .notNull()
    .default(false),
  image: text('image'),
  // Addition beyond Better Auth's canonical user shape. Judgment call:
  // extended directly on `user` rather than a side table, since "blocked" is
  // a 1:1 property of the identity row, not a separate lifecycle entity with
  // its own history (contrast with `access_request`, which genuinely needs
  // multiple rows over time). A nullable timestamp (not a boolean) follows
  // the same soft-state convention as apps/swole's routines.archivedAt —
  // null means never blocked, a value both flags the block AND records when,
  // for free. auth.ts adds this field to the `better-auth` instance's
  // `user.additionalFields` config so it round-trips through the adapter;
  // users.service.ts is what actually reads/writes it.
  blockedAt: integer('blocked_at', { mode: 'timestamp_ms' }),
  // "The user list shows only users with at least one grant, current or
  // historical." `grant` itself is pure current-state (a revoke is a
  // DELETE — see that table's own comment) precisely because nothing else
  // ever needed history there; this is the first requirement that does.
  // Rather than turning EVERY grant into a soft-delete row (churning every
  // existing grants.repo.ts/access-cache.service.ts read to add a WHERE
  // revoked_at IS NULL filter, for a fact only ever needed as a yes/no),
  // this single marker is set ONCE — the first time ANY grant is ever
  // inserted for this user (grants.repo.ts's insertGrant) — and NEVER
  // cleared, including when every grant is later revoked. "At least one
  // grant, current or historical" is then exactly `everGrantedAt IS NOT
  // NULL`. Deliberately NOT added to auth.ts's user.additionalFields
  // (unlike blockedAt) — nothing ever reads or writes this field through
  // Better Auth's own adapter surface (only users.service.ts's direct
  // Drizzle queries do, the same way blockUser()/unblockUser() already
  // bypass that surface for blockedAt), so round-tripping it through an
  // API this app never calls would be unused surface, not a real need.
  everGrantedAt: integer('ever_granted_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

export type UserRow = typeof user.$inferSelect

// Named AuthSessionRow (not SessionRow) so the verify path's own in-memory
// cache (AccessCacheService) can use "session" vocabulary for its
// cached-session shape without colliding with this table's row type — same
// defensive naming apps/tdr-code/src/db/schema.ts uses for the identical
// reason.
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
// grant
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
    // access). The same "correct by construction" rationale as
    // access_request's own partial index applies here too, so it's enforced
    // at the schema level rather than left to application discipline.
    uniqueIndex('grant_user_service_unique_idx').on(t.userId, t.serviceHost),
  ],
)

export type GrantRow = typeof grant.$inferSelect

// ──────────────────────────────────────────────────────────────────────────────
// pre_authorized_grant — "add by email" for an address with no `user` row
// yet. Deliberately NOT keyed by userId (grant's own shape) —
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
    // Idempotent re-pre-authorization: pre-authorizing the same email twice
    // for the same (email, serviceHost) pair is a no-op, not a duplicate
    // row.
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
// access_request
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
    // pending row.
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
    // Judgment call: a PARTIAL unique index scoped to status = 'pending',
    // not a blanket unique index over the whole table. Reasoning:
    //   - At most one PENDING request per (user, service) needs to be
    //     enforced by construction. A concurrent double-insert race for two
    //     simultaneous first-time requests hits this index and must fall
    //     back to an UPDATE/absorb path, per
    //     docs/archive/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md
    //     and .../atomicity-tests-must-reach-the-write-phase-2026-06-03.md.
    //   - A re-request creates a fresh queue item, and that per-pair
    //     history needs to stay visible inline (e.g. "4th request,
    //     rejected 3x") — both imply multiple rows per pair over time. A
    //     blanket unique index would make that impossible outright.
    //   A partial index scoped to 'pending' satisfies both: only one row
    //   may ever be the live pending request for a pair, while any number
    //   of terminal (approved/rejected) rows may coexist as history.
    uniqueIndex('access_request_pending_unique_idx')
      .on(t.userId, t.serviceHost)
      .where(sql`${t.status} = 'pending'`),
    // Full-history lookup across all statuses — the partial index above
    // can't serve a query that doesn't filter on status = 'pending'.
    index('access_request_user_service_idx').on(t.userId, t.serviceHost),
    // Admin queue's "list all pending requests" scan.
    index('access_request_status_idx').on(t.status),
  ],
)

export type AccessRequestRow = typeof accessRequest.$inferSelect

// ──────────────────────────────────────────────────────────────────────────────
// discord_identity + discord_link — attributing a job to a lilnas person
//
// apps/tdr-bot's Discord `/download` command creates jobs in apps/download
// that are otherwise anonymous. Attribution needs two halves, and this app
// owns the half that says "this Discord account IS this lilnas user."
//
// WHY THIS IS NOT BETTER AUTH `account`. The obvious shape would be a second
// linked social provider (Better Auth's own `account` row with providerId =
// 'discord'). It isn't available: this app's better-auth instance is
// Google-only by design (see auth.ts — "no second linkable provider"), there
// is no Discord OAuth app, and there is deliberately no self-serve linking
// flow. The link is made by an ADMIN, through the admin API, so it lives in
// a plain table this app fully owns rather than in Better Auth's surface.
//
// WHY TWO TABLES, NOT ONE. `discord_identity` is a roster, `discord_link` is
// an assertion, and they are populated by different actors at different
// times. The roster fills itself in by OBSERVATION — a Discord account
// appears here the first time it runs `/download`, whether or not anyone
// ever links it. The link is written by an admin later (or never). Folding
// them together would force a choice between a link row with a null userId
// (an "identity" pretending to be a link) and losing the roster entirely.
//
// WHY EVERYTHING IS OBSERVED AND NOTHING IS TYPED. The admin UI is two
// pick-from-a-list columns — lilnas users on one side, seen Discord accounts
// on the other — precisely because a typed handle is a snapshot that rots.
// Discord usernames are changeable, so a handle captured at link time stops
// naming the person it named; a typo produces a link that silently matches
// nobody and looks correct. Both sides of that UI are already free: the
// lilnas side is the existing `user` table (Better Auth writes a row on
// first Google sign-in, so "people with no Discord link" is a LEFT JOIN over
// it — no table needed for that half), and the Discord side is this roster.
// ──────────────────────────────────────────────────────────────────────────────

export const discordIdentity = sqliteTable('discord_identity', {
  // Discord snowflake. TEXT, not INTEGER: snowflakes are 64-bit and exceed
  // Number.MAX_SAFE_INTEGER, so any numeric round-trip through JS silently
  // corrupts the low bits of a real id. Validated as /^\d{17,20}$/ at the
  // API boundary, never coerced to a number anywhere. This is also the
  // PRIMARY KEY because the snowflake is the only immutable thing Discord
  // gives us — every other field on this row is a mutable label.
  discordUserId: text('discord_user_id').primaryKey(),
  // Current Discord handle (post-2023 form: 2–32 chars of a-z0-9._).
  // Deliberately a CACHE, not an identity: refreshed on every observation
  // so the admin list shows what the account is called *today*. Nothing
  // keys off it, so a rename is a non-event — it updates this column and
  // changes nothing else in the system.
  username: text('username').notNull(),
  // Discord's globalName (or server display name) — nullable because
  // Discord's own API returns null for accounts that never set one. Same
  // cache-not-identity status as `username`.
  displayName: text('display_name'),
  // First/last observation. `firstSeenAt` is written once at insert and
  // never touched again; `lastSeenAt` is bumped on every subsequent
  // observation, which is what lets the admin list sort by recency and lets
  // a stale roster entry be recognised as stale. Same
  // integer(timestamp_ms) convention as every other timestamp in this file.
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
})

export type DiscordIdentityRow = typeof discordIdentity.$inferSelect

export const discordLink = sqliteTable(
  'discord_link',
  {
    // Surrogate integer PK, matching `grant`/`access_request`'s bare
    // integer().primaryKey() precedent above. Neither natural key is used
    // as the PK because BOTH sides are unique (see the indexes below) —
    // picking one would arbitrarily privilege a direction.
    id: integer().primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    // FK to the roster, not a free-floating snowflake. This is the
    // DB-level expression of the pick-from-a-list UI: you may only link a
    // Discord account that has actually been SEEN. A hand-typed or
    // mistyped snowflake has no `discord_identity` row, so the insert
    // fails loudly here instead of creating a link that silently matches
    // nobody forever.
    discordUserId: text('discord_user_id')
      .notNull()
      .references(() => discordIdentity.discordUserId, {
        onDelete: 'cascade',
      }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => [
    // A PURE JOIN — note what is NOT here: no username, no display name, no
    // copy of any label from either side. Names live on `discord_identity`
    // (refreshed on every observation) and on `user`; denormalising either
    // one into the link would reintroduce exactly the rotting snapshot this
    // design exists to avoid. Render a link by joining.
    //
    // Two unique indexes, one per direction, because the relationship is
    // one-to-one BOTH ways: a lilnas user has at most one Discord account,
    // and a Discord account belongs to at most one lilnas user. Enforced by
    // construction rather than by application discipline, for the same
    // reason `grant`'s unique index is — a duplicate here would make
    // "whose job is this?" ambiguous, and a re-link that deletes one row
    // would silently leave the other attributing jobs to the wrong person.
    uniqueIndex('discord_link_user_id_unique_idx').on(t.userId),
    uniqueIndex('discord_link_discord_user_id_unique_idx').on(t.discordUserId),
  ],
)

export type DiscordLinkRow = typeof discordLink.$inferSelect
