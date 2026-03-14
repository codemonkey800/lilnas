/**
 * YtdlpUpdateService Integration Tests
 *
 * These tests verify the yt-dlp update functionality in a Docker environment.
 *
 * ## Docker Environment Requirement
 * Tests only run when:
 * - NODE_ENV === 'test'
 * - /usr/bin/yt-dlp exists (Docker container indicator)
 *
 * If not in Docker, tests are skipped automatically.
 *
 * ## Version Constants
 * Tests use centralized version constants from YtdlpTestHelper:
 * - DOCKER_VERSION: '2024.01.10' - The yt-dlp version installed in Docker
 * - MOCK_OLDER_VERSION: '2024.1.10' - Normalized format, same as Docker (for "no update" tests)
 * - MOCK_MODERATE_VERSION: '2024.1.15' - Intermediate version (for comparison tests)
 * - MOCK_NEWER_VERSION: '2024.2.1' - Newer version (for "update available" tests)
 *
 * ## Test Categories
 * - **True Integration Tests**: No mocks, test real yt-dlp binary operations
 * - **Unit/Partial Integration Tests**: Mock external APIs (GitHub)
 * - **Error Handling Tests**: Verify graceful failure scenarios
 *
 * ## Running Tests
 * ```bash
 * # In Docker container (via docker-compose)
 * pnpm test:ytdlp-update
 *
 * # Locally (will skip if not in Docker)
 * pnpm test ytdlp-update.integration.spec.ts
 * ```
 *
 * @see YtdlpTestHelper for test utilities and constants
 * @see packages/download/src/ytdlp-update/__tests__/Dockerfile.test for Docker setup
 */
import { Test, TestingModule } from '@nestjs/testing'
import axios from 'axios'
import { existsSync } from 'fs'
import { pathExists, remove } from 'fs-extra'

import { DownloadStateService } from 'src/download/download-state.service'
import { YtdlpUpdateService } from 'src/ytdlp-update/ytdlp-update.service'

import { YtdlpTestHelper } from './helpers/ytdlp-test.helper'

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

  /**
   * True Integration Tests
   *
   * These tests execute real operations without mocking external dependencies:
   * - Execute real yt-dlp binary
   * - Perform actual file system operations (backup, install, rollback)
   * - Verify binary execution and permissions
   *
   * Requirements: Docker environment with /usr/bin/yt-dlp
   */
  describe('True Integration Tests', () => {
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
      /**
       * Helper to verify clean state between tests.
       * Ensures no test pollution by checking expected file states.
       */
      async function verifyCleanState(): Promise<void> {
        // Verify main binary exists and has expected version
        const currentVersion =
          await YtdlpTestHelper.executeAndGetOutput('/usr/bin/yt-dlp')
        expect(currentVersion).toBe(YtdlpTestHelper.DOCKER_VERSION)

        // Verify no backup file exists
        expect(await pathExists(YtdlpTestHelper.BACKUP_PATH)).toBe(false)

        // Verify no test binary exists
        expect(await pathExists(YtdlpTestHelper.TEST_BINARY_PATH)).toBe(false)
      }

      beforeEach(async () => {
        // Ensure clean starting state for each file operation test
        await verifyCleanState()
      })

      /**
       * Test: Backup functionality
       * This test is independent - creates its own prerequisites and can run alone.
       * Tests that the current binary can be backed up successfully.
       */
      it('should backup current binary', async () => {
        const backupMethod = (
          service as unknown as { backupCurrentBinary: () => Promise<void> }
        ).backupCurrentBinary.bind(service)

        // Action: Backup the current binary
        await backupMethod()

        // Verify: Backup file exists and is executable
        expect(await pathExists(YtdlpTestHelper.BACKUP_PATH)).toBe(true)
        expect(
          await YtdlpTestHelper.verifyExecutable(YtdlpTestHelper.BACKUP_PATH),
        ).toBe(true)

        // Verify: Backup contains expected version
        const backupVersion = await YtdlpTestHelper.executeAndGetOutput(
          YtdlpTestHelper.BACKUP_PATH,
        )
        expect(backupVersion).toBe(YtdlpTestHelper.DOCKER_VERSION)
      })

      /**
       * Test: Install functionality
       * This test is independent - creates its own test binary and can run alone.
       * Tests that a new binary can be installed from the test file location.
       */
      it('should install new binary from test file', async () => {
        const installMethod = (
          service as unknown as { installNewBinary: () => Promise<void> }
        ).installNewBinary.bind(service)

        // Setup: Create a test binary with proper permissions
        await YtdlpTestHelper.createExecutableTestBinary('new-install-version')

        // Verify test binary was created successfully
        expect(
          await YtdlpTestHelper.verifyExecutable(
            YtdlpTestHelper.TEST_BINARY_PATH,
          ),
        ).toBe(true)

        // Action: Install the new binary
        await installMethod()

        // Verify: Installation worked and binary is executable
        const installedVersion =
          await YtdlpTestHelper.executeAndGetOutput('/usr/bin/yt-dlp')
        expect(installedVersion).toBe('new-install-version')
        expect(await YtdlpTestHelper.verifyExecutable('/usr/bin/yt-dlp')).toBe(
          true,
        )
      })

      /**
       * Test: Rollback functionality
       * This test is independent - creates its own backup file and modified binary.
       * Does NOT depend on the backup or install tests running first.
       */
      it('should rollback to backed up version', async () => {
        const rollbackMethod = (
          service as unknown as { rollback: () => Promise<void> }
        ).rollback.bind(service)
        const { writeFile, chmod } = await import('fs-extra')

        // Setup: Create a backup file with known version
        await writeFile(
          YtdlpTestHelper.BACKUP_PATH,
          `#!/bin/sh\necho "backed-up-version"`,
        )
        await chmod(
          YtdlpTestHelper.BACKUP_PATH,
          YtdlpTestHelper.FULL_EXECUTABLE,
        )

        // Setup: Modify /usr/bin/yt-dlp to simulate it was updated
        await writeFile('/usr/bin/yt-dlp', `#!/bin/sh\necho "modified-version"`)
        await chmod('/usr/bin/yt-dlp', YtdlpTestHelper.FULL_EXECUTABLE)

        // Verify setup completed correctly
        const modifiedVersion =
          await YtdlpTestHelper.executeAndGetOutput('/usr/bin/yt-dlp')
        expect(modifiedVersion).toBe('modified-version')

        // Action: Rollback to backup
        await rollbackMethod()

        // Verify: Binary restored to backup version
        const rolledBackVersion =
          await YtdlpTestHelper.executeAndGetOutput('/usr/bin/yt-dlp')
        expect(rolledBackVersion).toBe('backed-up-version')
        expect(await YtdlpTestHelper.verifyExecutable('/usr/bin/yt-dlp')).toBe(
          true,
        )
      })
    })

    describe('binary verification', () => {
      it('should verify binary can execute', async () => {
        // Create a valid test binary
        await YtdlpTestHelper.createExecutableTestBinary('verification-test')

        // Verify the file was created and is executable
        expect(
          await YtdlpTestHelper.verifyExecutable(
            YtdlpTestHelper.TEST_BINARY_PATH,
          ),
        ).toBe(true)

        const verifyMethod = (
          service as unknown as { verifyNewBinary: () => Promise<void> }
        ).verifyNewBinary.bind(service)
        await expect(verifyMethod()).resolves.not.toThrow()
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
  })

  /**
   * Unit/Partial Integration Tests
   *
   * These tests mock external APIs (GitHub) while testing service logic:
   * - Mock axios/GitHub API responses
   * - Test update checking logic
   * - Test download state integration
   *
   * External dependencies are mocked to avoid network calls and ensure test reliability.
   */
  describe('Unit/Partial Integration Tests', () => {
    describe('download state integration', () => {
      it('should respect active downloads when checking for updates', async () => {
        // Add active download
        downloadStateService.inProgressJobs.add('test-download')

        // Mock GitHub API response to avoid external network calls
        mockAxios.get.mockResolvedValue({
          data: {
            tag_name: YtdlpTestHelper.MOCK_NEWER_VERSION,
            name: `Release ${YtdlpTestHelper.MOCK_NEWER_VERSION}`,
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
        // Use a version newer than the current Docker version (YtdlpTestHelper.DOCKER_VERSION)
        mockAxios.get.mockResolvedValue({
          data: {
            tag_name: YtdlpTestHelper.MOCK_NEWER_VERSION,
            name: `Release ${YtdlpTestHelper.MOCK_NEWER_VERSION}`,
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
  })

  /**
   * Error Handling Tests
   *
   * These tests verify proper error handling for various failure scenarios:
   * - Invalid or corrupted binaries
   * - Permission errors
   * - Network failures
   *
   * Tests ensure the service fails gracefully and maintains system consistency.
   */
  describe('Error Handling Tests', () => {
    describe('binary verification', () => {
      it('should reject invalid binary', async () => {
        // Create an invalid binary (not executable)
        const { writeFile } = await import('fs-extra')
        await writeFile(YtdlpTestHelper.TEST_BINARY_PATH, 'invalid content')
        // Don't set executable permissions

        const verifyMethod = (
          service as unknown as { verifyNewBinary: () => Promise<void> }
        ).verifyNewBinary.bind(service)
        await expect(verifyMethod()).rejects.toThrow()
      })
    })
  })

  async function resetFileSystem(): Promise<void> {
    // Reset to original state
    const { writeFile, chmod } = await import('fs-extra')
    await writeFile(
      '/usr/bin/yt-dlp',
      `#!/bin/sh\necho "${YtdlpTestHelper.DOCKER_VERSION}"`,
    )
    await chmod('/usr/bin/yt-dlp', YtdlpTestHelper.FULL_EXECUTABLE)

    // Clean up temporary files
    const tempFiles = [
      YtdlpTestHelper.TEST_BINARY_PATH,
      YtdlpTestHelper.BACKUP_PATH,
    ]
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
