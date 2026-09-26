import { DownloadJobStatus, DownloadType } from '@lilnas/utils/download/types'
import { Client } from 'minio'

import { DownloadCommandService } from 'src/commands/download-command.service'

// ─── External dependency mocks ────────────────────────────────────────────────

jest.mock('discord.js', () => ({
  DiscordAPIError: class DiscordAPIError extends Error {
    code: number

    constructor(code: number) {
      super('Discord API Error')
      this.code = code
    }
  },
  MessageFlags: {
    Ephemeral: 64,
  },
}))

jest.mock('necord', () => ({
  BooleanOption: jest.fn(
    () => (_target: unknown, _propertyKey: string, _parameterIndex: number) => {
      void _target
      void _propertyKey
      void _parameterIndex
    },
  ),
  Context: jest.fn(
    () => (_target: unknown, _propertyKey: string, _parameterIndex: number) => {
      void _target
      void _propertyKey
      void _parameterIndex
    },
  ),
  Options: jest.fn(
    () => (_target: unknown, _propertyKey: string, _parameterIndex: number) => {
      void _target
      void _propertyKey
      void _parameterIndex
    },
  ),
  SlashCommand: jest.fn(
    () =>
      (
        _target: unknown,
        _propertyKey: string,
        _descriptor: PropertyDescriptor,
      ) => {
        void _target
        void _propertyKey
        void _descriptor
      },
  ),
  StringOption: jest.fn(
    () =>
      (_options: unknown) =>
      (_target: unknown, _propertyKey: string, _parameterIndex: number) => {
        void _options
        void _target
        void _propertyKey
        void _parameterIndex
      },
  ),
}))

jest.mock('fs-extra', () => ({
  ensureDir: jest.fn().mockResolvedValue(undefined),
  remove: jest.fn().mockResolvedValue(undefined),
}))

const mockClient = {
  cancelJob: jest.fn(),
  createJob: jest.fn(),
  getJob: jest.fn(),
  waitForJob: jest.fn(),
  // Returns a *derived* client in production; the derived client is wired
  // up in `beforeEach` so each test can assert which of the two a call
  // went through.
  withDiscordIdentity: jest.fn(),
}

jest.mock('@lilnas/utils/download/client', () => ({
  DownloadClient: jest.fn(() => mockClient),
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Snowflakes exceed Number.MAX_SAFE_INTEGER, so they are always strings - both
// on the Discord API and here (a numeric literal would trip
// `no-loss-of-precision`).
const USER_ID = '221093544588935169'

function createMockInteraction({
  globalName = 'Test Er',
}: { globalName?: string | null } = {}) {
  return {
    channel: {
      isSendable: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    user: { id: USER_ID, username: 'tester', globalName },
  }
}

type PrivateAwaitJob = {
  awaitJob: (args: {
    author?: string
    description?: string
    id: string
    interaction: ReturnType<typeof createMockInteraction>
    jobId: string
    url: string
  }) => Promise<void>
}

describe('DownloadCommandService', () => {
  // Stands in for the per-interaction client `withDiscordIdentity` hands back.
  // It deliberately only carries `createJob`: nothing else is supposed to be
  // called on the identity-scoped client, so a stray call fails loudly.
  const mockDiscordScopedClient = {
    createJob: jest.fn(),
  }

  let service: DownloadCommandService

  beforeEach(() => {
    process.env.DOWNLOAD_JOB_TIMEOUT_MS = '100000'

    // `clearMocks` wipes this before every test, so it has to be re-armed here.
    mockClient.withDiscordIdentity.mockReturnValue(mockDiscordScopedClient)

    service = new DownloadCommandService({} as unknown as Client)
  })

  describe('awaitJob', () => {
    it('sends an ephemeral notice with the error when the job failed', async () => {
      const interaction = createMockInteraction()
      mockClient.waitForJob.mockResolvedValue({
        id: 'job-1',
        status: DownloadJobStatus.Failed,
        error: 'ERROR: Video unavailable',
        media: {
          type: DownloadType.Video,
          sourceUrl: 'https://example.com/video',
        },
      })

      await (service as unknown as PrivateAwaitJob).awaitJob({
        id: 'req-1',
        interaction: interaction as never,
        jobId: 'job-1',
        url: 'https://example.com/video',
      })

      expect(interaction.followUp).toHaveBeenCalledTimes(1)
      const [{ content, flags }] = interaction.followUp.mock.calls[0] as [
        { content: string; flags: number[] },
      ]
      expect(flags).toEqual([64])
      expect(content).toContain('download failed')
      expect(content).toContain('ERROR: Video unavailable')
      expect(interaction.channel.send).not.toHaveBeenCalled()
    })

    it('omits the error block when the job has no error message', async () => {
      const interaction = createMockInteraction()
      mockClient.waitForJob.mockResolvedValue({
        id: 'job-1',
        status: DownloadJobStatus.Failed,
        media: {
          type: DownloadType.Video,
          sourceUrl: 'https://example.com/video',
        },
      })

      await (service as unknown as PrivateAwaitJob).awaitJob({
        id: 'req-1',
        interaction: interaction as never,
        jobId: 'job-1',
        url: 'https://example.com/video',
      })

      const [{ content }] = interaction.followUp.mock.calls[0] as [
        { content: string },
      ]
      expect(content).not.toContain('```')
    })

    it('sends an ephemeral notice when the job was cancelled', async () => {
      const interaction = createMockInteraction()
      mockClient.waitForJob.mockResolvedValue({
        id: 'job-1',
        status: DownloadJobStatus.Cancelled,
        media: {
          type: DownloadType.Video,
          sourceUrl: 'https://example.com/video',
        },
      })

      await (service as unknown as PrivateAwaitJob).awaitJob({
        id: 'req-1',
        interaction: interaction as never,
        jobId: 'job-1',
        url: 'https://example.com/video',
      })

      expect(interaction.followUp).toHaveBeenCalledTimes(1)
      const [{ flags }] = interaction.followUp.mock.calls[0] as [
        { flags: number[] },
      ]
      expect(flags).toEqual([64])
      expect(interaction.channel.send).not.toHaveBeenCalled()
    })

    it('sends files when the job completed with download urls', async () => {
      const minioClient = {
        fGetObject: jest.fn().mockResolvedValue(undefined),
      } as unknown as Client
      service = new DownloadCommandService(minioClient)

      const interaction = createMockInteraction()
      mockClient.waitForJob.mockResolvedValue({
        id: 'job-1',
        status: DownloadJobStatus.Completed,
        media: {
          type: DownloadType.Video,
          sourceUrl: 'https://example.com/video',
          title: 'Some Video',
          downloadUrls: ['https://storage.example.com/videos/job-1/file.mp4'],
        },
      })

      await (service as unknown as PrivateAwaitJob).awaitJob({
        id: 'req-1',
        interaction: interaction as never,
        jobId: 'job-1',
        url: 'https://example.com/video',
      })

      expect(interaction.channel.send).toHaveBeenCalledTimes(1)
      const [{ files }] = interaction.channel.send.mock.calls[0] as [
        { files: string[] },
      ]
      expect(files).toEqual(['/tmp/tdr-videos/job-1/file.mp4'])
      expect(interaction.followUp).not.toHaveBeenCalled()
    })

    it('sends a "no files" notice when the job completed with no download urls', async () => {
      const interaction = createMockInteraction()
      mockClient.waitForJob.mockResolvedValue({
        id: 'job-1',
        status: DownloadJobStatus.Completed,
        media: {
          type: DownloadType.Video,
          sourceUrl: 'https://example.com/video',
          downloadUrls: [],
        },
      })

      await (service as unknown as PrivateAwaitJob).awaitJob({
        id: 'req-1',
        interaction: interaction as never,
        jobId: 'job-1',
        url: 'https://example.com/video',
      })

      expect(interaction.channel.send).not.toHaveBeenCalled()
      expect(interaction.followUp).toHaveBeenCalledTimes(1)
      const [{ content, flags }] = interaction.followUp.mock.calls[0] as [
        { content: string; flags: number[] },
      ]
      expect(flags).toEqual([64])
      expect(content).toContain('produced no files')
    })

    it('cancels the job and sends an ephemeral notice on timeout', async () => {
      process.env.DOWNLOAD_JOB_TIMEOUT_MS = '5'
      mockClient.cancelJob.mockResolvedValue(undefined)
      mockClient.waitForJob.mockImplementation(
        (_id: string, { signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason))
          }),
      )

      const interaction = createMockInteraction()

      await (service as unknown as PrivateAwaitJob).awaitJob({
        id: 'req-1',
        interaction: interaction as never,
        jobId: 'job-1',
        url: 'https://example.com/video',
      })

      expect(mockClient.cancelJob).toHaveBeenCalledWith('job-1')
      expect(interaction.followUp).toHaveBeenCalledTimes(1)
      const [{ content, flags }] = interaction.followUp.mock.calls[0] as [
        { content: string; flags: number[] },
      ]
      expect(flags).toEqual([64])
      expect(content).toContain('timed out')
      expect(interaction.channel.send).not.toHaveBeenCalled()
    })

    it('swallows a cancelJob rejection during the timeout path', async () => {
      process.env.DOWNLOAD_JOB_TIMEOUT_MS = '5'
      mockClient.cancelJob.mockRejectedValue(new Error('already gone'))
      mockClient.waitForJob.mockImplementation(
        (_id: string, { signal }: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason))
          }),
      )

      const interaction = createMockInteraction()
      const loggerWarnSpy = jest.spyOn(service['logger'], 'warn')

      await expect(
        (service as unknown as PrivateAwaitJob).awaitJob({
          id: 'req-1',
          interaction: interaction as never,
          jobId: 'job-1',
          url: 'https://example.com/video',
        }),
      ).resolves.toBeUndefined()

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-1' }),
        'Failed to cancel timed-out download job',
      )
      expect(interaction.followUp).toHaveBeenCalledTimes(1)
    })

    it('sends a "lost track of the job" notice when waitForJob rejects with a non-abort error', async () => {
      const interaction = createMockInteraction()
      mockClient.waitForJob.mockRejectedValue(new Error('socket exploded'))

      await (service as unknown as PrivateAwaitJob).awaitJob({
        id: 'req-1',
        interaction: interaction as never,
        jobId: 'job-1',
        url: 'https://example.com/video',
      })

      expect(mockClient.cancelJob).not.toHaveBeenCalled()
      expect(interaction.followUp).toHaveBeenCalledTimes(1)
      const [{ content, flags }] = interaction.followUp.mock.calls[0] as [
        { content: string; flags: number[] },
      ]
      expect(flags).toEqual([64])
      expect(content).toContain('lost track of the job')
    })

    it('does not throw when the ephemeral follow-up fails', async () => {
      const interaction = createMockInteraction()
      interaction.followUp.mockRejectedValue(new Error('Unknown interaction'))
      mockClient.waitForJob.mockResolvedValue({
        id: 'job-1',
        status: DownloadJobStatus.Failed,
        error: 'ERROR: Video unavailable',
        media: {
          type: DownloadType.Video,
          sourceUrl: 'https://example.com/video',
        },
      })

      await expect(
        (service as unknown as PrivateAwaitJob).awaitJob({
          id: 'req-1',
          interaction: interaction as never,
          jobId: 'job-1',
          url: 'https://example.com/video',
        }),
      ).resolves.toBeUndefined()
    })
  })

  describe('download', () => {
    function createValidDto() {
      return {
        url: 'https://example.com/video',
        start: null,
        end: null,
        description: null,
        author: null,
      }
    }

    function stubCreatedJob() {
      mockDiscordScopedClient.createJob.mockResolvedValue({
        id: 'job-1',
        media: {
          type: DownloadType.Video,
          sourceUrl: 'https://example.com/video',
        },
      })
      // Never resolves - we only care about how it was called.
      mockClient.waitForJob.mockImplementation(() => new Promise(() => {}))
    }

    it('passes waitForJob an AbortSignal and the created job id', async () => {
      const interaction = createMockInteraction()
      stubCreatedJob()

      await service.download([interaction] as never, createValidDto() as never)

      expect(mockClient.waitForJob).toHaveBeenCalledTimes(1)
      const [jobId, options] = mockClient.waitForJob.mock.calls[0] as [
        string,
        { signal: AbortSignal },
      ]
      expect(jobId).toBe('job-1')
      expect(options.signal).toBeInstanceOf(AbortSignal)
    })

    it('creates the job through a client carrying the discord identity', async () => {
      const interaction = createMockInteraction({ globalName: 'Test Er' })
      stubCreatedJob()

      await service.download([interaction] as never, createValidDto() as never)

      expect(mockClient.withDiscordIdentity).toHaveBeenCalledTimes(1)
      expect(mockClient.withDiscordIdentity).toHaveBeenCalledWith({
        discordUserId: USER_ID,
        discordUsername: 'tester',
        displayName: 'Test Er',
      })

      // The job is created on the derived client, never on the shared one.
      expect(mockDiscordScopedClient.createJob).toHaveBeenCalledTimes(1)
      expect(mockDiscordScopedClient.createJob).toHaveBeenCalledWith({
        url: 'https://example.com/video',
      })
      expect(mockClient.createJob).not.toHaveBeenCalled()
    })

    it('waits on the plain client, not the identity-scoped one', async () => {
      const interaction = createMockInteraction()
      stubCreatedJob()

      await service.download([interaction] as never, createValidDto() as never)

      // A wait attributes nothing, so it stays off the identity-scoped client.
      expect(mockClient.waitForJob).toHaveBeenCalledTimes(1)
      expect(mockDiscordScopedClient).not.toHaveProperty('waitForJob')
    })

    it('sends no display name when the user has no globalName', async () => {
      const interaction = createMockInteraction({ globalName: null })
      stubCreatedJob()

      await service.download([interaction] as never, createValidDto() as never)

      expect(mockClient.withDiscordIdentity).toHaveBeenCalledWith({
        discordUserId: USER_ID,
        discordUsername: 'tester',
        // `undefined`, not `null`: the client only adds the display-name header
        // when one was actually supplied.
        displayName: undefined,
      })
    })
  })
})
