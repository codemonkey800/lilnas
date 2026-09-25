// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> DownloadService) must mock it first (see
// media/__tests__/download.controller.media.test.ts for the same pattern).
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import { ProfileQuerySchema } from '@lilnas/utils/download/schema'
import type { ProfileResponse } from '@lilnas/utils/download/types'
import { ForbiddenException } from '@nestjs/common'
import { GUARDS_METADATA } from '@nestjs/common/constants'
import { Test, TestingModule } from '@nestjs/testing'

import { AuditLogService } from 'src/audit/audit-log.service'
import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { AdminCheckService } from 'src/auth/admin-check.service'
import { DiscordLinkService } from 'src/auth/discord-link.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { ForwardedUserGuard } from 'src/auth/forwarded-user.guard'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { jobs } from 'src/db/schema'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadMetricsService } from 'src/download/download-metrics.service'
import { DownloadStateService } from 'src/download/download-state.service'
import { JobQueryService } from 'src/download/job-query.service'
import { ProfileService } from 'src/download/profile.service'
import { CurrentReleaseService } from 'src/media/current-release.service'
import { DiscoveryService } from 'src/media/discovery.service'
import { ManualImportService } from 'src/media/manual-import.service'
import { MediaDownloadService } from 'src/media/media-download.service'
import { MediaFileService } from 'src/media/media-file.service'
import { MediaResolverService } from 'src/media/media-resolver.service'
import { ReleaseService } from 'src/media/release.service'
import { ShowService } from 'src/media/show.service'

function emptyProfile(email: string): ProfileResponse {
  return {
    user: { email },
    firstDownloadAt: null,
    lastDownloadAt: null,
    jobsPerDay: [],
    totalsByStatus: [],
    totalsByType: [],
    windowDays: 30,
  }
}

describe('DownloadController - getProfile', () => {
  let controller: DownloadController
  let profileService: jest.Mocked<ProfileService>
  let adminCheckService: jest.Mocked<AdminCheckService>

  const alice: ForwardedUser = { email: 'alice@example.com', userId: 'u1' }

  beforeEach(async () => {
    const mockProfileService = {
      getProfile: jest.fn((params: { email: string }) =>
        emptyProfile(params.email),
      ),
    }
    const mockAdminCheckService = { checkIsAdmin: jest.fn() }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        fakeAttributionResolutionProvider(),
        { provide: AdminCheckService, useValue: mockAdminCheckService },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
        { provide: CurrentReleaseService, useValue: {} },
        {
          provide: DiscordLinkService,
          useValue: { registerObservedIdentity: jest.fn() },
        },
        { provide: DiscoveryService, useValue: {} },
        { provide: DownloadMetricsService, useValue: {} },
        { provide: DownloadService, useValue: {} },
        { provide: DownloadStateService, useValue: { jobs: new Map() } },
        { provide: JobQueryService, useValue: {} },
        { provide: ManualImportService, useValue: {} },
        { provide: MediaDownloadService, useValue: {} },
        { provide: MediaFileService, useValue: {} },
        { provide: MediaResolverService, useValue: { resolve: jest.fn() } },
        { provide: ProfileService, useValue: mockProfileService },
        { provide: ReleaseService, useValue: {} },
        { provide: ShowService, useValue: {} },
      ],
    }).compile()

    controller = module.get(DownloadController)
    profileService = module.get(ProfileService)
    adminCheckService = module.get(AdminCheckService)
    adminCheckService.checkIsAdmin.mockResolvedValue(false)
  })

  // The 401 contract: ForwardedUserGuard rejects an identity-less request
  // before the handler runs. The guard's own behaviour is covered in
  // auth/__tests__/forwarded-user.guard.spec.ts; what this route owns is
  // being gated by it, asserted on the metadata Nest itself reads.
  it('gates the route with ForwardedUserGuard so a caller with no identity gets 401', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller.getProfile)).toEqual(
      [ForwardedUserGuard],
    )
  })

  // The 400 contract: the ZodValidationPipe on the query param (asserted
  // structurally for every route in download.controller.validation.test.ts)
  // enforces this schema, which rejects an out-of-range window.
  it('rejects days=0 at the schema the query pipe enforces', () => {
    expect(ProfileQuerySchema.safeParse({ days: '0' }).success).toBe(false)
  })

  it('scopes to the caller when no requester param is given', async () => {
    const result = await controller.getProfile({ days: 30 }, alice)

    expect(profileService.getProfile).toHaveBeenCalledWith({
      days: 30,
      email: 'alice@example.com',
    })
    expect(result.user).toEqual({ email: 'alice@example.com' })
    // Self scope never needs the admin lookup.
    expect(adminCheckService.checkIsAdmin).not.toHaveBeenCalled()
  })

  it('scopes to the caller when requester matches their own email, case-insensitively', async () => {
    await controller.getProfile(
      { days: 30, requester: 'ALICE@EXAMPLE.COM' },
      alice,
    )

    expect(profileService.getProfile).toHaveBeenCalledWith({
      days: 30,
      email: 'alice@example.com',
    })
    expect(adminCheckService.checkIsAdmin).not.toHaveBeenCalled()
  })

  it("throws ForbiddenException when a non-admin requests another user's profile", async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(false)

    await expect(
      controller.getProfile({ days: 30, requester: 'bob@example.com' }, alice),
    ).rejects.toThrow(ForbiddenException)

    expect(profileService.getProfile).not.toHaveBeenCalled()
  })

  it("allows an admin to view another user's profile, scoped to that user", async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(true)

    const result = await controller.getProfile(
      { days: 14, requester: 'bob@example.com' },
      alice,
    )

    expect(profileService.getProfile).toHaveBeenCalledWith({
      days: 14,
      email: 'bob@example.com',
    })
    expect(result.user).toEqual({ email: 'bob@example.com' })
  })

  // No users table anywhere: an unknown email is an empty profile (200),
  // never a 404 - there is no entity to be missing.
  it('returns an empty profile for an email with no jobs when asked by an admin', async () => {
    adminCheckService.checkIsAdmin.mockResolvedValue(true)

    const result = await controller.getProfile(
      { days: 30, requester: 'nobody@example.com' },
      alice,
    )

    expect(result).toEqual(emptyProfile('nobody@example.com'))
  })
})

/**
 * The same route against a real migrated sqlite database and the real
 * `ProfileService`, because plan 017 §E2's promise is a *SQL* one: a linked
 * person's Discord-submitted jobs live in different columns than their
 * web-submitted ones, and only the OR-ed `WHERE` makes one profile out of
 * both. A mocked ProfileService would only re-assert the scoping the block
 * above already covers.
 */
describe('DownloadController - getProfile against the database', () => {
  let controller: DownloadController
  let dbService: DbService
  let getLinkedDiscordUserIdByEmail: jest.Mock
  let checkIsAdmin: jest.Mock

  const sam: ForwardedUser = { email: 'sam@example.com', userId: 'u-sam' }
  const admin: ForwardedUser = { email: 'admin@example.com', userId: 'u-admin' }
  // String literals - a real snowflake exceeds Number.MAX_SAFE_INTEGER.
  const SAM_SNOWFLAKE = '333333333333333333'
  const KIM_SNOWFLAKE = '444444444444444444'

  function seedWebJob(id: string, email: string, createdAt: Date): void {
    dbService.db
      .insert(jobs)
      .values({
        createdAt,
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

  function seedDiscordJob(
    id: string,
    discordUserId: string,
    createdAt: Date,
  ): void {
    dbService.db
      .insert(jobs)
      .values({
        createdAt,
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
    getLinkedDiscordUserIdByEmail = jest.fn().mockResolvedValue(null)
    checkIsAdmin = jest.fn().mockResolvedValue(true)

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        fakeAttributionResolutionProvider(),
        ProfileService,
        { provide: AdminCheckService, useValue: { checkIsAdmin } },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
        { provide: CurrentReleaseService, useValue: {} },
        { provide: DbService, useValue: dbService },
        {
          provide: DiscordLinkService,
          useValue: {
            getLinkedDiscordUserId: jest.fn().mockResolvedValue(null),
            getLinkedDiscordUserIdByEmail,
            registerObservedIdentity: jest.fn(),
          },
        },
        { provide: DiscoveryService, useValue: {} },
        { provide: DownloadMetricsService, useValue: {} },
        { provide: DownloadService, useValue: {} },
        { provide: DownloadStateService, useValue: { jobs: new Map() } },
        { provide: JobQueryService, useValue: {} },
        { provide: ManualImportService, useValue: {} },
        { provide: MediaDownloadService, useValue: {} },
        { provide: MediaFileService, useValue: {} },
        { provide: MediaResolverService, useValue: { resolve: jest.fn() } },
        { provide: ReleaseService, useValue: {} },
        { provide: ShowService, useValue: {} },
      ],
    }).compile()

    controller = module.get(DownloadController)
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  it("counts a linked viewer's jobs from both surfaces as one profile", async () => {
    getLinkedDiscordUserIdByEmail.mockResolvedValue(SAM_SNOWFLAKE)
    seedWebJob('web-1', 'sam@example.com', new Date('2026-06-14T00:00:00Z'))
    seedDiscordJob('discord-1', SAM_SNOWFLAKE, new Date('2026-06-13T00:00:00Z'))
    seedDiscordJob(
      'discord-kim',
      KIM_SNOWFLAKE,
      new Date('2026-06-12T00:00:00Z'),
    )
    seedWebJob('web-kim', 'kim@example.com', new Date('2026-06-11T00:00:00Z'))

    const profile = await controller.getProfile({ days: 3650 }, sam)

    expect(profile.totalsByType).toEqual([{ count: 2, type: 'video' }])
    expect(profile.totalsByStatus).toEqual([{ count: 2, status: 'completed' }])
    // The bounds widen too, or the page would say "first download: the 14th"
    // while listing a job from the 13th.
    expect(profile.firstDownloadAt).toBe('2026-06-13T00:00:00.000Z')
    expect(profile.lastDownloadAt).toBe('2026-06-14T00:00:00.000Z')
  })

  it('leaves an unlinked viewer with their web jobs only', async () => {
    seedWebJob('web-1', 'sam@example.com', new Date('2026-06-14T00:00:00Z'))
    seedDiscordJob('discord-1', SAM_SNOWFLAKE, new Date('2026-06-13T00:00:00Z'))

    const profile = await controller.getProfile({ days: 3650 }, sam)

    expect(profile.totalsByType).toEqual([{ count: 1, type: 'video' }])
    expect(profile.firstDownloadAt).toBe('2026-06-14T00:00:00.000Z')
  })

  // ⚠️ The link follows the profile's *subject*. An admin looking at sam must
  // get sam's Discord jobs folded in, never their own.
  it("resolves the subject's link, not the admin's, for another user's profile", async () => {
    getLinkedDiscordUserIdByEmail.mockResolvedValue(SAM_SNOWFLAKE)
    seedWebJob('web-1', 'sam@example.com', new Date('2026-06-14T00:00:00Z'))
    seedDiscordJob('discord-1', SAM_SNOWFLAKE, new Date('2026-06-13T00:00:00Z'))

    const profile = await controller.getProfile(
      { days: 3650, requester: 'sam@example.com' },
      admin,
    )

    expect(getLinkedDiscordUserIdByEmail).toHaveBeenCalledWith(
      'sam@example.com',
    )
    expect(getLinkedDiscordUserIdByEmail).not.toHaveBeenCalledWith(
      'admin@example.com',
    )
    expect(profile.totalsByType).toEqual([{ count: 2, type: 'video' }])
  })
})
