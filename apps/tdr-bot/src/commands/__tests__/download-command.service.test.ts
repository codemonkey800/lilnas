import { DownloadClient } from '@lilnas/utils/download/client'
import { DownloadJobStatus } from '@lilnas/utils/download/types'
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

jest.mock('@lilnas/utils/download/client', () => ({
  DownloadClient: {
    dockerInstance: {
      cancelVideoJob: jest.fn(),
      createVideoJob: jest.fn(),
      getVideoJob: jest.fn(),
    },
  },
}))

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createMockInteraction() {
  return {
    channel: {
      isSendable: jest.fn().mockReturnValue(true),
      send: jest.fn().mockResolvedValue(undefined),
    },
    deferReply: jest.fn().mockResolvedValue(undefined),
    editReply: jest.fn().mockResolvedValue(undefined),
    followUp: jest.fn().mockResolvedValue(undefined),
    reply: jest.fn().mockResolvedValue(undefined),
    user: { id: 'user-1', username: 'tester' },
  }
}

type PrivateCheckJob = {
  checkJob: (args: {
    author?: string
    description?: string
    id: string
    interaction: ReturnType<typeof createMockInteraction>
    jobId: string
  }) => Promise<void>
}

describe('DownloadCommandService', () => {
  const mockClient = DownloadClient.dockerInstance as unknown as {
    cancelVideoJob: jest.Mock
    createVideoJob: jest.Mock
    getVideoJob: jest.Mock
  }

  let service: DownloadCommandService

  beforeEach(() => {
    process.env.DOWNLOAD_POLL_RETRIES = '50'
    process.env.DOWNLOAD_POLL_DURATION_MS = '2000'

    service = new DownloadCommandService({} as unknown as Client)
  })

  describe('checkJob', () => {
    it('sends an ephemeral notice with the error when the job failed', async () => {
      const interaction = createMockInteraction()
      mockClient.getVideoJob.mockResolvedValue({
        id: 'job-1',
        status: DownloadJobStatus.Failed,
        url: 'https://example.com/video',
        error: 'ERROR: Video unavailable',
      })

      await (service as unknown as PrivateCheckJob).checkJob({
        id: 'req-1',
        interaction: interaction as never,
        jobId: 'job-1',
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
      mockClient.getVideoJob.mockResolvedValue({
        id: 'job-1',
        status: DownloadJobStatus.Failed,
        url: 'https://example.com/video',
      })

      await (service as unknown as PrivateCheckJob).checkJob({
        id: 'req-1',
        interaction: interaction as never,
        jobId: 'job-1',
      })

      const [{ content }] = interaction.followUp.mock.calls[0] as [
        { content: string },
      ]
      expect(content).not.toContain('```')
    })

    it('sends an ephemeral notice when the job was cancelled', async () => {
      const interaction = createMockInteraction()
      mockClient.getVideoJob.mockResolvedValue({
        id: 'job-1',
        status: DownloadJobStatus.Cancelled,
        url: 'https://example.com/video',
      })

      await (service as unknown as PrivateCheckJob).checkJob({
        id: 'req-1',
        interaction: interaction as never,
        jobId: 'job-1',
      })

      expect(interaction.followUp).toHaveBeenCalledTimes(1)
      const [{ flags }] = interaction.followUp.mock.calls[0] as [
        { flags: number[] },
      ]
      expect(flags).toEqual([64])
      expect(interaction.channel.send).not.toHaveBeenCalled()
    })

    it('cancels the job and sends an ephemeral notice when polling maxes out', async () => {
      process.env.DOWNLOAD_POLL_RETRIES = '0'

      const interaction = createMockInteraction()
      mockClient.getVideoJob.mockResolvedValue({
        id: 'job-1',
        status: DownloadJobStatus.Downloading,
        url: 'https://example.com/video',
      })

      await (service as unknown as PrivateCheckJob).checkJob({
        id: 'req-1',
        interaction: interaction as never,
        jobId: 'job-1',
      })

      expect(mockClient.cancelVideoJob).toHaveBeenCalledWith('job-1')
      expect(interaction.followUp).toHaveBeenCalledTimes(1)
      const [{ flags }] = interaction.followUp.mock.calls[0] as [
        { flags: number[] },
      ]
      expect(flags).toEqual([64])
      expect(interaction.channel.send).not.toHaveBeenCalled()
    })

    it('does not throw when the ephemeral follow-up fails', async () => {
      const interaction = createMockInteraction()
      interaction.followUp.mockRejectedValue(new Error('Unknown interaction'))
      mockClient.getVideoJob.mockResolvedValue({
        id: 'job-1',
        status: DownloadJobStatus.Failed,
        url: 'https://example.com/video',
        error: 'ERROR: Video unavailable',
      })

      await expect(
        (service as unknown as PrivateCheckJob).checkJob({
          id: 'req-1',
          interaction: interaction as never,
          jobId: 'job-1',
        }),
      ).resolves.toBeUndefined()
    })
  })
})
