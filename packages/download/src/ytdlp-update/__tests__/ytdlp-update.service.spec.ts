import { Test, TestingModule } from '@nestjs/testing'
import axios from 'axios'
import { ChildProcess, spawn } from 'child_process'
import { EventEmitter } from 'events'
import fs from 'fs-extra'

import { DownloadStateService } from 'src/download/download-state.service'
import { YtdlpUpdateService } from 'src/ytdlp-update/ytdlp-update.service'

import {
  mockGitHubRelease,
  mockNewerGitHubRelease,
} from './fixtures/mock-github-responses'

jest.mock('axios')
jest.mock('child_process')
jest.mock('fs-extra', () => ({
  createWriteStream: jest.fn(),
  chmod: jest.fn(),
  copy: jest.fn(),
  move: jest.fn(),
  pathExists: jest.fn(),
  remove: jest.fn(),
}))
jest.mock('@lilnas/utils/env')

const mockAxios = axios as jest.Mocked<typeof axios>
const mockSpawn = spawn as jest.MockedFunction<typeof spawn>
const mockFs = fs as jest.Mocked<typeof fs>

class MockChildProcess extends EventEmitter {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  kill = jest.fn()
}

describe('YtdlpUpdateService', () => {
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

  describe('checkForUpdates', () => {
    it('should return no update needed when current version is latest', async () => {
      const currentVersion = '2024.1.15'

      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        }, 10)
        return proc as unknown as ChildProcess
      })

      mockAxios.get.mockResolvedValueOnce({ data: mockGitHubRelease })

      const result = await service.checkForUpdates()

      expect(result).toEqual({
        currentVersion,
        latestVersion: '2024.1.15',
        updateAvailable: false,
        canUpdate: false,
        reason: 'Already running latest version',
      })
    })

    it('should detect update available and allow update when no downloads active', async () => {
      const currentVersion = '2024.1.10'

      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        }, 10)
        return proc as unknown as ChildProcess
      })

      mockAxios.get.mockResolvedValueOnce({ data: mockNewerGitHubRelease })

      // Mock the download and installation process
      mockAxios.get.mockResolvedValueOnce({
        data: {
          pipe: jest.fn(),
        },
      })

      mockFs.createWriteStream.mockReturnValue({
        on: jest.fn((event, callback) => {
          if (event === 'finish') setTimeout(callback, 10)
        }),
      } as never)

      mockFs.chmod.mockResolvedValue(undefined as never)
      mockFs.copy.mockResolvedValue(undefined as never)
      mockFs.move.mockResolvedValue(undefined as never)
      mockFs.pathExists.mockResolvedValue(true as never)
      mockFs.remove.mockResolvedValue(undefined as never)

      const result = await service.checkForUpdates()

      expect(result).toEqual({
        currentVersion,
        latestVersion: '2024.2.1',
        updateAvailable: true,
        canUpdate: true,
      })
    })

    it('should not allow update when downloads are in progress', async () => {
      const currentVersion = '2024.1.10'

      downloadStateService.inProgressJobs.add('test-job-1')
      downloadStateService.inProgressJobs.add('test-job-2')

      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        }, 10)
        return proc as unknown as ChildProcess
      })

      mockAxios.get.mockResolvedValueOnce({ data: mockNewerGitHubRelease })

      const result = await service.checkForUpdates()

      expect(result).toEqual({
        currentVersion,
        latestVersion: '2024.2.1',
        updateAvailable: true,
        canUpdate: false,
        reason: 'Downloads in progress',
      })
    })

    it('should handle GitHub API errors gracefully', async () => {
      const currentVersion = '2024.1.15'

      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        }, 10)
        return proc as unknown as ChildProcess
      })

      mockAxios.get.mockRejectedValueOnce(new Error('API rate limit exceeded'))

      const result = await service.checkForUpdates()

      expect(result).toEqual({
        currentVersion: 'unknown',
        latestVersion: 'unknown',
        updateAvailable: false,
        canUpdate: false,
        reason:
          'Error: Failed to fetch latest release: API rate limit exceeded',
      })
    })

    it('should handle yt-dlp version check errors', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        setTimeout(() => {
          proc.emit('error', new Error('Command not found'))
        }, 10)
        return proc as unknown as ChildProcess
      })

      const result = await service.checkForUpdates()

      expect(result).toEqual({
        currentVersion: 'unknown',
        latestVersion: 'unknown',
        updateAvailable: false,
        canUpdate: false,
        reason: 'Error: Command not found',
      })
    })

    it('should handle concurrent update attempts', async () => {
      // Mock the internal isUpdating flag by calling performUpdate directly
      // First, set up the service to have an update available
      const currentVersion = '2024.1.10'

      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from(currentVersion))
          proc.emit('close', 0)
        }, 10)
        return proc as unknown as ChildProcess
      })

      mockAxios.get.mockResolvedValue({ data: mockNewerGitHubRelease })

      // Simulate the service being in updating state by setting isUpdating to true
      ;(service as unknown as { isUpdating: boolean }).isUpdating = true

      const result = await service.checkForUpdates()

      expect(result.reason).toBe('Update already in progress')
      expect(result.canUpdate).toBe(false)
      expect(result.currentVersion).toBe('unknown')
      expect(result.latestVersion).toBe('unknown')
    })
  })

  describe('getCurrentVersion', () => {
    it('should return current version from yt-dlp --version', async () => {
      const expectedVersion = '2024.1.15'

      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from(expectedVersion))
          proc.emit('close', 0)
        }, 10)
        return proc as unknown as ChildProcess
      })

      const currentVersionMethod = (
        service as unknown as { getCurrentVersion: () => Promise<string> }
      ).getCurrentVersion.bind(service)
      const version = await currentVersionMethod()

      expect(version).toBe(expectedVersion)
      expect(mockSpawn).toHaveBeenCalledWith('/usr/bin/yt-dlp', ['--version'])
    })

    it('should handle yt-dlp command errors', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        setTimeout(() => {
          proc.emit('error', new Error('Command not found'))
        }, 10)
        return proc as unknown as ChildProcess
      })

      const currentVersionMethod = (
        service as unknown as { getCurrentVersion: () => Promise<string> }
      ).getCurrentVersion.bind(service)

      await expect(currentVersionMethod()).rejects.toThrow('Command not found')
    })

    it('should handle non-zero exit codes', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        setTimeout(() => {
          proc.emit('close', 1)
        }, 10)
        return proc as unknown as ChildProcess
      })

      const currentVersionMethod = (
        service as unknown as { getCurrentVersion: () => Promise<string> }
      ).getCurrentVersion.bind(service)

      await expect(currentVersionMethod()).rejects.toThrow(
        'yt-dlp version check failed with code 1',
      )
    })
  })

  describe('getLatestRelease', () => {
    it('should fetch latest release from GitHub API', async () => {
      mockAxios.get.mockResolvedValueOnce({ data: mockGitHubRelease })

      const getLatestReleaseMethod = (
        service as unknown as { getLatestRelease: () => Promise<unknown> }
      ).getLatestRelease.bind(service)
      const release = await getLatestReleaseMethod()

      expect(release).toEqual(mockGitHubRelease)
      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest',
        {
          timeout: 10000,
          headers: {
            'User-Agent': 'lilnas-download-service',
          },
        },
      )
    })

    it('should handle network errors', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('Network error'))

      const getLatestReleaseMethod = (
        service as unknown as { getLatestRelease: () => Promise<unknown> }
      ).getLatestRelease.bind(service)

      await expect(getLatestReleaseMethod()).rejects.toThrow(
        'Failed to fetch latest release: Network error',
      )
    })
  })

  describe('downloadNewBinary', () => {
    it('should download and make binary executable', async () => {
      const mockStream = { pipe: jest.fn() }
      const mockWriter = {
        on: jest.fn((event, callback) => {
          if (event === 'finish') setTimeout(callback, 10)
        }),
      }

      mockAxios.get.mockResolvedValueOnce({ data: mockStream })
      mockFs.createWriteStream.mockReturnValueOnce(mockWriter as never)
      mockFs.chmod.mockResolvedValueOnce(undefined as never)

      const downloadMethod = (
        service as unknown as { downloadNewBinary: () => Promise<void> }
      ).downloadNewBinary.bind(service)
      await downloadMethod()

      expect(mockAxios.get).toHaveBeenCalledWith(
        'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
        {
          responseType: 'stream',
          timeout: 30000,
        },
      )
      expect(mockFs.createWriteStream).toHaveBeenCalledWith('/tmp/yt-dlp-new')
      expect(mockFs.chmod).toHaveBeenCalledWith('/tmp/yt-dlp-new', 0o755)
    })

    it('should handle download errors', async () => {
      mockAxios.get.mockRejectedValueOnce(new Error('Download failed'))

      const downloadMethod = (
        service as unknown as { downloadNewBinary: () => Promise<void> }
      ).downloadNewBinary.bind(service)

      await expect(downloadMethod()).rejects.toThrow(
        'Failed to download new binary: Download failed',
      )
    })
  })

  describe('verifyNewBinary', () => {
    it('should verify new binary can execute --version', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        setTimeout(() => {
          proc.stdout.emit('data', Buffer.from('2024.2.1'))
          proc.emit('close', 0)
        }, 10)
        return proc as unknown as ChildProcess
      })

      const verifyMethod = (
        service as unknown as { verifyNewBinary: () => Promise<void> }
      ).verifyNewBinary.bind(service)
      await verifyMethod()

      expect(mockSpawn).toHaveBeenCalledWith('/tmp/yt-dlp-new', ['--version'])
    })

    it('should handle verification failures', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = new MockChildProcess()
        setTimeout(() => {
          proc.emit('close', 1)
        }, 10)
        return proc as unknown as ChildProcess
      })

      const verifyMethod = (
        service as unknown as { verifyNewBinary: () => Promise<void> }
      ).verifyNewBinary.bind(service)

      await expect(verifyMethod()).rejects.toThrow(
        'New binary failed verification with code 1',
      )
    })
  })

  describe('rollback', () => {
    it('should restore backup when available', async () => {
      mockFs.pathExists.mockResolvedValueOnce(true as never)
      mockFs.move.mockResolvedValueOnce(undefined as never)

      const rollbackMethod = (
        service as unknown as { rollback: () => Promise<void> }
      ).rollback.bind(service)
      await rollbackMethod()

      expect(mockFs.pathExists).toHaveBeenCalledWith('/tmp/yt-dlp-backup')
      expect(mockFs.move).toHaveBeenCalledWith(
        '/tmp/yt-dlp-backup',
        '/usr/bin/yt-dlp',
        { overwrite: true },
      )
    })

    it('should handle missing backup gracefully', async () => {
      mockFs.pathExists.mockResolvedValueOnce(false as never)

      const rollbackMethod = (
        service as unknown as { rollback: () => Promise<void> }
      ).rollback.bind(service)
      await rollbackMethod()

      expect(mockFs.pathExists).toHaveBeenCalledWith('/tmp/yt-dlp-backup')
      expect(mockFs.move).not.toHaveBeenCalled()
    })
  })

  describe('getUpdateStatus', () => {
    it('should return current update status', () => {
      const status = service.getUpdateStatus()

      expect(status).toEqual({
        isUpdating: false,
        lastCheck: null,
        lastAttempt: null,
        retryCount: 0,
      })
    })
  })
})
