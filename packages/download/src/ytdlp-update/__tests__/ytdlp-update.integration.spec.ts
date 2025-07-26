import { Test, TestingModule } from '@nestjs/testing'
import axios from 'axios'
import { spawn } from 'child_process'
import { existsSync } from 'fs'
import { chmod, pathExists, remove, stat, writeFile } from 'fs-extra'

import { DownloadStateService } from 'src/download/download-state.service'
import { YtdlpUpdateService } from 'src/ytdlp-update/ytdlp-update.service'

// Mock axios for integration tests
jest.mock('axios')

// Only run integration tests in Docker environment
const isDockerEnv =
  process.env.NODE_ENV === 'test' && existsSync('/usr/bin/yt-dlp')

const describeIntegration = isDockerEnv ? describe : describe.skip

describeIntegration('YtdlpUpdateService Integration Tests', () => {
  let service: YtdlpUpdateService
  let downloadStateService: DownloadStateService
  const mockAxios = axios as jest.Mocked<typeof axios>

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

    // Reset file system state
    await resetFileSystem()

    // Clear axios mocks
    jest.clearAllMocks()
  })

  afterEach(async () => {
    await resetFileSystem()
  })

  describe('getCurrentVersion', () => {
    it('should execute real yt-dlp binary and get version', async () => {
      const getCurrentVersion = (
        service as unknown as { getCurrentVersion: () => Promise<string> }
      ).getCurrentVersion.bind(service)
      const version = await getCurrentVersion()

      expect(typeof version).toBe('string')
      expect(version.length).toBeGreaterThan(0)
    })
  })

  describe('file operations', () => {
    it('should backup, install, and rollback binary files', async () => {
      const backupMethod = (
        service as unknown as { backupCurrentBinary: () => Promise<void> }
      ).backupCurrentBinary.bind(service)
      const installMethod = (
        service as unknown as { installNewBinary: () => Promise<void> }
      ).installNewBinary.bind(service)
      const rollbackMethod = (
        service as unknown as { rollback: () => Promise<void> }
      ).rollback.bind(service)

      // Create a test binary with proper permissions
      await writeFile('/tmp/yt-dlp-new', '#!/bin/sh\necho "test-version"')
      await chmod('/tmp/yt-dlp-new', 0o755)

      // Verify the file was created and is executable before proceeding
      const stats = await stat('/tmp/yt-dlp-new')
      expect(stats.mode & 0o111).toBeTruthy() // Check if any execute bit is set

      // Test backup
      await backupMethod()
      expect(await pathExists('/tmp/yt-dlp-backup')).toBe(true)

      // Test install
      await installMethod()

      // Verify installation worked
      const testNewBinary = () => {
        return new Promise<string>((resolve, reject) => {
          const proc = spawn('/usr/bin/yt-dlp')
          let output = ''

          proc.stdout.on('data', chunk => {
            output += chunk.toString()
          })

          proc.on('error', reject)
          proc.on('close', code => {
            if (code === 0) {
              resolve(output.trim())
            } else {
              reject(new Error(`Exit code: ${code}`))
            }
          })
        })
      }

      const newVersion = await testNewBinary()
      expect(newVersion).toBe('test-version')

      // Test rollback
      await rollbackMethod()
      const rolledBackVersion = await testNewBinary()
      expect(rolledBackVersion).toBe('2024.01.10')
    })
  })

  describe('binary verification', () => {
    it('should verify binary can execute', async () => {
      // Create a valid test binary
      await writeFile('/tmp/yt-dlp-new', '#!/bin/sh\necho "verification-test"')
      await chmod('/tmp/yt-dlp-new', 0o755)

      // Verify the file was created and is executable
      const stats = await stat('/tmp/yt-dlp-new')
      expect(stats.mode & 0o111).toBeTruthy() // Check if any execute bit is set

      const verifyMethod = (
        service as unknown as { verifyNewBinary: () => Promise<void> }
      ).verifyNewBinary.bind(service)
      await expect(verifyMethod()).resolves.not.toThrow()
    })

    it('should reject invalid binary', async () => {
      // Create an invalid binary (not executable)
      await writeFile('/tmp/yt-dlp-new', 'invalid content')
      // Don't set executable permissions

      const verifyMethod = (
        service as unknown as { verifyNewBinary: () => Promise<void> }
      ).verifyNewBinary.bind(service)
      await expect(verifyMethod()).rejects.toThrow()
    })
  })

  describe('update status tracking', () => {
    it('should track update status correctly', () => {
      const initialStatus = service.getUpdateStatus()

      expect(initialStatus).toEqual({
        isUpdating: false,
        lastCheck: null,
        lastAttempt: null,
        retryCount: 0,
      })
    })
  })

  describe('download state integration', () => {
    it('should respect active downloads when checking for updates', async () => {
      // Add active download
      downloadStateService.inProgressJobs.add('test-download')

      // Mock GitHub API response to avoid external network calls
      mockAxios.get.mockResolvedValue({
        data: {
          tag_name: '2024.2.1',
          name: 'Release 2024.2.1',
          published_at: '2024-02-01T12:00:00Z',
          assets: [],
        },
      })

      const result = await service.checkForUpdates()

      // Should detect that downloads are in progress
      expect(result.canUpdate).toBe(false)
      expect(result.reason).toBe('Downloads in progress')
    })

    it('should allow updates when no downloads are active', async () => {
      // Ensure no active downloads
      downloadStateService.inProgressJobs.clear()

      // Mock GitHub API response to avoid external network calls
      // Use a version newer than the current Docker version (2024.01.10 -> 2024.1.10 normalized)
      mockAxios.get.mockResolvedValue({
        data: {
          tag_name: '2024.2.1',
          name: 'Release 2024.2.1',
          published_at: '2024-02-01T12:00:00Z',
          assets: [],
        },
      })

      const result = await service.checkForUpdates()

      // Should detect update is available and can proceed
      expect(result.updateAvailable).toBe(true)
      expect(result.canUpdate).toBe(true)
    })
  })

  async function resetFileSystem(): Promise<void> {
    // Reset to original state
    await writeFile('/usr/bin/yt-dlp', '#!/bin/sh\necho "2024.01.10"')
    await chmod('/usr/bin/yt-dlp', 0o755)

    // Clean up temporary files
    const tempFiles = ['/tmp/yt-dlp-new', '/tmp/yt-dlp-backup']
    for (const file of tempFiles) {
      if (await pathExists(file)) {
        await remove(file)
      }
    }
  }
})

// Helper to check if we're in Docker environment
if (!isDockerEnv) {
  console.log(
    'Integration tests skipped - not running in Docker test environment',
  )
}
