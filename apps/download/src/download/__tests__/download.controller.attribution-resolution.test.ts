// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (like
// DownloadController -> DownloadService) must mock it first. This has to stay
// the FIRST statement in the file.
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

import type { DiscordLinkLookupResponse } from '@lilnas/utils/auth/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AuditLogService } from 'src/audit/audit-log.service'
import { AdminCheckService } from 'src/auth/admin-check.service'
import { AttributionResolutionService } from 'src/auth/attribution-resolution.service'
import { DiscordLinkService } from 'src/auth/discord-link.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
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

import { buildRecord } from './helpers/job-fixtures'

// Kept as a string literal: a snowflake exceeds Number.MAX_SAFE_INTEGER, and
// writing one as a numeric literal trips eslint's no-loss-of-precision.
const SNOWFLAKE = '106060871780851712'

const LINKED: DiscordLinkLookupResponse = {
  identity: {
    discordUserId: SNOWFLAKE,
    username: 'jeremy_now',
    displayName: 'Jeremy',
  },
  user: {
    userId: 'u-jeremy',
    email: 'jeremy@lilnas.io',
    name: 'Jeremy',
  },
}

const UNLINKED: DiscordLinkLookupResponse = { identity: null, user: null }

/**
 * The point of the whole read-time-resolution design, asserted through a real
 * route: **retroactivity**.
 *
 * A job submitted over Discord months ago has `requester_email` NULL forever -
 * `jobs_origin_matches_requester` makes that permanent, and nothing
 * back-fills it when the account is linked later. So the only thing that can
 * make that old job render as the person who made it is the serialization
 * path, and that is what this file exercises: a real
 * `AttributionResolutionService` over a real `DownloadStateService`, with only
 * `DiscordLinkService` (auth's HTTP edge) doubled.
 *
 * Wired against `GET /videos/:id` because it is the shortest route from a
 * stored record to a serialized response; the resolution it performs is the
 * same batch call every other job-serving boundary makes through
 * `serveJob`/`serveJobs`/`serveJobPage`.
 */
describe('DownloadController - read-time link resolution', () => {
  let controller: DownloadController
  let dbService: DbService
  let state: DownloadStateService
  let resolveDiscordUser: jest.Mock
  let resolveLilnasUser: jest.Mock

  const viewer: ForwardedUser = { email: 'viewer@example.com', userId: 'u-v' }

  beforeEach(async () => {
    dbService = createTestDbService()
    resolveDiscordUser = jest.fn().mockResolvedValue(UNLINKED)
    resolveLilnasUser = jest.fn().mockResolvedValue(UNLINKED)

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        AttributionResolutionService,
        DownloadStateService,
        { provide: DbService, useValue: dbService },
        {
          provide: AdminCheckService,
          useValue: { checkIsAdmin: jest.fn().mockResolvedValue(false) },
        },
        { provide: AuditLogService, useValue: { record: jest.fn() } },
        { provide: CurrentReleaseService, useValue: {} },
        {
          provide: DiscordLinkService,
          useValue: {
            registerObservedIdentity: jest.fn(),
            resolveDiscordUser,
            resolveLilnasUser,
          },
        },
        { provide: DiscoveryService, useValue: {} },
        {
          provide: DownloadGateway,
          useValue: { broadcast: jest.fn(), broadcastPerViewer: jest.fn() },
        },
        { provide: DownloadMetricsService, useValue: {} },
        { provide: DownloadService, useValue: {} },
        { provide: JobQueryService, useValue: {} },
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
    state = module.get(DownloadStateService)

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  afterEach(() => {
    dbService.onModuleDestroy()
  })

  /**
   * A historical Discord-origin row, exactly as `hydrateJobRow` produces one:
   * a Discord pair, no requester, and `linkedDiscord: null` (there is no
   * column behind it).
   */
  function seedDiscordJob(hiddenAttribution = false): void {
    state.jobs.set(
      'job-discord',
      buildRecord({
        discordRequester: {
          discordUserId: SNOWFLAKE,
          // The handle frozen on the row at submit time.
          discordUsername: 'jeremy_then',
        },
        hiddenAttribution,
        id: 'job-discord',
        requester: null,
      }),
    )
  }

  it('serializes a linked historical discord job with the resolved requester', async () => {
    resolveDiscordUser.mockResolvedValue(LINKED)
    seedDiscordJob()

    const job = await controller.getVideoJob('job-discord', viewer)

    expect(resolveDiscordUser).toHaveBeenCalledWith(SNOWFLAKE)
    // The whole point: a row that can never carry an email renders as the
    // person who made it, because the link was resolved on the way out.
    expect(job.requester).toEqual({
      email: 'jeremy@lilnas.io',
      userId: 'u-jeremy',
    })
    // ...and it still says it arrived over Discord, under the handle that
    // account goes by *now*.
    expect(job.discordRequester).toEqual({
      discordUserId: SNOWFLAKE,
      discordUsername: 'jeremy_now',
    })
  })

  it('leaves the stored record untouched - the row stays the historical record', async () => {
    resolveDiscordUser.mockResolvedValue(LINKED)
    seedDiscordJob()

    await controller.getVideoJob('job-discord', viewer)

    expect(state.jobs.get('job-discord')).toEqual(
      expect.objectContaining({
        discordRequester: {
          discordUserId: SNOWFLAKE,
          discordUsername: 'jeremy_then',
        },
        requester: null,
      }),
    )
  })

  it('renders an unlinked discord job exactly as stored', async () => {
    resolveDiscordUser.mockResolvedValue(UNLINKED)
    seedDiscordJob()

    const job = await controller.getVideoJob('job-discord', viewer)

    expect(job.requester).toBeNull()
    expect(job.discordRequester).toEqual({
      discordUserId: SNOWFLAKE,
      discordUsername: 'jeremy_then',
    })
    expect(job.linkedDiscord).toBeNull()
  })

  it('gives a web job by a linked person their linkedDiscord handle', async () => {
    resolveLilnasUser.mockResolvedValue(LINKED)
    state.jobs.set(
      'job-web',
      buildRecord({
        id: 'job-web',
        requester: { email: 'jeremy@lilnas.io', userId: 'u-jeremy' },
      }),
    )

    const job = await controller.getVideoJob('job-web', viewer)

    expect(resolveLilnasUser).toHaveBeenCalledWith('u-jeremy')
    expect(job.linkedDiscord).toEqual({
      discordUserId: SNOWFLAKE,
      discordUsername: 'jeremy_now',
    })
    // `linkedDiscord` is not `discordRequester`: this job was submitted from
    // a browser and must not start claiming otherwise.
    expect(job.discordRequester).toBeNull()
  })

  // Resolution runs *before* the mask, so this is the ordering check: the
  // fields are filled and then emptied, not left unfilled by luck.
  it('masks all three identities on a hidden video job for a non-admin viewer, resolved or not', async () => {
    resolveDiscordUser.mockResolvedValue(LINKED)
    seedDiscordJob(true)

    const job = await controller.getVideoJob('job-discord', viewer)

    expect(resolveDiscordUser).toHaveBeenCalledWith(SNOWFLAKE)
    expect(job.requester).toBeNull()
    expect(job.discordRequester).toBeNull()
    expect(job.linkedDiscord).toBeNull()
    expect(job.hiddenAttribution).toBe(true)
  })
})
