import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core'

// ---------------------------------------------------------------------------
// Download search result tracking — persists "not found" metadata across
// page refreshes and library removal/re-addition. A row's existence means
// the last search for that media returned no results. Rows are deleted when
// a file is successfully downloaded.
// ---------------------------------------------------------------------------

export const downloadSearchResults = pgTable('download_search_result', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  mediaType: text('media_type', { enum: ['movie', 'episode'] }).notNull(),
  // Movies: keyed by tmdbId (stable across Radarr add/remove)
  tmdbId: integer('tmdb_id'),
  // Episodes: keyed by tvdbId + seasonNumber + episodeNumber (stable across Sonarr add/remove)
  tvdbId: integer('tvdb_id'),
  seasonNumber: integer('season_number'),
  episodeNumber: integer('episode_number'),
  lastSearchedAt: timestamp('last_searched_at', { mode: 'date' })
    .notNull()
    .defaultNow(),
})

// ---------------------------------------------------------------------------
// Auth.js tables — https://authjs.dev/getting-started/adapters/drizzle
// ---------------------------------------------------------------------------

export const users = pgTable('user', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('emailVerified', { mode: 'date' }),
  image: text('image'),
  status: text('status', { enum: ['pending', 'approved', 'denied'] })
    .notNull()
    .default('pending'),
})

export const accounts = pgTable(
  'account',
  {
    userId: text('userId')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('providerAccountId').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  account => [
    primaryKey({
      columns: [account.provider, account.providerAccountId],
    }),
  ],
)

export const sessions = pgTable('session', {
  sessionToken: text('sessionToken').primaryKey(),
  userId: text('userId')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable(
  'verificationToken',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  verificationToken => [
    primaryKey({
      columns: [verificationToken.identifier, verificationToken.token],
    }),
  ],
)
