import { BadRequestException, NotFoundException } from '@nestjs/common'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { PinoLogger } from 'nestjs-pino'

import { AdminController } from 'src/admin/admin.controller'
import { UsersService } from 'src/admin/users.service'
import { applyPragmas, type Db, runMigrations } from 'src/db/database.module'
import { findLinkByUserId, upsertIdentity } from 'src/db/discord-link.repo'
import * as schema from 'src/db/schema'
import { insertGrant } from 'src/grants/grants.repo'
import type { RequestsService } from 'src/requests/requests.service'
import type { ServiceRegistryService } from 'src/services/service-registry.service'
import { NotifyBusService } from 'src/sse/notify-bus.service'
import type { AccessCacheService } from 'src/verify/access-cache.service'

// Obviously-fake, scoped to this file — users() below reads ADMIN_EMAILS
// through env(). Same module-scope convention as user-management.spec.ts.
process.env.ADMIN_EMAILS = 'admin@example.com'

function createTestDb() {
  const sqlite = new BetterSqlite3(':memory:')
  applyPragmas(sqlite)
  const db = drizzle(sqlite, { schema })
  runMigrations(db)
  return { db, sqlite, close: () => sqlite.close() }
}

function fakeLogger(): PinoLogger {
  return { warn: jest.fn() } as unknown as PinoLogger
}

// Nothing in the Discord link path touches AccessCacheService (see
// UsersService's own "Discord link management" header comment for why: a
// link decides attribution, never access) — this stand-in exists only to
// satisfy the constructor, and the fact that none of its methods are ever
// called is itself asserted below.
function fakeAccessCache(): AccessCacheService {
  return {
    addGrant: jest.fn(),
    removeGrant: jest.fn(),
    blockUser: jest.fn(),
    unblockUser: jest.fn(),
    addPreAuthorization: jest.fn(),
    removePreAuthorization: jest.fn(),
    invalidateSessionsForUser: jest.fn(),
  } as unknown as AccessCacheService
}

function fakeRequestsService(): RequestsService {
  return {} as unknown as RequestsService
}

function fakeServiceRegistry(): ServiceRegistryService {
  return {
    getServices: jest.fn().mockResolvedValue([]),
  } as unknown as ServiceRegistryService
}

// Discord snowflakes are 64-bit and exceed Number.MAX_SAFE_INTEGER, so they
// are STRING LITERALS everywhere in this file, never numbers — a numeric
// literal of this magnitude is both a lint error (no-loss-of-precision) and
// a silently different account.
const ADA_SNOWFLAKE = '111111111111111111'
const GRACE_SNOWFLAKE = '222222222222222222'
const ALAN_SNOWFLAKE = '333333333333333333'

const T0 = new Date(1_700_000_000_000)
const T1 = new Date(1_700_000_060_000)
const T2 = new Date(1_700_000_120_000)

// noUncheckedIndexedAccess is on for this package, so `rows[0]` is
// `T | undefined` everywhere. This narrows with a real failure message
// instead of scattering non-null assertions through the assertions below.
function first<T>(rows: T[]): T {
  const row = rows[0]
  if (!row) throw new Error('expected at least one row')
  return row
}

function seedUser(
  db: Db,
  id: string,
  overrides: { email?: string; name?: string; blockedAt?: Date | null } = {},
): string {
  const now = new Date()
  db.insert(schema.user)
    .values({
      id,
      name: overrides.name ?? `Name ${id}`,
      email: overrides.email ?? `${id}@example.com`,
      emailVerified: false,
      blockedAt: overrides.blockedAt ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .run()
  return id
}

describe('Discord link admin surface', () => {
  let testDb: ReturnType<typeof createTestDb>
  let accessCache: AccessCacheService
  let notifyBus: NotifyBusService
  let publishAdminChange: jest.SpyInstance
  let usersService: UsersService
  let controller: AdminController

  beforeEach(() => {
    testDb = createTestDb()
    accessCache = fakeAccessCache()
    notifyBus = new NotifyBusService()
    publishAdminChange = jest.spyOn(notifyBus, 'publishAdminChange')
    usersService = new UsersService(
      testDb.db,
      accessCache,
      notifyBus,
      fakeLogger(),
    )
    controller = new AdminController(
      testDb.db,
      fakeRequestsService(),
      fakeServiceRegistry(),
      usersService,
    )
  })

  afterEach(() => {
    testDb.close()
  })

  // ── GET /admin/discord/unlinked ─────────────────────────────────────────

  describe('GET /admin/discord/unlinked', () => {
    it('returns both picker columns: unlinked people and unlinked Discord accounts', () => {
      seedUser(testDb.db, 'u_ada', {
        email: 'ada@example.com',
        name: 'Ada Lovelace',
      })
      upsertIdentity(
        testDb.db,
        {
          discordUserId: ADA_SNOWFLAKE,
          username: 'ada',
          displayName: 'Ada L',
        },
        T0,
      )

      const result = controller.discordUnlinked()

      expect(result.people).toEqual([
        { userId: 'u_ada', email: 'ada@example.com', name: 'Ada Lovelace' },
      ])
      expect(result.accounts).toEqual([
        {
          discordUserId: ADA_SNOWFLAKE,
          username: 'ada',
          displayName: 'Ada L',
          firstSeenAt: T0.toISOString(),
          lastSeenAt: T0.toISOString(),
        },
      ])
    })

    // The boundary rule this whole file's response shapes follow: the repo
    // hands back Date objects, every route hands back ISO strings.
    it('serializes both roster timestamps as ISO strings, not Dates', () => {
      upsertIdentity(
        testDb.db,
        { discordUserId: ADA_SNOWFLAKE, username: 'ada' },
        T0,
      )
      upsertIdentity(
        testDb.db,
        { discordUserId: ADA_SNOWFLAKE, username: 'ada' },
        T1,
      )

      const account = first(controller.discordUnlinked().accounts)

      expect(account.firstSeenAt).toBe(T0.toISOString())
      expect(account.lastSeenAt).toBe(T1.toISOString())
      expect(typeof account.firstSeenAt).toBe('string')
    })

    it('inherits the repo ordering — people by email, accounts most-recently-seen first', () => {
      seedUser(testDb.db, 'u_zoe', { email: 'zoe@example.com' })
      seedUser(testDb.db, 'u_ada', { email: 'ada@example.com' })
      upsertIdentity(
        testDb.db,
        { discordUserId: ADA_SNOWFLAKE, username: 'ada' },
        T0,
      )
      upsertIdentity(
        testDb.db,
        { discordUserId: GRACE_SNOWFLAKE, username: 'grace' },
        T2,
      )

      const result = controller.discordUnlinked()

      expect(result.people.map(person => person.email)).toEqual([
        'ada@example.com',
        'zoe@example.com',
      ])
      expect(result.accounts.map(account => account.discordUserId)).toEqual([
        GRACE_SNOWFLAKE,
        ADA_SNOWFLAKE,
      ])
    })

    it('omits blocked people from the link picker', () => {
      seedUser(testDb.db, 'u_blocked', {
        email: 'blocked@example.com',
        blockedAt: T0,
      })

      expect(controller.discordUnlinked().people).toEqual([])
    })

    it('reports empty columns rather than throwing when nothing has been seen yet', () => {
      expect(controller.discordUnlinked()).toEqual({
        people: [],
        accounts: [],
      })
    })
  })

  // ── GET /admin/discord/links ────────────────────────────────────────────

  describe('GET /admin/discord/links', () => {
    it('flattens every link, joining both sides labels at read time', () => {
      seedUser(testDb.db, 'u_ada', {
        email: 'ada@example.com',
        name: 'Ada Lovelace',
      })
      upsertIdentity(
        testDb.db,
        {
          discordUserId: ADA_SNOWFLAKE,
          username: 'ada',
          displayName: 'Ada L',
        },
        T0,
      )
      usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)

      const links = controller.discordLinks()

      expect(links).toHaveLength(1)
      expect(first(links)).toMatchObject({
        userId: 'u_ada',
        email: 'ada@example.com',
        name: 'Ada Lovelace',
        discordUserId: ADA_SNOWFLAKE,
        username: 'ada',
        displayName: 'Ada L',
      })
      // createdAt is stamped with `new Date()` inside the service, so its
      // value isn't predictable — what matters at this boundary is that it
      // is an ISO STRING rather than a Date.
      expect(first(links).createdAt).toEqual(expect.any(String))
      expect(new Date(first(links).createdAt).toISOString()).toBe(
        first(links).createdAt,
      )
    })

    // Nothing needs to be re-written on a rename: the link stores no labels
    // at all, so the join picks up whatever the roster currently says.
    it('reflects a later Discord rename without the link row changing', () => {
      seedUser(testDb.db, 'u_ada', { email: 'ada@example.com' })
      upsertIdentity(
        testDb.db,
        { discordUserId: ADA_SNOWFLAKE, username: 'ada' },
        T0,
      )
      usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)

      upsertIdentity(
        testDb.db,
        { discordUserId: ADA_SNOWFLAKE, username: 'ada.lovelace' },
        T1,
      )

      expect(first(controller.discordLinks()).username).toBe('ada.lovelace')
    })

    it('is empty when nothing is linked', () => {
      expect(controller.discordLinks()).toEqual([])
    })
  })

  // ── POST /admin/discord/link ────────────────────────────────────────────

  describe('POST /admin/discord/link', () => {
    beforeEach(() => {
      seedUser(testDb.db, 'u_ada', {
        email: 'ada@example.com',
        name: 'Ada Lovelace',
      })
      upsertIdentity(
        testDb.db,
        { discordUserId: ADA_SNOWFLAKE, username: 'ada' },
        T0,
      )
    })

    it('links the pair and reports ok', () => {
      expect(
        controller.linkDiscord({
          userId: 'u_ada',
          discordUserId: ADA_SNOWFLAKE,
        }),
      ).toEqual({ ok: true })

      expect(findLinkByUserId(testDb.db, 'u_ada')).toMatchObject({
        userId: 'u_ada',
        discordUserId: ADA_SNOWFLAKE,
      })
    })

    it('publishes an admin change so a second open dashboard refreshes', () => {
      usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)

      expect(publishAdminChange).toHaveBeenCalledTimes(1)
    })

    // A link decides attribution, never access — there is no in-memory
    // access state for it to invalidate. This asserts that deliberate
    // non-interaction rather than leaving it implicit.
    it('touches no access cache state', () => {
      usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)

      expect(accessCache.addGrant).not.toHaveBeenCalled()
      expect(accessCache.removeGrant).not.toHaveBeenCalled()
      expect(accessCache.invalidateSessionsForUser).not.toHaveBeenCalled()
    })

    it('rejects a body whose discordUserId is not a snowflake, before reaching the service', () => {
      const linkSpy = jest.spyOn(usersService, 'linkDiscord')

      expect(() =>
        controller.linkDiscord({ userId: 'u_ada', discordUserId: 'ada#1234' }),
      ).toThrow(BadRequestException)
      expect(linkSpy).not.toHaveBeenCalled()
    })

    it('rejects a body missing userId entirely', () => {
      expect(() =>
        controller.linkDiscord({ discordUserId: ADA_SNOWFLAKE }),
      ).toThrow(BadRequestException)
    })

    describe('edge cases', () => {
      it('throws NotFoundException for an unknown userId rather than a raw foreign-key error', () => {
        expect(() =>
          usersService.linkDiscord('u_ghost', ADA_SNOWFLAKE),
        ).toThrow(NotFoundException)
        expect(publishAdminChange).not.toHaveBeenCalled()
      })

      // The central rule of the two-table schema, enforced at the API
      // boundary: a snowflake nobody has ever OBSERVED cannot be linked.
      it('throws NotFoundException for a snowflake this system has never seen', () => {
        expect(() => usersService.linkDiscord('u_ada', ALAN_SNOWFLAKE)).toThrow(
          NotFoundException,
        )
        expect(findLinkByUserId(testDb.db, 'u_ada')).toBeUndefined()
      })

      it('throws BadRequestException naming the other person when the Discord account is already linked to someone else', () => {
        seedUser(testDb.db, 'u_grace', { email: 'grace@example.com' })
        usersService.linkDiscord('u_grace', ADA_SNOWFLAKE)
        publishAdminChange.mockClear()

        expect(() => usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)).toThrow(
          new BadRequestException(
            'Discord account already linked to grace@example.com',
          ),
        )
        // The existing link is untouched — a conflict never silently
        // re-points an account at a different human.
        expect(findLinkByUserId(testDb.db, 'u_grace')?.discordUserId).toBe(
          ADA_SNOWFLAKE,
        )
        expect(findLinkByUserId(testDb.db, 'u_ada')).toBeUndefined()
        expect(publishAdminChange).not.toHaveBeenCalled()
      })

      it('throws BadRequestException telling the admin to unlink first when the person already has a different Discord account', () => {
        upsertIdentity(
          testDb.db,
          { discordUserId: GRACE_SNOWFLAKE, username: 'grace' },
          T0,
        )
        usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)
        publishAdminChange.mockClear()

        expect(() =>
          usersService.linkDiscord('u_ada', GRACE_SNOWFLAKE),
        ).toThrow(BadRequestException)
        expect(() =>
          usersService.linkDiscord('u_ada', GRACE_SNOWFLAKE),
        ).toThrow(/unlink them first/)
        // Still linked to the ORIGINAL account, not silently replaced.
        expect(findLinkByUserId(testDb.db, 'u_ada')?.discordUserId).toBe(
          ADA_SNOWFLAKE,
        )
        expect(publishAdminChange).not.toHaveBeenCalled()
      })

      // When BOTH conflicts are true at once, the account-side message
      // wins — it names the other human, which is the actionable half.
      it('prefers the already-linked-account message when both sides conflict', () => {
        upsertIdentity(
          testDb.db,
          { discordUserId: GRACE_SNOWFLAKE, username: 'grace' },
          T0,
        )
        seedUser(testDb.db, 'u_grace', { email: 'grace@example.com' })
        usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)
        usersService.linkDiscord('u_grace', GRACE_SNOWFLAKE)

        expect(() =>
          usersService.linkDiscord('u_ada', GRACE_SNOWFLAKE),
        ).toThrow(
          new BadRequestException(
            'Discord account already linked to grace@example.com',
          ),
        )
      })

      it('re-linking the identical pair is a no-op success that notifies nothing', () => {
        usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)
        const before = findLinkByUserId(testDb.db, 'u_ada')
        publishAdminChange.mockClear()

        expect(() =>
          usersService.linkDiscord('u_ada', ADA_SNOWFLAKE),
        ).not.toThrow()

        // Same row, not a replaced one — the id and createdAt are
        // untouched, so nothing was deleted and re-inserted.
        expect(findLinkByUserId(testDb.db, 'u_ada')).toEqual(before)
        expect(controller.discordLinks()).toHaveLength(1)
        expect(publishAdminChange).not.toHaveBeenCalled()
      })
    })

    it('removes a freshly linked pair from BOTH unlinked columns', () => {
      expect(controller.discordUnlinked().people).toHaveLength(1)
      expect(controller.discordUnlinked().accounts).toHaveLength(1)

      usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)

      const after = controller.discordUnlinked()
      expect(after.people).toEqual([])
      expect(after.accounts).toEqual([])
      expect(controller.discordLinks()).toHaveLength(1)
    })
  })

  // ── POST /admin/discord/unlink ──────────────────────────────────────────

  describe('POST /admin/discord/unlink', () => {
    beforeEach(() => {
      seedUser(testDb.db, 'u_ada', { email: 'ada@example.com' })
      upsertIdentity(
        testDb.db,
        { discordUserId: ADA_SNOWFLAKE, username: 'ada' },
        T0,
      )
      usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)
      publishAdminChange.mockClear()
    })

    it('unlinks the person and reports ok', () => {
      expect(controller.unlinkDiscord({ userId: 'u_ada' })).toEqual({
        ok: true,
      })

      expect(findLinkByUserId(testDb.db, 'u_ada')).toBeUndefined()
      expect(controller.discordLinks()).toEqual([])
      expect(publishAdminChange).toHaveBeenCalledTimes(1)
    })

    // The roster is an observation log: unlinking says "this account is not
    // that person", never "this account was never seen".
    it('returns both halves to the picker and keeps the discord_identity row', () => {
      usersService.unlinkDiscord('u_ada')

      const after = controller.discordUnlinked()
      expect(after.people.map(person => person.userId)).toEqual(['u_ada'])
      expect(after.accounts.map(account => account.discordUserId)).toEqual([
        ADA_SNOWFLAKE,
      ])
      // Preserved, including the original firstSeenAt — the observation
      // history survives the link's removal.
      expect(first(after.accounts).firstSeenAt).toBe(T0.toISOString())
    })

    it('allows the account to be re-linked to whoever it actually belongs to', () => {
      seedUser(testDb.db, 'u_grace', { email: 'grace@example.com' })
      usersService.unlinkDiscord('u_ada')

      usersService.linkDiscord('u_grace', ADA_SNOWFLAKE)

      expect(findLinkByUserId(testDb.db, 'u_grace')?.discordUserId).toBe(
        ADA_SNOWFLAKE,
      )
      expect(findLinkByUserId(testDb.db, 'u_ada')).toBeUndefined()
    })

    // The deliberate decision on deleteLinkForUser()'s zero-row return: a
    // NotFoundException, matching blockUser()/unblockUser()'s own S6 rule,
    // because the Unlink button only renders on a LINKED row — reaching it
    // with nothing to delete means the admin's view is stale.
    it('throws NotFoundException when the user has no link to remove', () => {
      seedUser(testDb.db, 'u_grace', { email: 'grace@example.com' })

      expect(() => usersService.unlinkDiscord('u_grace')).toThrow(
        NotFoundException,
      )
      expect(publishAdminChange).not.toHaveBeenCalled()
    })

    it('throws NotFoundException for an entirely unknown userId', () => {
      expect(() => usersService.unlinkDiscord('u_ghost')).toThrow(
        NotFoundException,
      )
    })

    it('is not idempotent — a second unlink of the same person throws', () => {
      usersService.unlinkDiscord('u_ada')

      expect(() => usersService.unlinkDiscord('u_ada')).toThrow(
        NotFoundException,
      )
    })

    it('rejects a body missing userId', () => {
      expect(() => controller.unlinkDiscord({})).toThrow(BadRequestException)
    })

    it('touches no access cache state', () => {
      usersService.unlinkDiscord('u_ada')

      expect(accessCache.removeGrant).not.toHaveBeenCalled()
      expect(accessCache.invalidateSessionsForUser).not.toHaveBeenCalled()
    })
  })

  // ── GET /admin/users, extended with the link chip ───────────────────────

  describe('GET /admin/users Discord columns', () => {
    // listUsersWithGrantHistory() only returns users with an
    // everGrantedAt marker, which insertGrant() stamps — so a person has to
    // hold (or have held) a grant to appear on the People table at all.
    function seedGrantedUser(id: string, email: string): string {
      seedUser(testDb.db, id, { email })
      insertGrant(testDb.db, id, 'swole.lilnas.io', T0)
      return id
    }

    it('carries the linked account id and its CURRENT handle on the person row', () => {
      seedGrantedUser('u_ada', 'ada@example.com')
      upsertIdentity(
        testDb.db,
        {
          discordUserId: ADA_SNOWFLAKE,
          username: 'ada',
          displayName: 'Ada L',
        },
        T0,
      )
      usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)

      expect(controller.users()).toEqual([
        expect.objectContaining({
          id: 'u_ada',
          email: 'ada@example.com',
          discordUserId: ADA_SNOWFLAKE,
          discordUsername: 'ada',
        }),
      ])
    })

    it('reports both columns null for an unlinked person', () => {
      seedGrantedUser('u_zoe', 'zoe@example.com')

      expect(controller.users()).toEqual([
        expect.objectContaining({
          id: 'u_zoe',
          discordUserId: null,
          discordUsername: null,
        }),
      ])
    })

    it('populates each row independently rather than leaking one link across the list', () => {
      seedGrantedUser('u_ada', 'ada@example.com')
      seedGrantedUser('u_zoe', 'zoe@example.com')
      upsertIdentity(
        testDb.db,
        { discordUserId: ADA_SNOWFLAKE, username: 'ada' },
        T0,
      )
      usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)

      const byEmail = new Map(
        controller.users().map(entry => [entry.email, entry]),
      )
      expect(byEmail.get('ada@example.com')?.discordUsername).toBe('ada')
      expect(byEmail.get('zoe@example.com')?.discordUsername).toBeNull()
    })

    it('clears both columns again after an unlink', () => {
      seedGrantedUser('u_ada', 'ada@example.com')
      upsertIdentity(
        testDb.db,
        { discordUserId: ADA_SNOWFLAKE, username: 'ada' },
        T0,
      )
      usersService.linkDiscord('u_ada', ADA_SNOWFLAKE)

      usersService.unlinkDiscord('u_ada')

      expect(first(controller.users())).toMatchObject({
        discordUserId: null,
        discordUsername: null,
      })
    })
  })
})
