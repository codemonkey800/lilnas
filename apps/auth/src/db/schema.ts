import { sql } from 'drizzle-orm'
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core'

// ──────────────────────────────────────────────────────────────────────────────
// Schema map:
//
//   user · session · account · verification — Better Auth's own tables.
//     Canonical shape per Better Auth 1.7.x's Drizzle/SQLite adapter output,
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
//     currently has standing access to, where serviceHost is a host
//     MATCHER: a literal host or an access-rule pattern like
//     `*.dev.lilnas.io` (see src/grants/host-matcher.ts). Pure
//     current-state: a revoke is a DELETE, never a soft-delete flag — there
//     is no "history" concept for grants the way there is for
//     access_request.
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
//
//   gated_host — every host /verify has been asked about, i.e. every host
//     Traefik actually routes through the lilnas-auth middleware. The
//     service registry's second source, for hosts that live outside this
//     repo's compose files (e.g. a ~/dev project exposed at
//     *.dev.lilnas.io). See its own comment below.
//
//   host_visit — the last time each user was allowed through /verify to each
//     host. Backs the host-activity count the dev-idle-reaper asks for
//     ("how many distinct users visited this host in the last N hours").
//     See its own comment below.
//
//   oauth_client · oauth_resource · oauth_client_resource ·
//   oauth_refresh_token · oauth_access_token · oauth_consent ·
//   oauth_client_assertion · jwks — storage for the OIDC provider (the `jwt` +
//   `oauthProvider` Better Auth plugins wired in auth.ts). Models are
//   dictated by the plugins, not designed here; see the block at the bottom
//   of this file.
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
//
// `service_host` is a host matcher, not necessarily a literal host: either
// an exact host (`swole.lilnas.io`) or an access-rule pattern
// (`*.dev.lilnas.io`) granting every host below that suffix. Both share this
// table and its unique index — see src/grants/host-matcher.ts for the
// matching rules and AccessCacheService for how /verify applies them.
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
// signed in. `service_host` is a host matcher here too (a literal host or
// a `*.<suffix>` pattern, see `grant` above) and binds into `grant`
// unchanged.
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

// A host Traefik has sent through the lilnas-auth ForwardAuth middleware.
// Traefik only calls /verify for routers carrying that middleware, so a row
// here is proof the host is gated — no compose file or Docker socket needed
// to discover it. That is what lets a project outside this repo (anything
// joined to `lilnas-proxy` with `middlewares=lilnas-auth`, see
// docs/lilnas-expose.md) show up in the registry. `lastSeenAt` lets a host
// whose project was torn down age out instead of listing forever;
// gated-hosts.service.ts owns the write throttling and the age cutoff.
export const gatedHost = sqliteTable('gated_host', {
  // Lowercase, via normalizeHost() — the same form grants and
  // access_request rows are keyed on.
  host: text('host').primaryKey(),
  firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
  lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
})

export type GatedHostRow = typeof gatedHost.$inferSelect

// One row per (host, user): the last time /verify let that user through to
// that host. Only `allow` decisions for a real session are recorded —
// anonymous, blocked and pending requests are not visits. Counting the rows
// whose lastSeenAt falls inside a window gives "distinct users who visited in
// the last N hours"; host-activity.service.ts owns the write throttling.
// Rows cascade away with their user. A row never ages out on its own: the
// table is bounded by (hosts x users), which stays tiny.
export const hostVisit = sqliteTable(
  'host_visit',
  {
    // Lowercase, via normalizeHost() — same form as gated_host.host.
    host: text('host').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
  },
  t => [
    primaryKey({ columns: [t.host, t.userId] }),
    index('host_visit_host_last_seen_idx').on(t.host, t.lastSeenAt),
  ],
)

export type HostVisitRow = typeof hostVisit.$inferSelect

// OIDC provider tables. Field lists are copied from the models declared by
// the installed plugins — the seven `oauth*` models from
// @better-auth/oauth-provider@1.7.12's dist/authorize-*.mjs (`src/schema.ts`
// region) and `jwks` from better-auth@1.7.12's dist/plugins/jwt/schema.mjs.
// Every model the plugins declare must exist here, used or not: since 1.7 the
// Drizzle adapter checks this schema against them and throws a
// SchemaMismatchError on a missing table or column.
//
// Conventions follow the Better Auth tables above: snake_case columns,
// `timestamp_ms` dates, text ids. The SQLite adapter JSON-encodes `string[]`
// and `json` fields itself (`supportsJSON`/`supportsArrays` are pg-only), so
// those are plain `text`, not drizzle's `mode: 'json'` that `auth generate`
// emits. A reference with no declared `onDelete` cascades (Better Auth's own
// generator default); `sessionId` is declared `set null` and is kept so.
// Columns added in 1.7 are all optional in the plugin, so they are nullable,
// which keeps the 1.7 migration to plain ADD COLUMNs.

// `clientId` (not `id`) is what every other oauth table references, and what
// the plugin looks clients up by. It is unique, which SQLite requires of a
// foreign-key parent column.
export const oauthClient = sqliteTable(
  'oauth_client',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id').notNull().unique(),
    clientSecret: text('client_secret'),
    clientDiscoveryId: text('client_discovery_id'),
    disabled: integer('disabled', { mode: 'boolean' }).default(false),
    skipConsent: integer('skip_consent', { mode: 'boolean' }),
    enableEndSession: integer('enable_end_session', { mode: 'boolean' }),
    subjectType: text('subject_type'),
    scopes: text('scopes'),
    clientCredentialsScopes: text('client_credentials_scopes').default('[]'),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
    name: text('name'),
    uri: text('uri'),
    icon: text('icon'),
    contacts: text('contacts'),
    tos: text('tos'),
    policy: text('policy'),
    softwareId: text('software_id'),
    softwareVersion: text('software_version'),
    softwareStatement: text('software_statement'),
    redirectUris: text('redirect_uris').notNull(),
    postLogoutRedirectUris: text('post_logout_redirect_uris'),
    backchannelLogoutUri: text('backchannel_logout_uri'),
    backchannelLogoutSessionRequired: integer(
      'backchannel_logout_session_required',
      { mode: 'boolean' },
    ),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
    applicationType: text('application_type'),
    jwks: text('jwks'),
    jwksUri: text('jwks_uri'),
    grantTypes: text('grant_types'),
    responseTypes: text('response_types'),
    requirePKCE: integer('require_pkce', { mode: 'boolean' }),
    dpopBoundAccessTokens: integer('dpop_bound_access_tokens', {
      mode: 'boolean',
    }).default(false),
    referenceId: text('reference_id'),
    metadata: text('metadata'),
  },
  t => [index('oauth_client_user_id_idx').on(t.userId)],
)

export type OauthClientRow = typeof oauthClient.$inferSelect

// RFC 8707 protected resources (the `resource` parameter) and which clients
// may request them. Unused here — no resources are registered — but the
// plugin declares both, so they must exist (see the block comment above).
export const oauthResource = sqliteTable('oauth_resource', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  accessTokenTtl: integer('access_token_ttl'),
  refreshTokenTtl: integer('refresh_token_ttl'),
  signingAlgorithm: text('signing_algorithm'),
  signingKeyId: text('signing_key_id'),
  allowedScopes: text('allowed_scopes'),
  customClaims: text('custom_claims'),
  dpopBoundAccessTokensRequired: integer('dpop_bound_access_tokens_required', {
    mode: 'boolean',
  }).default(false),
  disabled: integer('disabled', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  policyVersion: integer('policy_version').default(1),
  metadata: text('metadata'),
})

export const oauthClientResource = sqliteTable(
  'oauth_client_resource',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    resourceId: text('resource_id')
      .notNull()
      .references(() => oauthResource.identifier, { onDelete: 'cascade' }),
    metadata: text('metadata'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  },
  t => [
    uniqueIndex('oauth_client_resource_client_id_resource_id_unique_idx').on(
      t.clientId,
      t.resourceId,
    ),
    index('oauth_client_resource_client_id_idx').on(t.clientId),
    index('oauth_client_resource_resource_id_idx').on(t.resourceId),
  ],
)

export const oauthRefreshToken = sqliteTable(
  'oauth_refresh_token',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull().unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => session.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources'),
    requestedUserInfoClaims: text('requested_user_info_claims'),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    revoked: integer('revoked', { mode: 'timestamp_ms' }),
    rotatedAt: integer('rotated_at', { mode: 'timestamp_ms' }),
    rotationReplayResponse: text('rotation_replay_response'),
    rotationReplayExpiresAt: integer('rotation_replay_expires_at', {
      mode: 'timestamp_ms',
    }),
    authTime: integer('auth_time', { mode: 'timestamp_ms' }),
    confirmation: text('confirmation'),
    scopes: text('scopes').notNull(),
  },
  t => [
    index('oauth_refresh_token_client_id_idx').on(t.clientId),
    index('oauth_refresh_token_session_id_idx').on(t.sessionId),
    index('oauth_refresh_token_user_id_idx').on(t.userId),
    index('oauth_refresh_token_authorization_code_id_idx').on(
      t.authorizationCodeId,
    ),
  ],
)

export const oauthAccessToken = sqliteTable(
  'oauth_access_token',
  {
    id: text('id').primaryKey(),
    token: text('token').unique(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => session.id, {
      onDelete: 'set null',
    }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    authorizationCodeId: text('authorization_code_id'),
    resources: text('resources'),
    requestedUserInfoClaims: text('requested_user_info_claims'),
    refreshId: text('refresh_id').references(() => oauthRefreshToken.id, {
      onDelete: 'cascade',
    }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    revoked: integer('revoked', { mode: 'timestamp_ms' }),
    confirmation: text('confirmation'),
    scopes: text('scopes').notNull(),
  },
  t => [
    index('oauth_access_token_client_id_idx').on(t.clientId),
    index('oauth_access_token_session_id_idx').on(t.sessionId),
    index('oauth_access_token_user_id_idx').on(t.userId),
    index('oauth_access_token_authorization_code_id_idx').on(
      t.authorizationCodeId,
    ),
    index('oauth_access_token_refresh_id_idx').on(t.refreshId),
  ],
)

export const oauthConsent = sqliteTable(
  'oauth_consent',
  {
    id: text('id').primaryKey(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClient.clientId, { onDelete: 'cascade' }),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    referenceId: text('reference_id'),
    resources: text('resources'),
    requestedUserInfoClaims: text('requested_user_info_claims'),
    scopes: text('scopes').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  },
  t => [
    index('oauth_consent_client_id_idx').on(t.clientId),
    index('oauth_consent_user_id_idx').on(t.userId),
  ],
)

// Single-use `jti` records for `private_key_jwt` client assertions. No client
// here uses that auth method, but the plugin declares the model.
export const oauthClientAssertion = sqliteTable('oauth_client_assertion', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
})

// The jwt plugin's signing keys (private key stored encrypted by the
// plugin). Not user-scoped, so no references.
export const jwks = sqliteTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  alg: text('alg'),
  crv: text('crv'),
})
