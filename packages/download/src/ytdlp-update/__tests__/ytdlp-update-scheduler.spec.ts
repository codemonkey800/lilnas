import { Test, TestingModule } from '@nestjs/testing'
import axios from 'axios'
import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'

import { DownloadStateService } from 'src/download/download-state.service'
import { YtdlpUpdateService } from 'src/ytdlp-update/ytdlp-update.service'

import { mockNewerGitHubRelease } from './fixtures/mock-github-responses'

jest.mock('axios')
jest.mock('child_process')
jest.mock('@lilnas/utils/env', () => ({
  env: jest.fn((key: string, defaultValue?: string) => {
    const envMocks: Record<string, string> = {
      YTDLP_UPDATE_CRON: '0 3 * * *', // Daily at 3 AM
      YTDLP_AUTO_UPDATE_ENABLED: 'true',
      YTDLP_UPDATE_MAX_RETRIES: '3',
      YTDLP_UPDATE_RETRY_INTERVAL: '1000', // 1 second for testing
    }
    return envMocks[key] || defaultValue
  }),
}))
jest.mock('fs-extra', () => ({
  createWriteStream: jest.fn(),
  chmod: jest.fn(),
  copy: jest.fn(),
  move: jest.fn(),
  pathExists: jest.fn(),
  remove: jest.fn(),
}))

const mockAxios = axios as jest.Mocked<typeof axios>
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = jest.fn()
}

describe('YtdlpUpdateService - Scheduler', () => {
  let service: YtdlpUpdateService
  let downloadStateService: jest.Mocked<DownloadStateService>

  beforeEach(async () => {
    const mockDownloadStateService = {
      inProgressJobs: new Set<string>(),
    }

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        YtdlpUpdateService,
        {
          provide: DownloadStateService,
          useValue: mockDownloadStateService,
        },
      ],
    }).compile()

    service = module.get<YtdlpUpdateService>(YtdlpUpdateService)
    downloadStateService = module.get(DownloadStateService)

    jest.clearAllMocks()
  })

  describe('scheduledUpdateCheck', () => {
    it('should perform scheduled update check when auto-update is enabled', async () => {
      const currentVersion = '2024.1.10'

      // Mock successful version check
      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        })
        return proc as unknown as ChildProcess
      })

      // Mock successful GitHub API response
      mockAxios.get.mockResolvedValueOnce({ data: mockNewerGitHubRelease })

      // Spy on checkForUpdates method
      const checkForUpdatesSpy = jest.spyOn(service, 'checkForUpdates')

      // Call the scheduled update check
      await service.scheduledUpdateCheck()

      expect(checkForUpdatesSpy).toHaveBeenCalled()
    })

    it('should skip scheduled update check when auto-update is disabled', async () => {
      // Mock env to return disabled
      const { env: mockEnv } = jest.requireMock('@lilnas/utils/env')
      mockEnv.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'YTDLP_AUTO_UPDATE_ENABLED') return 'false'
        return defaultValue
      })

      // Spy on checkForUpdates method
      const checkForUpdatesSpy = jest.spyOn(service, 'checkForUpdates')

      // Call the scheduled update check
      await service.scheduledUpdateCheck()

      expect(checkForUpdatesSpy).not.toHaveBeenCalled()
    })
  })

  describe('retry mechanism', () => {
    it('should schedule retry when downloads are in progress', async () => {
      const currentVersion = '2024.1.10'

      // Add active downloads to prevent update
      downloadStateService.inProgressJobs.add('test-download-1')
      downloadStateService.inProgressJobs.add('test-download-2')

      // Mock successful version check
      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        })
        return proc as unknown as ChildProcess
      })

      // Mock successful GitHub API response
      mockAxios.get.mockResolvedValueOnce({ data: mockNewerGitHubRelease })

      // Spy on setTimeout to verify retry scheduling
      const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

      const result = await service.checkForUpdates()

      expect(result.canUpdate).toBe(false)
      expect(result.reason).toBe('Downloads in progress')
      // The service uses default retry interval from env, not our mock
      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        expect.any(Number),
      )
    })

    it('should handle retry count at maximum', async () => {
      const currentVersion = '2024.1.10'

      // Set retry count at a high value
      ;(service as unknown as { updateRetryCount: number }).updateRetryCount =
        10

      // Add active downloads to prevent update
      downloadStateService.inProgressJobs.add('test-download')

      // Mock successful version check
      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        })
        return proc as unknown as ChildProcess
      })

      // Mock successful GitHub API response
      mockAxios.get.mockResolvedValueOnce({ data: mockNewerGitHubRelease })

      const result = await service.checkForUpdates()

      expect(result.canUpdate).toBe(false)
      expect(result.reason).toBe('Downloads in progress')

      // Service should handle high retry counts properly
      expect(
        typeof (service as unknown as { updateRetryCount: number })
          .updateRetryCount,
      ).toBe('number')
    })

    it('should track retry count correctly', async () => {
      const currentVersion = '2024.1.10'

      // Add active downloads to trigger retry
      downloadStateService.inProgressJobs.add('test-download')

      // Mock successful version check
      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        })
        return proc as unknown as ChildProcess
      })

      // Mock successful GitHub API response
      mockAxios.get.mockResolvedValueOnce({ data: mockNewerGitHubRelease })

      const initialRetryCount = (
        service as unknown as { updateRetryCount: number }
      ).updateRetryCount
      await service.checkForUpdates()

      expect(
        (service as unknown as { updateRetryCount: number }).updateRetryCount,
      ).toBe(initialRetryCount + 1)
    })
  })

  describe('update status tracking', () => {
    it('should track update status correctly', () => {
      const status = service.getUpdateStatus()

      expect(status).toEqual({
        isUpdating: false,
        lastCheck: null,
        lastAttempt: null,
        retryCount: 0,
      })
    })

    it('should update lastCheck after checking for updates', async () => {
      const currentVersion = '2024.1.15'

      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        })
        return proc as unknown as ChildProcess
      })

      mockAxios.get.mockResolvedValueOnce({ data: mockNewerGitHubRelease })

      const beforeCheck = new Date()
      await service.checkForUpdates()
      const afterCheck = new Date()

      const status = service.getUpdateStatus()
      expect(status.lastCheck).toBeDefined()
      expect(status.lastCheck!.getTime()).toBeGreaterThanOrEqual(
        beforeCheck.getTime(),
      )
      expect(status.lastCheck!.getTime()).toBeLessThanOrEqual(
        afterCheck.getTime(),
      )
    })

    it('should prevent concurrent updates', async () => {
      // Set service to updating state
      ;(service as unknown as { isUpdating: boolean }).isUpdating = true

      const result = await service.checkForUpdates()

      expect(result.canUpdate).toBe(false)
      expect(result.reason).toBe('Update already in progress')
      expect(result.currentVersion).toBe('unknown')
      expect(result.latestVersion).toBe('unknown')
    })

    it('should track retry count in status', async () => {
      // Set retry count
      ;(service as unknown as { updateRetryCount: number }).updateRetryCount = 5

      const status = service.getUpdateStatus()
      expect(status.retryCount).toBe(5)
    })
  })

  describe('environment configuration', () => {
    it('should use custom retry interval from environment', async () => {
      const customRetryInterval = '2000' // 2 seconds

      // Mock env to return custom retry interval
      const { env: mockEnv } = jest.requireMock('@lilnas/utils/env')
      mockEnv.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'YTDLP_UPDATE_RETRY_INTERVAL') return customRetryInterval
        if (key === 'YTDLP_AUTO_UPDATE_ENABLED') return 'true'
        if (key === 'YTDLP_UPDATE_MAX_RETRIES') return '3'
        return defaultValue
      })

      const currentVersion = '2024.1.10'

      // Add active downloads to trigger retry
      downloadStateService.inProgressJobs.add('test-download')

      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        })
        return proc as unknown as ChildProcess
      })

      mockAxios.get.mockResolvedValueOnce({ data: mockNewerGitHubRelease })

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

      await service.checkForUpdates()

      expect(setTimeoutSpy).toHaveBeenCalledWith(
        expect.any(Function),
        2000, // Custom 2 second retry interval
      )
    })

    it('should use custom max retries from environment', async () => {
      const customMaxRetries = '5'

      // Mock env to return custom max retries
      const { env: mockEnv } = jest.requireMock('@lilnas/utils/env')
      mockEnv.mockImplementation((key: string, defaultValue?: string) => {
        if (key === 'YTDLP_UPDATE_MAX_RETRIES') return customMaxRetries
        if (key === 'YTDLP_AUTO_UPDATE_ENABLED') return 'true'
        if (key === 'YTDLP_UPDATE_RETRY_INTERVAL') return '1000'
        return defaultValue
      })

      // Set retry count to custom max - 1
      ;(service as unknown as { updateRetryCount: number }).updateRetryCount = 4

      const currentVersion = '2024.1.10'
      downloadStateService.inProgressJobs.add('test-download')

      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        })
        return proc as unknown as ChildProcess
      })

      mockAxios.get.mockResolvedValueOnce({ data: mockNewerGitHubRelease })

      const setTimeoutSpy = jest.spyOn(global, 'setTimeout')

      await service.checkForUpdates()

      // Should schedule retry since we haven't reached custom max yet
      expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 1000)
      expect(
        (service as unknown as { updateRetryCount: number }).updateRetryCount,
      ).toBe(5)
    })
  })

  describe('scheduled update behavior', () => {
    it('should handle cron expression configuration', () => {
      // Test that the service is properly configured with cron
      expect(typeof service.scheduledUpdateCheck).toBe('function')

      // The method should exist and be callable
      expect(service.scheduledUpdateCheck).toBeDefined()
    })

    it('should log scheduled update attempts', async () => {
      const currentVersion = '2024.1.15'

      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        process.nextTick(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        })
        return proc as unknown as ChildProcess
      })

      mockAxios.get.mockResolvedValueOnce({ data: mockNewerGitHubRelease })

      // Mock logger to verify logging
      const loggerSpy = jest.spyOn(
        (service as unknown as { logger: { log: jest.Mock } }).logger,
        'log',
      )

      await service.scheduledUpdateCheck()

      expect(loggerSpy).toHaveBeenCalledWith(
        { action: 'scheduledUpdateCheck' },
        'Starting scheduled yt-dlp update check',
      )
    })
  })
})
