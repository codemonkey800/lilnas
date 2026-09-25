import { BadRequestException } from '@nestjs/common'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'

import { applyPragmas, type Db, runMigrations } from 'src/db/database.module'
import {
  findIdentity,
  insertLink,
  upsertIdentity,
} from 'src/db/discord-link.repo'
import * as schema from 'src/db/schema'
import {
  DiscordIdentityController,
  DiscordLinkLookupController,
} from 'src/internal/discord-internal.controller'

// Same shape as db/__tests__/discord-link.repo.spec.ts: an in-memory DB built
// by the REAL applyPragmas()/runMigrations() exports, never a hand-written
// CREATE TABLE. Both controllers are then instantiated directly with that Db
// — no Nest testing module — which is what
// admin/__tests__/admin-check.controller.spec.ts does for the other guard-free
// internal controller, and is honest about these classes having exactly one
// dependency.
function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, close: () => sqlite.close() }
}

function seedUser(
  db: Db,
  id: string,
  overrides: { email?: string; name?: string } = {},
): void {
  const now = new Date()
  db.insert(schema.user)
    .values({
      id,
      name: overrides.name ?? `Name ${id}`,
      email: overrides.email ?? `${id}@example.com`,
      emailVerified: false,
      blockedAt: null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

// String literals, never numeric: a real snowflake exceeds
// Number.MAX_SAFE_INTEGER, and eslint's no-loss-of-precision rejects one
// written as a number outright.
const ADA_SNOWFLAKE = '111111111111111111'
const GRACE_SNOWFLAKE = '222222222222222222'
const UNSEEN_SNOWFLAKE = '999999999999999999'

const T0 = new Date(1_700_000_000_000)

describe('GET /internal/discord-link', () => {
  describe('by discordUserId', () => {
    it('returns both halves null for a snowflake this app has never seen', () => {
      const { db, close } = createTestDb()
      try {
        const controller = new DiscordLinkLookupController(db)

        expect(controller.discordLink(UNSEEN_SNOWFLAKE)).toEqual({
          identity: null,
          user: null,
        })
      } finally {
        close()
      }
    })

    it('returns the identity and a null user for an observed-but-unlinked account', () => {
      const { db, close } = createTestDb()
      try {
        upsertIdentity(
          db,
          {
            discordUserId: ADA_SNOWFLAKE,
            username: 'ada',
            displayName: 'Ada L',
          },
          T0,
        )
        const controller = new DiscordLinkLookupController(db)

        // Exactly the three contract fields — firstSeenAt/lastSeenAt are this
        // app's own bookkeeping and must not leak onto the wire. toEqual is
        // exact, so their presence would fail this.
        expect(controller.discordLink(ADA_SNOWFLAKE)).toEqual({
          identity: {
            discordUserId: ADA_SNOWFLAKE,
            username: 'ada',
            displayName: 'Ada L',
          },
          user: null,
        })
      } finally {
        close()
      }
    })

    it('returns both halves for a linked account', () => {
      const { db, close } = createTestDb()
      try {
        seedUser(db, 'user-ada', { email: 'ada@example.com', name: 'Ada' })
        upsertIdentity(
          db,
          { discordUserId: ADA_SNOWFLAKE, username: 'ada', displayName: null },
          T0,
        )
        insertLink(db, { userId: 'user-ada', discordUserId: ADA_SNOWFLAKE }, T0)
        const controller = new DiscordLinkLookupController(db)

        expect(controller.discordLink(ADA_SNOWFLAKE)).toEqual({
          identity: {
            discordUserId: ADA_SNOWFLAKE,
            username: 'ada',
            displayName: null,
          },
          user: { userId: 'user-ada', email: 'ada@example.com', name: 'Ada' },
        })
      } finally {
        close()
      }
    })
  })

  describe('by userId', () => {
    it('resolves a linked user to both halves', () => {
      const { db, close } = createTestDb()
      try {
        seedUser(db, 'user-ada', { email: 'ada@example.com', name: 'Ada' })
        upsertIdentity(
          db,
          {
            discordUserId: ADA_SNOWFLAKE,
            username: 'ada',
            displayName: 'Ada L',
          },
          T0,
        )
        insertLink(db, { userId: 'user-ada', discordUserId: ADA_SNOWFLAKE }, T0)
        const controller = new DiscordLinkLookupController(db)

        expect(controller.discordLink(undefined, 'user-ada')).toEqual({
          identity: {
            discordUserId: ADA_SNOWFLAKE,
            username: 'ada',
            displayName: 'Ada L',
          },
          user: { userId: 'user-ada', email: 'ada@example.com', name: 'Ada' },
        })
      } finally {
        close()
      }
    })

    it('returns both halves null for a real user with no link', () => {
      const { db, close } = createTestDb()
      try {
        seedUser(db, 'user-grace')
        const controller = new DiscordLinkLookupController(db)

        expect(controller.discordLink(undefined, 'user-grace')).toEqual({
          identity: null,
          user: null,
        })
      } finally {
        close()
      }
    })

    it('returns both halves null for a userId that does not exist', () => {
      const { db, close } = createTestDb()
      try {
        const controller = new DiscordLinkLookupController(db)

        expect(controller.discordLink(undefined, 'nobody')).toEqual({
          identity: null,
          user: null,
        })
      } finally {
        close()
      }
    })
  })

  describe('by email', () => {
    it('resolves a linked email to both halves', () => {
      const { db, close } = createTestDb()
      try {
        seedUser(db, 'user-grace', {
          email: 'grace@example.com',
          name: 'Grace',
        })
        upsertIdentity(
          db,
          {
            discordUserId: GRACE_SNOWFLAKE,
            username: 'grace',
            displayName: null,
          },
          T0,
        )
        insertLink(
          db,
          { userId: 'user-grace', discordUserId: GRACE_SNOWFLAKE },
          T0,
        )
        const controller = new DiscordLinkLookupController(db)

        expect(
          controller.discordLink(undefined, undefined, 'grace@example.com'),
        ).toEqual({
          identity: {
            discordUserId: GRACE_SNOWFLAKE,
            username: 'grace',
            displayName: null,
          },
          user: {
            userId: 'user-grace',
            email: 'grace@example.com',
            name: 'Grace',
          },
        })
      } finally {
        close()
      }
    })

    // Both sides of the comparison are lowered by findLinkByEmail(), which is
    // load-bearing: `user.email` is written by Better Auth straight from
    // Google's userinfo and is never normalized, so a stored address with
    // uppercase in it must still match a lowercase query (and vice versa) or
    // this route reports "not linked" for someone who is.
    it('matches case-insensitively in both directions', () => {
      const { db, close } = createTestDb()
      try {
        seedUser(db, 'user-grace', {
          email: 'Grace@Example.com',
          name: 'Grace',
        })
        upsertIdentity(
          db,
          {
            discordUserId: GRACE_SNOWFLAKE,
            username: 'grace',
            displayName: null,
          },
          T0,
        )
        insertLink(
          db,
          { userId: 'user-grace', discordUserId: GRACE_SNOWFLAKE },
          T0,
        )
        const controller = new DiscordLinkLookupController(db)

        const lowered = controller.discordLink(
          undefined,
          undefined,
          'grace@example.com',
        )
        const shouted = controller.discordLink(
          undefined,
          undefined,
          'GRACE@EXAMPLE.COM',
        )

        expect(lowered.user?.userId).toBe('user-grace')
        expect(lowered.identity?.discordUserId).toBe(GRACE_SNOWFLAKE)
        expect(shouted).toEqual(lowered)
      } finally {
        close()
      }
    })

    it('returns both halves null for an email with no link', () => {
      const { db, close } = createTestDb()
      try {
        seedUser(db, 'user-grace', { email: 'grace@example.com' })
        const controller = new DiscordLinkLookupController(db)

        expect(
          controller.discordLink(undefined, undefined, 'grace@example.com'),
        ).toEqual({ identity: null, user: null })
      } finally {
        close()
      }
    })
  })

  describe('parameter count', () => {
    it('rejects a request with no parameters at all', () => {
      const { db, close } = createTestDb()
      try {
        const controller = new DiscordLinkLookupController(db)

        expect(() => controller.discordLink()).toThrow(BadRequestException)
      } finally {
        close()
      }
    })

    it('rejects a request with two parameters', () => {
      const { db, close } = createTestDb()
      try {
        const controller = new DiscordLinkLookupController(db)

        expect(() => controller.discordLink(ADA_SNOWFLAKE, 'user-ada')).toThrow(
          BadRequestException,
        )
      } finally {
        close()
      }
    })

    it('rejects a request with all three parameters', () => {
      const { db, close } = createTestDb()
      try {
        const controller = new DiscordLinkLookupController(db)

        expect(() =>
          controller.discordLink(ADA_SNOWFLAKE, 'user-ada', 'ada@example.com'),
        ).toThrow(BadRequestException)
      } finally {
        close()
      }
    })

    // `?email=` — present but empty. Counting it as supplied would run a
    // lookup for the empty string and report a guaranteed miss as a
    // legitimate "not linked".
    it('treats a present-but-empty parameter as absent', () => {
      const { db, close } = createTestDb()
      try {
        const controller = new DiscordLinkLookupController(db)

        expect(() =>
          controller.discordLink(undefined, undefined, '  '),
        ).toThrow(BadRequestException)
      } finally {
        close()
      }
    })
  })
})

describe('POST /internal/discord-identity', () => {
  it('inserts an unseen identity and reports ok', () => {
    const { db, close } = createTestDb()
    try {
      const controller = new DiscordIdentityController(db)

      expect(
        controller.registerIdentity({
          discordUserId: ADA_SNOWFLAKE,
          username: 'ada',
          displayName: 'Ada L',
        }),
      ).toEqual({ ok: true })

      const row = findIdentity(db, ADA_SNOWFLAKE)
      expect(row?.username).toBe('ada')
      expect(row?.displayName).toBe('Ada L')
    } finally {
      close()
    }
  })

  it('stores a null displayName when the key is omitted entirely', () => {
    const { db, close } = createTestDb()
    try {
      const controller = new DiscordIdentityController(db)

      controller.registerIdentity({
        discordUserId: ADA_SNOWFLAKE,
        username: 'ada',
      })

      expect(findIdentity(db, ADA_SNOWFLAKE)?.displayName).toBeNull()
    } finally {
      close()
    }
  })

  it('applies a rename on a second post, leaving firstSeenAt alone', () => {
    const { db, close } = createTestDb()
    try {
      const controller = new DiscordIdentityController(db)

      controller.registerIdentity({
        discordUserId: ADA_SNOWFLAKE,
        username: 'ada',
        displayName: 'Ada L',
      })
      const inserted = findIdentity(db, ADA_SNOWFLAKE)

      controller.registerIdentity({
        discordUserId: ADA_SNOWFLAKE,
        username: 'ada.lovelace',
        displayName: null,
      })
      const renamed = findIdentity(db, ADA_SNOWFLAKE)

      expect(renamed?.username).toBe('ada.lovelace')
      expect(renamed?.displayName).toBeNull()
      expect(renamed?.firstSeenAt).toEqual(inserted?.firstSeenAt)
    } finally {
      close()
    }
  })

  it('is idempotent — re-posting an unchanged identity keeps one row and the same labels', () => {
    const { db, close } = createTestDb()
    try {
      const controller = new DiscordIdentityController(db)
      const body = {
        discordUserId: ADA_SNOWFLAKE,
        username: 'ada',
        displayName: 'Ada L',
      }

      controller.registerIdentity(body)
      expect(controller.registerIdentity(body)).toEqual({ ok: true })

      expect(db.select().from(schema.discordIdentity).all()).toHaveLength(1)
      expect(findIdentity(db, ADA_SNOWFLAKE)?.username).toBe('ada')
    } finally {
      close()
    }
  })

  // The schema is the only thing between an arbitrary body and a roster row —
  // this route has no guard.
  it('rejects a body whose discordUserId is not a snowflake', () => {
    const { db, close } = createTestDb()
    try {
      const controller = new DiscordIdentityController(db)

      expect(() =>
        controller.registerIdentity({
          discordUserId: 'not-a-snowflake',
          username: 'ada',
        }),
      ).toThrow(BadRequestException)

      expect(db.select().from(schema.discordIdentity).all()).toHaveLength(0)
    } finally {
      close()
    }
  })

  // Exactly what Nest's body parser hands @Body() when a caller serializes the
  // snowflake as a JSON number: an already-imprecise float
  // (111111111111111100). Built via JSON.parse rather than a literal because
  // eslint's no-loss-of-precision rejects writing that number in source at
  // all — which is the point. z.string() refuses it instead of coercing a
  // corrupted ID into the roster.
  it('rejects a numeric discordUserId rather than coercing it', () => {
    const { db, close } = createTestDb()
    try {
      const controller = new DiscordIdentityController(db)
      const body: unknown = JSON.parse(
        `{"discordUserId": ${ADA_SNOWFLAKE}, "username": "ada"}`,
      )

      expect(() => controller.registerIdentity(body)).toThrow(
        BadRequestException,
      )
      expect(db.select().from(schema.discordIdentity).all()).toHaveLength(0)
    } finally {
      close()
    }
  })

  it('rejects a snowflake that is too short and one that is too long', () => {
    const { db, close } = createTestDb()
    try {
      const controller = new DiscordIdentityController(db)

      expect(() =>
        controller.registerIdentity({
          discordUserId: '1111111111111111',
          username: 'ada',
        }),
      ).toThrow(BadRequestException)
      expect(() =>
        controller.registerIdentity({
          discordUserId: '111111111111111111111',
          username: 'ada',
        }),
      ).toThrow(BadRequestException)
    } finally {
      close()
    }
  })

  it('rejects a username outside Discord’s own 2–32 character bounds', () => {
    const { db, close } = createTestDb()
    try {
      const controller = new DiscordIdentityController(db)

      expect(() =>
        controller.registerIdentity({
          discordUserId: ADA_SNOWFLAKE,
          username: 'a',
        }),
      ).toThrow(BadRequestException)
      expect(() =>
        controller.registerIdentity({
          discordUserId: ADA_SNOWFLAKE,
          username: 'a'.repeat(33),
        }),
      ).toThrow(BadRequestException)
    } finally {
      close()
    }
  })

  it('rejects a missing body', () => {
    const { db, close } = createTestDb()
    try {
      const controller = new DiscordIdentityController(db)

      expect(() => controller.registerIdentity(undefined)).toThrow(
        BadRequestException,
      )
    } finally {
      close()
    }
  })
})
