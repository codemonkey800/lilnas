// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> DownloadService) must mock it first (see
// media/__tests__/download.controller.media.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import { HistoryQuerySchema } from '@lilnas/utils/download/schema'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { ForbiddenException } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AuditLogService } from 'src/audit/audit-log.service'
import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { AdminCheckService } from 'src/auth/admin-check.service'
import { DiscordLinkService } from 'src/auth/discord-link.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { jobs } from 'src/db/schema'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadMetricsService } from 'src/download/download-metrics.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { ProfileService } from 'src/download/profile.service'
import { DownloadGateway } from 'src/download-gateway/download.gateway'
import { createFakeMediaResolver } from 'src/media/__tests__/helpers/fake-media-resolver'
import { CurrentReleaseService } from 'src/media/current-release.service'
import { DiscoveryService } from 'src/media/discovery.service'
import { ManualImportService } from 'src/media/manual-import.service'
import { MediaDownloadService } from 'src/media/media-download.service'
import { MediaFileService } from 'src/media/media-file.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { MediaStateService } from 'src/media/media-state.service'
import { ReleaseService } from 'src/media/release.service'
import { ShowService } from 'src/media/show.service'

import { buildJob, buildVideo } from './helpers/job-fixtures'

describe('DownloadController - getHistory', () => {
  let controller: DownloadController
  let jobQueryService: jest.Mocked<JobQueryService>
  let adminCheckService: jest.Mocked<AdminCheckService>
  // Plan 017 §E2's unified-history arm. Both default to "no linked Discord
  // account" so every assertion below that predates it keeps describing the
  // email-only filter it was written against.
  let getLinkedDiscordUserId: jest.Mock
  let getLinkedDiscordUserIdByEmail: jest.Mock

  const alice: ForwardedUser = { email: 'alice@example.com', userId: 'u1' }
  // A string literal, not a numeric one - a real snowflake exceeds
  // Number.MAX_SAFE_INTEGER.
  const ALICE_SNOWFLAKE = '111111111111111111'
  const emptyPage = { items: [], nextCursor: null, total: 0 }

  beforeEach(async () => {
    const mockJobQueryService = {
      listActivity: jest.fn().mockReturnValue(emptyPage),
      listGallery: jest.fn().mockReturnValue(emptyPage),
      listHistory: jest.fn().mockReturnValue(emptyPage),
    }
    const mockAdminCheckService = { checkIsAdmin: jest.fn() }
    getLinkedDiscordUserId = jest.fn().mockResolvedValue(null)
    getLinkedDiscordUserIdByEmail = jest.fn().mockResolvedValue(null)

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        fakeAttributionResolutionProvider(),
        { provide: AdminCheckService, useValue: mockAdminCheckService },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
        { provide: CurrentReleaseService, useValue: {} },
        {
          provide: DiscordLinkService,
          useValue: {
            getLinkedDiscordUserId: getLinkedDiscordUserId,
            getLinkedDiscordUserIdByEmail: getLinkedDiscordUserIdByEmail,
            registerObservedIdentity: jest.fn(),
          },
        },
        { provide: DiscoveryService, useValue: {} },
        { provide: DownloadMetricsService, useValue: {} },
        { provide: DownloadService, useValue: {} },
        { provide: DownloadStateService, useValue: { jobs: new Map() } },
        { provide: JobQueryService, useValue: mockJobQueryService },
        { provide: ManualImportService, useValue: {} },
        { provide: MediaDownloadService, useValue: {} },
        { provide: MediaFileService, useValue: {} },
        { provide: MediaResolverService, useValue: { resolve: jest.fn() } },
        { provide: ProfileService, useValue: {} },
        // Phase 3/4: DownloadController injects ReleaseService for the
        // release and bad-file routes and ShowService for the seasons and
        // file-delete routes. Unused by this file's routes, but DI still has
        // to satisfy the constructor.
        { provide: ReleaseService, useValue: {} },
        { provide: ShowService, useValue: {} },
      ],
    }).compile()

    controller = module.get(DownloadController)
    jobQueryService = module.get(JobQueryService)
    adminCheckService = module.get(AdminCheckService)
    adminCheckService.checkIsAdmin.mockResolvedValue(false)
  })

  it('scopes to the caller when no requester param is given', async () => {
    await controller.getHistory({ limit: 24 }, alice)

    expect(jobQueryService.listHistory).toHaveBeenCalledWith({
      cursor: undefined,
      isAdmin: false,
      limit: 24,
      requesterEmail: 'alice@example.com',
    })
  })

  // ⚠️ The one thing `?scope=all` must not change: a bare request keeps
  // meaning "my history" for an admin too, or every existing caller's request
  // would silently start returning the whole system's downloads.
  it('scopes an admin to themselves too when no requester and no scope is given', async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(true)

    await controller.getHistory({ limit: 24 }, alice)

    expect(jobQueryService.listHistory).toHaveBeenCalledWith({
      cursor: undefined,
      isAdmin: true,
      limit: 24,
      requesterEmail: 'alice@example.com',
    })
  })

  it('scopes to the caller when requester matches their own email, case-insensitively', async () => {
    await controller.getHistory(
      { limit: 24, requester: 'ALICE@EXAMPLE.COM' },
      alice,
    )

    expect(jobQueryService.listHistory).toHaveBeenCalledWith(
      expect.objectContaining({ requesterEmail: 'alice@example.com' }),
    )
  })

  it("throws ForbiddenException when a non-admin requests another user's history", async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(false)

    await expect(
      controller.getHistory({ limit: 24, requester: 'bob@example.com' }, alice),
    ).rejects.toThrow(ForbiddenException)

    expect(jobQueryService.listHistory).not.toHaveBeenCalled()
  })

  it("allows an admin to view another user's history, scoped to that user", async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(true)

    await controller.getHistory(
      { limit: 24, requester: 'bob@example.com' },
      alice,
    )

    expect(jobQueryService.listHistory).toHaveBeenCalledWith({
      cursor: undefined,
      isAdmin: true,
      limit: 24,
      requesterEmail: 'bob@example.com',
    })
  })

  // `scope=all` drops the requester predicate entirely rather than naming
  // anybody - the distinction the whole feature rests on.
  it('leaves requesterEmail unset for an admin asking for scope=all', async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(true)

    await controller.getHistory({ limit: 24, scope: 'all' }, alice)

    expect(jobQueryService.listHistory).toHaveBeenCalledWith({
      cursor: undefined,
      isAdmin: true,
      limit: 24,
      requesterEmail: undefined,
    })
  })

  it('throws ForbiddenException when a non-admin asks for scope=all', async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(false)

    await expect(
      controller.getHistory({ limit: 24, scope: 'all' }, alice),
    ).rejects.toThrow(ForbiddenException)

    expect(jobQueryService.listHistory).not.toHaveBeenCalled()
  })

  // A non-admin must not reach the unfiltered branch by any route, including
  // one that also names themselves - the scope is checked before the
  // self-match, so "me plus everyone" is still everyone.
  it('refuses scope=all from a non-admin even alongside their own email', async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(false)

    await expect(
      controller.getHistory(
        { limit: 24, requester: 'alice@example.com', scope: 'all' },
        alice,
      ),
    ).rejects.toThrow(ForbiddenException)

    expect(jobQueryService.listHistory).not.toHaveBeenCalled()
  })

  it('carries cursor, status and type filters into the scope=all branch', async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(true)

    await controller.getHistory(
      {
        cursor: 'opaque',
        limit: 24,
        scope: 'all',
        status: [DownloadJobStatus.Failed],
        type: [DownloadType.Video],
      },
      alice,
    )

    expect(jobQueryService.listHistory).toHaveBeenCalledWith({
      cursor: 'opaque',
      isAdmin: true,
      limit: 24,
      requesterEmail: undefined,
      statuses: [DownloadJobStatus.Failed],
      types: [DownloadType.Video],
    })
  })

  it('passes a type filter through to listHistory', async () => {
    await controller.getHistory(
      { limit: 24, type: [DownloadType.Video] },
      alice,
    )

    expect(jobQueryService.listHistory).toHaveBeenCalledWith(
      expect.objectContaining({ types: [DownloadType.Video] }),
    )
  })

  it('passes a status filter through to listHistory', async () => {
    await controller.getHistory(
      { limit: 24, status: [DownloadJobStatus.Completed] },
      alice,
    )

    expect(jobQueryService.listHistory).toHaveBeenCalledWith(
      expect.objectContaining({ statuses: [DownloadJobStatus.Completed] }),
    )
  })

  it('composes type and status filters together (AND)', async () => {
    await controller.getHistory(
      {
        limit: 24,
        status: [DownloadJobStatus.Failed],
        type: [DownloadType.Video],
      },
      alice,
    )

    expect(jobQueryService.listHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        statuses: [DownloadJobStatus.Failed],
        types: [DownloadType.Video],
      }),
    )
  })

  it('still enforces the self-or-admin guard when type/status filters are present', async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(false)

    await expect(
      controller.getHistory(
        {
          limit: 24,
          requester: 'bob@example.com',
          type: [DownloadType.Video],
        },
        alice,
      ),
    ).rejects.toThrow(ForbiddenException)

    expect(jobQueryService.listHistory).not.toHaveBeenCalled()
  })

  // Plan 017 §E2: one person's Discord-submitted and web-submitted jobs come
  // back as one list. The controller's job is choosing *whose* snowflake to
  // OR in, which is what these assert; that the OR then unions the two
  // surfaces is jobs.repo.spec.ts's, and end-to-end below.
  describe('unified history', () => {
    it("ORs in the viewer's own linked snowflake on a self view", async () => {
      getLinkedDiscordUserId.mockResolvedValue(ALICE_SNOWFLAKE)

      await controller.getHistory({ limit: 24 }, alice)

      // Keyed by userId, not email - it reuses the `u:` cache entry
      // AttributionResolutionService warms while rendering `linkedDiscord`.
      expect(getLinkedDiscordUserId).toHaveBeenCalledWith('u1')
      expect(getLinkedDiscordUserIdByEmail).not.toHaveBeenCalled()
      expect(jobQueryService.listHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterDiscordUserId: ALICE_SNOWFLAKE,
          requesterEmail: 'alice@example.com',
        }),
      )
    })

    it('treats naming your own email as the same self view', async () => {
      getLinkedDiscordUserId.mockResolvedValue(ALICE_SNOWFLAKE)

      await controller.getHistory(
        { limit: 24, requester: 'ALICE@EXAMPLE.COM' },
        alice,
      )

      expect(getLinkedDiscordUserId).toHaveBeenCalledWith('u1')
      expect(jobQueryService.listHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterDiscordUserId: ALICE_SNOWFLAKE,
          requesterEmail: 'alice@example.com',
        }),
      )
    })

    // ⚠️ The arm follows the *subject*, never the viewer. An admin looking at
    // bob's history must see bob's Discord jobs, not their own.
    it("resolves the named requester's snowflake, not the admin's, for another user", async () => {
      adminCheckService.checkIsAdmin.mockResolvedValue(true)
      getLinkedDiscordUserIdByEmail.mockResolvedValue('222222222222222222')

      await controller.getHistory(
        { limit: 24, requester: 'bob@example.com' },
        alice,
      )

      expect(getLinkedDiscordUserIdByEmail).toHaveBeenCalledWith(
        'bob@example.com',
      )
      expect(getLinkedDiscordUserId).not.toHaveBeenCalled()
      expect(jobQueryService.listHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterDiscordUserId: '222222222222222222',
          requesterEmail: 'bob@example.com',
        }),
      )
    })

    it('resolves nothing at all for scope=all', async () => {
      adminCheckService.checkIsAdmin.mockResolvedValue(true)

      await controller.getHistory({ limit: 24, scope: 'all' }, alice)

      // Nobody to link *from*, and an unscoped list already contains every
      // Discord job - so the lookup is skipped rather than answered.
      expect(getLinkedDiscordUserId).not.toHaveBeenCalled()
      expect(getLinkedDiscordUserIdByEmail).not.toHaveBeenCalled()
      expect(jobQueryService.listHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterDiscordUserId: undefined,
          requesterEmail: undefined,
        }),
      )
    })

    it('leaves the filter email-only when the viewer has no linked account', async () => {
      await controller.getHistory({ limit: 24 }, alice)

      expect(jobQueryService.listHistory).toHaveBeenCalledWith(
        expect.objectContaining({
          requesterDiscordUserId: undefined,
          requesterEmail: 'alice@example.com',
        }),
      )
    })

    // ⚠️ The security shape of the whole arm: it is derived, never asked for.
    // A non-admin naming somebody else is still refused *before* any link is
    // resolved, so there is no way to aim the Discord arm at a third party -
    // which is what keeps the attribution-oracle guard on `requesterEmail`
    // (jobs.repo.ts) just as tight over the new column.
    it("refuses a non-admin before resolving anybody's link", async () => {
      adminCheckService.checkIsAdmin.mockResolvedValue(false)

      await expect(
        controller.getHistory(
          { limit: 24, requester: 'bob@example.com' },
          alice,
        ),
      ).rejects.toThrow(ForbiddenException)

      expect(getLinkedDiscordUserIdByEmail).not.toHaveBeenCalled()
      expect(getLinkedDiscordUserId).not.toHaveBeenCalled()
    })
  })

  // Like activity, history is a per-job feed and the controller applies
  // the attribution mask over the page.
  it('returns the { items, nextCursor, total } envelope, with each item attribution-masked', async () => {
    const hiddenJob = buildJob(buildVideo(), {
      hiddenAttribution: true,
      id: 'z',
      requester: { email: 'someone@example.com', userId: 'u9' },
    })
    jobQueryService.listHistory.mockResolvedValue({
      items: [hiddenJob],
      nextCursor: null,
      total: 1,
    } as never)

    const result = await controller.getHistory({ limit: 24 }, alice)

    expect(result).toEqual({
      items: [{ ...hiddenJob, requester: null }],
      nextCursor: null,
      total: 1,
    })
  })
})

// The `scope`/`requester` contradiction is settled by the schema, before the
// controller ever runs - a 400 from `ZodValidationPipe` rather than one of the
// two silently winning.
describe('HistoryQuerySchema - scope', () => {
  it('rejects scope=all together with a requester', () => {
    const result = HistoryQuerySchema.safeParse({
      requester: 'bob@example.com',
      scope: 'all',
    })

    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.path).toEqual(['scope'])
  })

  it('accepts each of the three scopes on its own', () => {
    expect(HistoryQuerySchema.safeParse({}).success).toBe(true)
    expect(
      HistoryQuerySchema.safeParse({ requester: 'bob@example.com' }).success,
    ).toBe(true)
    expect(HistoryQuerySchema.safeParse({ scope: 'all' }).success).toBe(true)
  })

  it('rejects any other scope value', () => {
    expect(HistoryQuerySchema.safeParse({ scope: 'everyone' }).success).toBe(
      false,
    )
  })
})

/**
 * The same route against a real migrated sqlite database rather than a mocked
 * `JobQueryService`, because the gap this feature closes is a *SQL* one: a
 * service-created job stores `requester_email` as NULL, and no
 * `lower(requester_email) = ?` predicate can match NULL. Mocking the query
 * service would assert that the controller passes `undefined` - which the
 * block above already does - without proving that `undefined` is what makes
 * the row appear.
 */
describe('DownloadController - getHistory against the database', () => {
  let controller: DownloadController
  let dbService: DbService
  let adminCheckService: jest.Mocked<AdminCheckService>
  // One mock behind *both* DiscordLinkService lookups: this block cares that
  // a linked person's two surfaces merge, not which key the controller
  // happened to address the link by (the mocked block above asserts that).
  // Unlinked by default, so the pre-plan-017 assertions here keep describing
  // the email-only filter they were written against.
  let linkedDiscordUserId: jest.Mock

  const admin: ForwardedUser = { email: 'admin@example.com', userId: 'u-admin' }
  const SAM_SNOWFLAKE = '333333333333333333'

  // `jobs_origin_matches_requester` is a real CHECK constraint: origin
  // 'service' *requires* both requester columns to be NULL, and 'web'
  // requires both to be set. So this helper cannot accidentally seed a
  // service job that still carries an email.
  function seedWebJob(id: string, email: string): void {
    dbService.db
      .insert(jobs)
      .values({
        id,
        mediaId: `video:${id}`,
        origin: 'web',
        requesterEmail: email,
        requesterUserId: `u_${email}`,
        status: 'completed',
        type: 'video',
      })
      .run()
  }

  function seedServiceJob(id: string): void {
    dbService.db
      .insert(jobs)
      .values({
        id,
        mediaId: `video:${id}`,
        origin: 'service',
        status: 'completed',
        type: 'video',
      })
      .run()
  }

  function seedDiscordJob(id: string, discordUserId: string): void {
    dbService.db
      .insert(jobs)
      .values({
        discordUserId,
        discordUsername: 'sam',
        id,
        mediaId: `video:${id}`,
        origin: 'discord',
        status: 'completed',
        type: 'video',
      })
      .run()
  }

  beforeEach(async () => {
    dbService = createTestDbService()
    linkedDiscordUserId = jest.fn().mockResolvedValue(null)

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        fakeAttributionResolutionProvider(),
        DownloadStateService,
        JobQueryService,
        { provide: AdminCheckService, useValue: { checkIsAdmin: jest.fn() } },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
        { provide: CurrentReleaseService, useValue: {} },
        {
          provide: DiscordLinkService,
          useValue: {
            getLinkedDiscordUserId: linkedDiscordUserId,
            getLinkedDiscordUserIdByEmail: linkedDiscordUserId,
            registerObservedIdentity: jest.fn(),
          },
        },
        { provide: DbService, useValue: dbService },
        { provide: DiscoveryService, useValue: {} },
        {
          provide: DownloadGateway,
          useValue: { broadcast: jest.fn(), broadcastPerViewer: jest.fn() },
        },
        { provide: DownloadMetricsService, useValue: {} },
        { provide: DownloadService, useValue: {} },
        { provide: ManualImportService, useValue: {} },
        { provide: MediaDownloadService, useValue: {} },
        { provide: MediaFileService, useValue: {} },
        { provide: MediaResolverService, useValue: createFakeMediaResolver() },
        MediaStateService,
        { provide: ProfileService, useValue: {} },
        { provide: ReleaseService, useValue: {} },
        { provide: ShowService, useValue: {} },
      ],
    }).compile()

    controller = module.get(DownloadController)
    adminCheckService = module.get(AdminCheckService)
    adminCheckService.checkIsAdmin.mockResolvedValue(true)
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  // ⚠️ The regression this whole feature exists to prevent. Before `scope=all`
  // there was no query at all that returned this row: the dashboard's stat
  // tiles and audit log counted it, and the history table - the one place you
  // would go looking for it - could not show it.
  it('includes a service-created job with no requester', async () => {
    seedServiceJob('service-1')
    seedWebJob('web-1', 'sam@example.com')

    const page = await controller.getHistory({ limit: 24, scope: 'all' }, admin)

    expect(page.items.map(item => item.id).sort()).toEqual([
      'service-1',
      'web-1',
    ])
    expect(page.total).toBe(2)
    expect(
      page.items.find(item => item.id === 'service-1')?.requester,
    ).toBeNull()
  })

  // The other half of the proof: the row is unreachable by any requester-keyed
  // query, so `scope=all` is not merely more convenient than the old per-user
  // fan-out - it is the only thing that can return it.
  it('excludes that same job from every requester-keyed scope', async () => {
    seedServiceJob('service-1')
    seedWebJob('web-1', 'sam@example.com')

    const named = await controller.getHistory(
      { limit: 24, requester: 'sam@example.com' },
      admin,
    )
    const own = await controller.getHistory({ limit: 24 }, admin)

    expect(named.items.map(item => item.id)).toEqual(['web-1'])
    expect(own.items).toEqual([])
  })

  it('reaches requesters no leaderboard would have named', async () => {
    for (let index = 0; index < 25; index += 1) {
      seedWebJob(`web-${index}`, `user${index}@example.com`)
    }

    const page = await controller.getHistory(
      { limit: 100, scope: 'all' },
      admin,
    )

    expect(page.items).toHaveLength(25)
    expect(page.total).toBe(25)
  })

  // Real backend cursor pagination, not an offset token this app minted - and
  // it walks past the 100-row ceiling the client-side merge stopped at.
  it('pages the whole log with the backend cursor', async () => {
    for (let index = 0; index < 120; index += 1) {
      seedWebJob(`web-${String(index).padStart(3, '0')}`, 'sam@example.com')
    }

    const seen: string[] = []
    let cursor: string | undefined = undefined

    do {
      const page: Awaited<ReturnType<typeof controller.getHistory>> =
        await controller.getHistory({ cursor, limit: 24, scope: 'all' }, admin)

      seen.push(...page.items.map(item => item.id))
      cursor = page.nextCursor ?? undefined
    } while (cursor)

    expect(seen).toHaveLength(120)
    expect(new Set(seen).size).toBe(120)
  })

  it('still narrows by status and type in the unfiltered scope', async () => {
    seedServiceJob('service-1')
    dbService.db
      .insert(jobs)
      .values({
        id: 'failed-1',
        mediaId: 'video:failed-1',
        origin: 'service',
        status: 'failed',
        type: 'video',
      })
      .run()

    const page = await controller.getHistory(
      { limit: 24, scope: 'all', status: [DownloadJobStatus.Failed] },
      admin,
    )

    expect(page.items.map(item => item.id)).toEqual(['failed-1'])
  })
  // ⚠️ Plan 017 §E2's headline, end-to-end through real SQL: one person, two
  // submission surfaces, one list. A mocked JobQueryService cannot show this -
  // the union happens in the `WHERE`, and the two arms read different columns.
  describe('unified history for a linked requester', () => {
    const sam: ForwardedUser = { email: 'sam@example.com', userId: 'u-sam' }

    it("merges a linked viewer's web and discord jobs into one page", async () => {
      linkedDiscordUserId.mockResolvedValue(SAM_SNOWFLAKE)
      seedWebJob('web-1', 'sam@example.com')
      seedDiscordJob('discord-1', SAM_SNOWFLAKE)
      seedDiscordJob('discord-other', '444444444444444444')
      seedWebJob('web-other', 'kim@example.com')

      const page = await controller.getHistory({ limit: 24 }, sam)

      expect(page.items.map(item => item.id).sort()).toEqual([
        'discord-1',
        'web-1',
      ])
      // `total` is computed from the same predicate, so it has to agree - a
      // page of 2 alongside a total of 1 would break the pager.
      expect(page.total).toBe(2)
    })

    it('leaves an unlinked viewer with their web jobs only', async () => {
      seedWebJob('web-1', 'sam@example.com')
      seedDiscordJob('discord-1', SAM_SNOWFLAKE)

      const page = await controller.getHistory({ limit: 24 }, sam)

      expect(page.items.map(item => item.id)).toEqual(['web-1'])
      expect(page.total).toBe(1)
    })

    it("merges the named requester's two surfaces for an admin", async () => {
      linkedDiscordUserId.mockResolvedValue(SAM_SNOWFLAKE)
      seedWebJob('web-1', 'sam@example.com')
      seedDiscordJob('discord-1', SAM_SNOWFLAKE)

      const page = await controller.getHistory(
        { limit: 24, requester: 'sam@example.com' },
        admin,
      )

      expect(page.items.map(item => item.id).sort()).toEqual([
        'discord-1',
        'web-1',
      ])
    })

    // The OR-ed arms must not escape the AND with the other dimensions - see
    // the parenthesization note in jobs.repo.ts's buildRequesterWhere.
    it('still narrows the merged list by type', async () => {
      linkedDiscordUserId.mockResolvedValue(SAM_SNOWFLAKE)
      seedWebJob('web-1', 'sam@example.com')
      seedDiscordJob('discord-1', SAM_SNOWFLAKE)
      dbService.db
        .insert(jobs)
        .values({
          discordUserId: SAM_SNOWFLAKE,
          discordUsername: 'sam',
          id: 'discord-movie',
          mediaId: 'tmdb:550',
          origin: 'discord',
          status: 'completed',
          type: 'movie',
        })
        .run()

      const page = await controller.getHistory(
        { limit: 24, type: [DownloadType.Movie] },
        sam,
      )

      expect(page.items.map(item => item.id)).toEqual(['discord-movie'])
      expect(page.total).toBe(1)
    })
  })
})
