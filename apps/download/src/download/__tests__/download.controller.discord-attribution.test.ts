// nanoid v5 ships ESM-only; this codebase's ts-jest transform doesn't cover
// it, so any test that transitively imports code using nanoid (DownloadService
// and MediaDownloadService, both real here) must mock it first. This has to
// stay the FIRST statement in the file.
jest.mock('nanoid', () => ({
  nanoid: jest.fn(() => 'mock-id'),
}))

// `DownloadService.createVideoDownloadJob()` mkdir -p's `/download/videos/<id>`
// before handing the job to the scheduler, which no test runner can be allowed
// to do for real. Same shallow-mock shape download-video.service.test.ts uses.
jest.mock('fs-extra', () => ({
  ensureDir: jest.fn(() => Promise.resolve()),
}))

import type { DiscordRequester } from '@lilnas/utils/download/types'
import { Logger } from '@nestjs/common'
import { Test, TestingModule } from '@nestjs/testing'

import { AuditLogService } from 'src/audit/audit-log.service'
import { fakeAttributionResolutionProvider } from 'src/auth/__tests__/helpers/attribution-resolution'
import { AdminCheckService } from 'src/auth/admin-check.service'
import { DiscordLinkService } from 'src/auth/discord-link.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbService } from 'src/db/db.service'
import { auditLog, jobs } from 'src/db/schema'
import { DownloadController } from 'src/download/download.controller'
import { DownloadService } from 'src/download/download.service'
import { DownloadMetricsService } from 'src/download/download-metrics.service'
import { DownloadSchedulerService } from 'src/download/download-scheduler.service'
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
import { RadarrService } from 'src/media/radarr.service'
import { ReleaseService } from 'src/media/release.service'
import { ShowService } from 'src/media/show.service'
import { SonarrService } from 'src/media/sonarr.service'

/**
 * Phase 018: the write half of Discord attribution, end to end.
 *
 * Deliberately wired against a **real** DbService, AuditLogService,
 * DownloadService, DownloadStateService and MediaDownloadService rather than
 * the mocked-service style of the sibling controller specs. The whole point
 * of this file is the two columns and the two CHECK constraints at the far
 * end of the thread - `jobs_origin_matches_requester` and
 * `audit_log_origin_matches_actor` - and a mocked service asserts only that
 * the controller said the right words, not that sqlite accepted them. The
 * "both headers" case in particular is a *rejected INSERT* if precedence is
 * got wrong, which no `toHaveBeenCalledWith` can see.
 *
 * Only the genuinely external edges are doubled: Radarr/Sonarr, the WS
 * gateway, the media resolver, the admin check, and DiscordLinkService (whose
 * own behaviour is covered by auth/__tests__/discord-link.service.spec.ts).
 */
describe('DownloadController - Discord attribution', () => {
  let controller: DownloadController
  let dbService: DbService
  let downloadService: DownloadService
  let discordLinkService: { registerObservedIdentity: jest.Mock }
  let warn: jest.SpyInstance

  // Kept as string literals throughout: a Discord snowflake exceeds
  // Number.MAX_SAFE_INTEGER, and writing one as a numeric literal trips
  // eslint's no-loss-of-precision.
  const discordUser: DiscordRequester = {
    discordUserId: '106060871780851712',
    discordUsername: 'jeremy',
  }
  const alice: ForwardedUser = { email: 'alice@example.com', userId: 'u1' }

  /** Every persisted `jobs` row, which for these tests is always exactly one. */
  function jobRows() {
    return dbService.db.select().from(jobs).all()
  }

  /** Every persisted `audit_log` row, likewise always exactly one. */
  function auditRows() {
    return dbService.db.select().from(auditLog).all()
  }

  beforeEach(async () => {
    dbService = createTestDbService()
    discordLinkService = { registerObservedIdentity: jest.fn() }

    const scheduler = { add: jest.fn(), setQueueDepth: jest.fn() }
    const radarrService = {
      ensureMovie: jest.fn().mockResolvedValue({ movie: {}, radarrId: 42 }),
      getReleases: jest.fn(),
      grabRelease: jest.fn(),
      triggerSearch: jest.fn().mockResolvedValue(undefined),
    }
    const sonarrService = {
      ensureSeries: jest.fn().mockResolvedValue({ series: {}, sonarrId: 9 }),
      getReleases: jest.fn(),
      grabRelease: jest.fn(),
      resolveScope: jest.fn(),
      triggerSearch: jest.fn().mockResolvedValue(undefined),
      triggerSeasonSearch: jest.fn().mockResolvedValue(undefined),
      triggerEpisodeSearch: jest.fn().mockResolvedValue(undefined),
    }

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [
        fakeAttributionResolutionProvider(),
        AuditLogService,
        DownloadService,
        DownloadStateService,
        MediaDownloadService,
        { provide: DbService, useValue: dbService },
        { provide: AdminCheckService, useValue: { checkIsAdmin: jest.fn() } },
        { provide: CurrentReleaseService, useValue: {} },
        { provide: DiscordLinkService, useValue: discordLinkService },
        { provide: DiscoveryService, useValue: {} },
        {
          provide: DownloadGateway,
          useValue: { broadcast: jest.fn(), broadcastPerViewer: jest.fn() },
        },
        {
          provide: DownloadMetricsService,
          useValue: { jobCreated: jest.fn(), setQueueDepth: jest.fn() },
        },
        { provide: DownloadSchedulerService, useValue: scheduler },
        { provide: JobQueryService, useValue: {} },
        { provide: ManualImportService, useValue: {} },
        { provide: MediaFileService, useValue: {} },
        { provide: MediaResolverService, useValue: createFakeMediaResolver() },
        MediaStateService,
        { provide: ProfileService, useValue: {} },
        { provide: RadarrService, useValue: radarrService },
        { provide: ReleaseService, useValue: {} },
        { provide: ShowService, useValue: {} },
        { provide: SonarrService, useValue: sonarrService },
      ],
    }).compile()

    controller = module.get(DownloadController)
    downloadService = module.get(DownloadService)

    // The real scheduler would also queue the job and kick off yt-dlp; only
    // the persist-and-broadcast half is wanted here, which is exactly what
    // `addJob()` is. Assigned after compile() because the state service
    // doesn't exist until then.
    const downloadStateService = module.get(DownloadStateService)
    scheduler.add.mockImplementation(record =>
      downloadStateService.addJob(record),
    )

    jest.spyOn(Logger.prototype, 'log').mockImplementation()
    jest.spyOn(Logger.prototype, 'error').mockImplementation()
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation()
  })

  afterEach(() => {
    jest.restoreAllMocks()
  })

  // ---------------------------------------------------------------------
  // The matrix: each of the three create routes x each of the four ways a
  // request can be identified.
  // ---------------------------------------------------------------------

  describe.each([
    [
      'POST /videos',
      (user: ForwardedUser | undefined, dc?: DiscordRequester, dn?: string) =>
        controller.createVideoJob(
          { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
          user,
          dc,
          dn,
        ),
      'video.create',
    ],
    [
      'POST /movies',
      (user: ForwardedUser | undefined, dc?: DiscordRequester, dn?: string) =>
        controller.requestMovie({ tmdbId: 123 }, user, dc, dn),
      'movie.request',
    ],
    [
      'POST /shows',
      (user: ForwardedUser | undefined, dc?: DiscordRequester, dn?: string) =>
        controller.requestShow({ tvdbId: 456 }, user, dc, dn),
      'show.request',
    ],
  ] as const)('%s', (_route, create, auditAction) => {
    it('persists origin web and no Discord columns for a forwarded user', async () => {
      await create(alice)

      expect(jobRows()).toEqual([
        expect.objectContaining({
          discordUserId: null,
          discordUsername: null,
          origin: 'web',
          requesterEmail: 'alice@example.com',
          requesterUserId: 'u1',
        }),
      ])
      expect(auditRows()).toEqual([
        expect.objectContaining({
          action: auditAction,
          actorDiscordUserId: null,
          actorDiscordUsername: null,
          actorEmail: 'alice@example.com',
          actorUserId: 'u1',
          origin: 'web',
        }),
      ])
      expect(discordLinkService.registerObservedIdentity).not.toHaveBeenCalled()
    })

    it('persists origin discord and the snowflake for a Discord caller', async () => {
      await create(undefined, discordUser, 'Jeremy A.')

      expect(jobRows()).toEqual([
        expect.objectContaining({
          discordUserId: '106060871780851712',
          discordUsername: 'jeremy',
          origin: 'discord',
          requesterEmail: null,
          requesterUserId: null,
        }),
      ])
      expect(auditRows()).toEqual([
        expect.objectContaining({
          action: auditAction,
          actorDiscordUserId: '106060871780851712',
          actorDiscordUsername: 'jeremy',
          actorEmail: null,
          actorUserId: null,
          origin: 'discord',
        }),
      ])
    })

    // The case the DB is the real judge of: a row carrying both identities
    // violates the CHECK, so "forwarded wins" has to actually drop the pair
    // rather than merely prefer it when rendering.
    it('gives the forwarded user precedence when both identities arrive', async () => {
      await create(alice, discordUser, 'Jeremy A.')

      expect(jobRows()).toEqual([
        expect.objectContaining({
          discordUserId: null,
          discordUsername: null,
          origin: 'web',
          requesterEmail: 'alice@example.com',
        }),
      ])
      expect(auditRows()).toEqual([
        expect.objectContaining({
          actorDiscordUserId: null,
          actorDiscordUsername: null,
          actorEmail: 'alice@example.com',
          origin: 'web',
        }),
      ])
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({ discordUserId: '106060871780851712' }),
        expect.stringContaining('both a forwarded user and a Discord identity'),
      )
    })

    // The pre-Phase-018 path, byte for byte: tdr-bot calls that predate the
    // Discord headers, and the yt-dlp poller, still land as `service`.
    it('persists origin service when neither identity arrives', async () => {
      await create(undefined)

      expect(jobRows()).toEqual([
        expect.objectContaining({
          discordUserId: null,
          discordUsername: null,
          origin: 'service',
          requesterEmail: null,
        }),
      ])
      expect(auditRows()).toEqual([
        expect.objectContaining({
          actorDiscordUserId: null,
          actorEmail: null,
          origin: 'service',
        }),
      ])
      expect(discordLinkService.registerObservedIdentity).not.toHaveBeenCalled()
    })

    // ---- the roster report ----

    it('reports the observed identity to auth, mapping the handle onto `username`', async () => {
      await create(undefined, discordUser, 'Jeremy A.')

      expect(discordLinkService.registerObservedIdentity).toHaveBeenCalledTimes(
        1,
      )
      expect(discordLinkService.registerObservedIdentity).toHaveBeenCalledWith({
        discordUserId: '106060871780851712',
        displayName: 'Jeremy A.',
        username: 'jeremy',
      })
    })

    // `x-discord-display-name` carries Discord's nullable `globalName`, so
    // its absence is normal rather than an error.
    it('reports a null display name when the header is absent', async () => {
      await create(undefined, discordUser)

      expect(discordLinkService.registerObservedIdentity).toHaveBeenCalledWith({
        discordUserId: '106060871780851712',
        displayName: null,
        username: 'jeremy',
      })
    })

    // The account is still worth listing in auth's admin link picker even
    // though the forwarded identity won the attribution.
    it('reports the identity even when a forwarded user took precedence', async () => {
      await create(alice, discordUser, 'Jeremy A.')

      expect(discordLinkService.registerObservedIdentity).toHaveBeenCalledWith({
        discordUserId: '106060871780851712',
        displayName: 'Jeremy A.',
        username: 'jeremy',
      })
    })

    // `registerObservedIdentity` is documented never to throw, and this is
    // what pins that promise being load-bearing rather than incidental: a
    // roster write is bookkeeping, and it must not be able to fail a
    // download that has otherwise succeeded.
    it('still returns a job when the roster report throws', async () => {
      discordLinkService.registerObservedIdentity.mockImplementation(() => {
        throw new Error('auth is down')
      })

      const job = await create(undefined, discordUser, 'Jeremy A.')

      expect(job.id).toBe('mock-id')
      expect(jobRows()).toEqual([
        expect.objectContaining({ origin: 'discord' }),
      ])
    })
  })

  // ---------------------------------------------------------------------
  // The two non-create routes tdr-bot calls. Neither mints a job record, so
  // only the audit row can carry the Discord actor.
  // ---------------------------------------------------------------------

  describe('the video routes tdr-bot also calls', () => {
    beforeEach(async () => {
      const job = await controller.createVideoJob(
        { url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
        undefined,
        discordUser,
        'Jeremy A.',
      )
      discordLinkService.registerObservedIdentity.mockClear()

      // The job-lifecycle half of cancel/delete is somebody else's spec
      // (download.service.test.ts): cancel wants a live yt-dlp child process
      // and delete wants MinIO objects to remove. Stubbing both to succeed
      // leaves exactly what this file is about - which identity the route
      // writes to the audit log once the action has happened.
      jest
        .spyOn(downloadService, 'cancelVideoDownloadJob')
        .mockResolvedValue(job)
      jest
        .spyOn(downloadService, 'deleteVideoDownloadJob')
        .mockResolvedValue(job)
    })

    it.each([
      [
        'cancel',
        'video.cancel',
        () =>
          controller.cancelVideoJob(
            'mock-id',
            undefined,
            discordUser,
            'Jeremy A.',
          ),
      ],
      [
        'delete',
        'video.delete',
        () =>
          controller.deleteVideoJob(
            'mock-id',
            undefined,
            discordUser,
            'Jeremy A.',
          ),
      ],
    ] as const)(
      'attributes a %s to the Discord actor',
      async (_verb, auditAction, run) => {
        await run()

        // [0] is the create from the beforeEach; the action under test is
        // the row appended after it.
        expect(auditRows()[1]).toEqual(
          expect.objectContaining({
            action: auditAction,
            actorDiscordUserId: '106060871780851712',
            actorDiscordUsername: 'jeremy',
            actorEmail: null,
            origin: 'discord',
            targetId: 'mock-id',
          }),
        )
        expect(
          discordLinkService.registerObservedIdentity,
        ).toHaveBeenCalledWith({
          discordUserId: '106060871780851712',
          displayName: 'Jeremy A.',
          username: 'jeremy',
        })
      },
    )
  })
})
