import type { DiscordLinkLookupResponse } from '@lilnas/utils/auth/types'
import type {
  AuditLogEntry,
  DownloadJob,
  GalleryItem,
} from '@lilnas/utils/download/types'
import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'

import { AttributionResolutionService } from 'src/auth/attribution-resolution.service'
import type { DiscordLinkService } from 'src/auth/discord-link.service'

// Real snowflakes exceed Number.MAX_SAFE_INTEGER, so they are string literals
// here (a numeric literal would also trip eslint's no-loss-of-precision).
const ALICE_SNOWFLAKE = '123456789012345678'
const BOB_SNOWFLAKE = '223456789012345678'

const ALICE_USER_ID = 'user-alice'
const BOB_USER_ID = 'user-bob'

const UNLINKED: DiscordLinkLookupResponse = { identity: null, user: null }

/** Observed by auth's roster and linked to a lilnas account. */
const ALICE_LINKED: DiscordLinkLookupResponse = {
  identity: {
    discordUserId: ALICE_SNOWFLAKE,
    username: 'alice_now',
    displayName: 'Alice',
  },
  user: {
    userId: ALICE_USER_ID,
    email: 'alice@example.com',
    name: 'Alice Example',
  },
}

/** Observed by auth's roster but never linked to a lilnas account. */
const BOB_OBSERVED: DiscordLinkLookupResponse = {
  identity: {
    discordUserId: BOB_SNOWFLAKE,
    username: 'bob_now',
    displayName: null,
  },
  user: null,
}

function buildJob(overrides: Partial<DownloadJob> = {}): DownloadJob {
  return {
    completedAt: null,
    createdAt: '2026-08-20T12:00:00.000Z',
    discordRequester: null,
    hiddenAttribution: false,
    id: 'job-1',
    linkedDiscord: null,
    media: {
      id: 'video:v1',
      sourceUrl: 'https://example.com/video',
      title: 'A video',
      type: DownloadType.Video,
    },
    requester: null,
    status: DownloadJobStatus.Completed,
    updatedAt: '2026-08-20T12:00:00.000Z',
    ...overrides,
  }
}

describe('AttributionResolutionService', () => {
  let resolveDiscordUser: jest.Mock
  let resolveLilnasUser: jest.Mock
  let service: AttributionResolutionService

  beforeEach(() => {
    resolveDiscordUser = jest.fn().mockResolvedValue(UNLINKED)
    resolveLilnasUser = jest.fn().mockResolvedValue(UNLINKED)

    service = new AttributionResolutionService({
      resolveDiscordUser,
      resolveLilnasUser,
    } as unknown as DiscordLinkService)
  })

  describe('resolveJobs - the forward direction', () => {
    it('gives a linked Discord job a requester, without touching the media or the id', async () => {
      resolveDiscordUser.mockResolvedValue(ALICE_LINKED)

      const job = buildJob({
        discordRequester: {
          discordUserId: ALICE_SNOWFLAKE,
          discordUsername: 'alice_then',
        },
      })

      const [resolved] = await service.resolveJobs([job])

      expect(resolved?.requester).toEqual({
        email: 'alice@example.com',
        userId: ALICE_USER_ID,
      })
      expect(resolved?.id).toBe('job-1')
      expect(resolved?.media).toEqual(job.media)
    })

    it("refreshes a renamed-but-unlinked account's displayed handle, leaving requester null", async () => {
      resolveDiscordUser.mockResolvedValue(BOB_OBSERVED)

      const [resolved] = await service.resolveJobs([
        buildJob({
          discordRequester: {
            discordUserId: BOB_SNOWFLAKE,
            discordUsername: 'bob_then',
          },
        }),
      ])

      expect(resolved?.discordRequester).toEqual({
        discordUserId: BOB_SNOWFLAKE,
        discordUsername: 'bob_now',
      })
      expect(resolved?.requester).toBeNull()
    })

    it('never mutates the job it was given - the stored handle stays the historical record', async () => {
      resolveDiscordUser.mockResolvedValue(ALICE_LINKED)

      const job = buildJob({
        discordRequester: {
          discordUserId: ALICE_SNOWFLAKE,
          discordUsername: 'alice_then',
        },
      })
      const original = structuredClone(job)

      await service.resolveJobs([job])

      expect(job).toEqual(original)
    })

    it('leaves a snowflake auth has never seen exactly as stored', async () => {
      resolveDiscordUser.mockResolvedValue(UNLINKED)

      const job = buildJob({
        discordRequester: {
          discordUserId: BOB_SNOWFLAKE,
          discordUsername: 'bob_then',
        },
      })

      const [resolved] = await service.resolveJobs([job])

      expect(resolved).toEqual(job)
    })
  })

  describe('resolveJobs - the reverse direction', () => {
    it('gives a web job by a linked person their linkedDiscord handle', async () => {
      resolveLilnasUser.mockResolvedValue(ALICE_LINKED)

      const [resolved] = await service.resolveJobs([
        buildJob({
          requester: { email: 'alice@example.com', userId: ALICE_USER_ID },
        }),
      ])

      expect(resolveLilnasUser).toHaveBeenCalledWith(ALICE_USER_ID)
      // Mapped, not passed through: auth spells the handle `username`, the
      // download wire spells it `discordUsername`.
      expect(resolved?.linkedDiscord).toEqual({
        discordUserId: ALICE_SNOWFLAKE,
        discordUsername: 'alice_now',
      })
      // The field that says "submitted from Discord" stays null - this job
      // was not. The two are never collapsed.
      expect(resolved?.discordRequester).toBeNull()
    })

    it('leaves linkedDiscord null for a web job by an unlinked person', async () => {
      resolveLilnasUser.mockResolvedValue(UNLINKED)

      const job = buildJob({
        requester: { email: 'carol@example.com', userId: 'user-carol' },
      })

      const [resolved] = await service.resolveJobs([job])

      expect(resolved).toEqual(job)
      expect(resolved?.linkedDiscord).toBeNull()
    })

    it('fills linkedDiscord on a job whose requester was itself just resolved', async () => {
      resolveDiscordUser.mockResolvedValue(ALICE_LINKED)

      const [resolved] = await service.resolveJobs([
        buildJob({
          discordRequester: {
            discordUserId: ALICE_SNOWFLAKE,
            discordUsername: 'alice_then',
          },
        }),
      ])

      expect(resolved?.requester).toEqual({
        email: 'alice@example.com',
        userId: ALICE_USER_ID,
      })
      expect(resolved?.linkedDiscord).toEqual({
        discordUserId: ALICE_SNOWFLAKE,
        discordUsername: 'alice_now',
      })
      // ...and it cost no second lookup: the `d:` envelope already carried
      // the identity that answers the reverse question.
      expect(resolveLilnasUser).not.toHaveBeenCalled()
    })

    it('leaves a job with neither identity untouched', async () => {
      const job = buildJob()

      const [resolved] = await service.resolveJobs([job])

      expect(resolved).toEqual(job)
      expect(resolveDiscordUser).not.toHaveBeenCalled()
      expect(resolveLilnasUser).not.toHaveBeenCalled()
    })

    it('is idempotent - resolving an already-resolved page changes nothing', async () => {
      resolveDiscordUser.mockResolvedValue(ALICE_LINKED)
      resolveLilnasUser.mockResolvedValue(ALICE_LINKED)

      const once = await service.resolveJobs([
        buildJob({
          discordRequester: {
            discordUserId: ALICE_SNOWFLAKE,
            discordUsername: 'alice_then',
          },
        }),
      ])
      const twice = await service.resolveJobs(once)

      expect(twice).toEqual(once)
    })
  })

  describe('resolveJobs - batching', () => {
    it('dedupes distinct snowflakes and distinct requester ids across the page', async () => {
      resolveDiscordUser.mockResolvedValue(ALICE_LINKED)
      resolveLilnasUser.mockResolvedValue(UNLINKED)

      const discordJob = buildJob({
        discordRequester: {
          discordUserId: ALICE_SNOWFLAKE,
          discordUsername: 'alice_then',
        },
      })
      const webJob = buildJob({
        requester: { email: 'bob@example.com', userId: BOB_USER_ID },
      })

      await service.resolveJobs([
        discordJob,
        { ...discordJob, id: 'job-2' },
        { ...discordJob, id: 'job-3' },
        webJob,
        { ...webJob, id: 'job-5' },
      ])

      // Three jobs from one Discord account, two from one requester: two
      // lookups total, not five.
      expect(resolveDiscordUser).toHaveBeenCalledTimes(1)
      expect(resolveLilnasUser).toHaveBeenCalledTimes(1)
    })

    it('resolves both directions in one round, not one round per direction', async () => {
      const order: string[] = []
      // Neither lookup resolves until both have been *called*, so a
      // sequential implementation (await the forward round, then start the
      // reverse one) would deadlock this test rather than quietly pass it.
      let releaseDiscord: () => void = () => undefined
      let releaseUser: () => void = () => undefined
      const bothCalled = Promise.all([
        new Promise<void>(resolve => {
          releaseDiscord = resolve
        }),
        new Promise<void>(resolve => {
          releaseUser = resolve
        }),
      ])

      resolveDiscordUser.mockImplementation(async () => {
        order.push('discord')
        releaseDiscord()
        await bothCalled
        return ALICE_LINKED
      })
      resolveLilnasUser.mockImplementation(async () => {
        order.push('user')
        releaseUser()
        await bothCalled
        return UNLINKED
      })

      await service.resolveJobs([
        buildJob({
          discordRequester: {
            discordUserId: ALICE_SNOWFLAKE,
            discordUsername: 'alice_then',
          },
        }),
        buildJob({
          id: 'job-2',
          requester: { email: 'bob@example.com', userId: BOB_USER_ID },
        }),
      ])

      expect(order).toHaveLength(2)
    })
  })

  describe('resolveJobs - auth failures', () => {
    // DiscordLinkService is documented never to reject: it fails open to
    // `{ identity: null, user: null }`. This asserts the behaviour that
    // contract buys - an auth outage renders jobs exactly as they were
    // stored, which is how they rendered before this feature existed.
    it('leaves every job untouched when auth answers "unknown" for everything', async () => {
      resolveDiscordUser.mockResolvedValue(UNLINKED)
      resolveLilnasUser.mockResolvedValue(UNLINKED)

      const jobs = [
        buildJob({
          discordRequester: {
            discordUserId: ALICE_SNOWFLAKE,
            discordUsername: 'alice_then',
          },
        }),
        buildJob({
          id: 'job-2',
          requester: { email: 'bob@example.com', userId: BOB_USER_ID },
        }),
      ]

      await expect(service.resolveJobs(jobs)).resolves.toEqual(jobs)
    })
  })

  describe('resolveGalleryItems', () => {
    const galleryItem = (overrides: Partial<GalleryItem>): GalleryItem => ({
      addedAt: '2026-08-20T12:00:00.000Z',
      downloadCount: 1,
      lastDiscordRequester: null,
      lastDownloadedAt: '2026-08-20T12:00:00.000Z',
      lastRequester: null,
      media: {
        id: 'video:v1',
        sourceUrl: 'https://example.com/video',
        title: 'A video',
        type: DownloadType.Video,
      },
      ...overrides,
    })

    it('applies the forward direction to lastDiscordRequester/lastRequester', async () => {
      resolveDiscordUser.mockResolvedValue(ALICE_LINKED)

      const [resolved] = await service.resolveGalleryItems([
        galleryItem({
          lastDiscordRequester: {
            discordUserId: ALICE_SNOWFLAKE,
            discordUsername: 'alice_then',
          },
        }),
      ])

      expect(resolved?.lastRequester).toEqual({
        email: 'alice@example.com',
        userId: ALICE_USER_ID,
      })
      expect(resolved?.lastDiscordRequester).toEqual({
        discordUserId: ALICE_SNOWFLAKE,
        discordUsername: 'alice_now',
      })
    })

    // There is no `linkedDiscord` on a gallery card to put the answer in, so
    // the reverse lookup is skipped rather than made and discarded - which
    // is what keeps a page of web-origin cards (the common case) free.
    it('costs no lookups for a page of web-origin cards', async () => {
      await service.resolveGalleryItems([
        galleryItem({
          lastRequester: { email: 'bob@example.com', userId: BOB_USER_ID },
        }),
      ])

      expect(resolveLilnasUser).not.toHaveBeenCalled()
      expect(resolveDiscordUser).not.toHaveBeenCalled()
    })

    it('leaves a masked card (both fields null) untouched', async () => {
      const item = galleryItem({})

      await expect(service.resolveGalleryItems([item])).resolves.toEqual([item])
      expect(resolveDiscordUser).not.toHaveBeenCalled()
    })
  })

  describe('resolveAuditEntries', () => {
    const auditEntry = (overrides: Partial<AuditLogEntry>): AuditLogEntry => ({
      action: 'video.create',
      actor: null,
      createdAt: '2026-08-20T12:00:00.000Z',
      discordActor: null,
      id: 7,
      metadata: null,
      origin: 'discord',
      targetId: 'job-1',
      targetType: 'job',
      ...overrides,
    })

    it('fills actor on a linked discord-origin row and refreshes the handle', async () => {
      resolveDiscordUser.mockResolvedValue(ALICE_LINKED)

      const [resolved] = await service.resolveAuditEntries([
        auditEntry({
          discordActor: {
            discordUserId: ALICE_SNOWFLAKE,
            discordUsername: 'alice_then',
          },
        }),
      ])

      expect(resolved?.actor).toEqual({
        email: 'alice@example.com',
        userId: ALICE_USER_ID,
      })
      expect(resolved?.discordActor).toEqual({
        discordUserId: ALICE_SNOWFLAKE,
        discordUsername: 'alice_now',
      })
    })

    // `origin` records how the action arrived, which is a fact about the past
    // that linking an account afterwards cannot change.
    it('leaves origin as discord even once an actor has been resolved onto the row', async () => {
      resolveDiscordUser.mockResolvedValue(ALICE_LINKED)

      const [resolved] = await service.resolveAuditEntries([
        auditEntry({
          discordActor: {
            discordUserId: ALICE_SNOWFLAKE,
            discordUsername: 'alice_then',
          },
        }),
      ])

      expect(resolved?.origin).toBe('discord')
    })

    it('leaves a web-origin row untouched and asks auth nothing', async () => {
      const entry = auditEntry({
        actor: { email: 'bob@example.com', userId: BOB_USER_ID },
        origin: 'web',
      })

      await expect(service.resolveAuditEntries([entry])).resolves.toEqual([
        entry,
      ])
      expect(resolveDiscordUser).not.toHaveBeenCalled()
      expect(resolveLilnasUser).not.toHaveBeenCalled()
    })
  })
})
