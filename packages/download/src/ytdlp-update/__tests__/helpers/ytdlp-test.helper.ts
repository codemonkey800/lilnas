import { spawn } from 'child_process'
import { chmod, stat, writeFile } from 'fs-extra'

/**
 * YtdlpTestHelper
 *
 * Test helper utilities for yt-dlp update integration tests.
 * Provides centralized constants and methods for creating, verifying,
 * and executing test binaries in the Docker test environment.
 */
export class YtdlpTestHelper {
  /**
   * The version of yt-dlp installed in the Docker test environment
   * @see packages/download/src/ytdlp-update/__tests__/Dockerfile.test
   */
  static readonly DOCKER_VERSION = '2024.01.10'

  /**
   * Mock version representing an older release (same as Docker version, normalized format)
   * Used in tests to verify "no update available" scenarios
   */
  static readonly MOCK_OLDER_VERSION = '2024.1.10'

  /**
   * Mock version representing a moderate update from Docker version
   * Used in tests for intermediate version comparison scenarios
   */
  static readonly MOCK_MODERATE_VERSION = '2024.1.15'

  /**
   * Mock version representing a newer release than Docker version
   * Used in tests to verify "update available" scenarios
   */
  static readonly MOCK_NEWER_VERSION = '2024.2.1'

  /**
   * Path where test binaries are created for verification
   */
  static readonly TEST_BINARY_PATH = '/tmp/yt-dlp-new'

  /**
   * Path where backup binaries are stored during tests
   */
  static readonly BACKUP_PATH = '/tmp/yt-dlp-backup'

  /**
   * Bitmask for checking if any execute permission is set (owner, group, or other)
   * 0o111 = 001 001 001 (binary) = x for owner, group, and other
   */
  static readonly EXECUTABLE_BIT = 0o111

  /**
   * Full executable permissions: rwxr-xr-x
   * 0o755 = 111 101 101 (binary) = owner:rwx, group:rx, other:rx
   */
  static readonly FULL_EXECUTABLE = 0o755

  /**
   * Create an executable test binary that returns a specific version
   *
   * Creates a shell script at TEST_BINARY_PATH that echoes the provided version
   * and sets it as executable with full permissions (0o755).
   *
   * @param version - The version string the binary should return when executed
   * @throws Error if file creation or permission setting fails
   *
   * @example
   * ```typescript
   * await YtdlpTestHelper.createExecutableTestBinary('2024.02.01')
   * const output = await YtdlpTestHelper.executeAndGetOutput(YtdlpTestHelper.TEST_BINARY_PATH)
   * expect(output).toBe('2024.02.01')
   * ```
   */
  static async createExecutableTestBinary(version: string): Promise<void> {
    const scriptContent = `#!/bin/sh\necho "${version}"`
    try {
      await writeFile(this.TEST_BINARY_PATH, scriptContent)
      await chmod(this.TEST_BINARY_PATH, this.FULL_EXECUTABLE)
    } catch (error) {
      throw new Error(
        `Failed to create executable test binary: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Verify that a file exists and has execute permissions
   *
   * Checks if the file at the given path has any execute permission bit set
   * (owner, group, or other).
   *
   * @param path - The file path to check
   * @returns Promise<boolean> - true if file is executable, false otherwise
   * @throws Error if file stat operation fails
   *
   * @example
   * ```typescript
   * const isExecutable = await YtdlpTestHelper.verifyExecutable('/usr/bin/yt-dlp')
   * expect(isExecutable).toBe(true)
   * ```
   */
  static async verifyExecutable(path: string): Promise<boolean> {
    try {
      const stats = await stat(path)
      // Check if any execute bit is set using bitwise AND
      return (stats.mode & this.EXECUTABLE_BIT) !== 0
    } catch (error) {
      throw new Error(
        `Failed to verify executable at ${path}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  /**
   * Execute a binary and capture its output
   *
   * Spawns the binary and captures both stdout and stderr. Returns stdout if
   * execution succeeds (exit code 0), otherwise throws an error with stderr included.
   *
   * @param binaryPath - The path to the binary to execute
   * @returns Promise<string> - The stdout output from the binary (trimmed)
   * @throws Error if execution fails or returns non-zero exit code
   *
   * @example
   * ```typescript
   * const version = await YtdlpTestHelper.executeAndGetOutput('/usr/bin/yt-dlp')
   * expect(version).toBe('2024.01.10')
   * ```
   */
  static async executeAndGetOutput(binaryPath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const proc = spawn(binaryPath)
      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', chunk => {
        stdout += chunk.toString()
      })

      proc.stderr.on('data', chunk => {
        stderr += chunk.toString()
      })

      proc.on('error', error => {
        reject(
          new Error(
            `Failed to execute binary at ${binaryPath}: ${error.message}`,
          ),
        )
      })

      proc.on('close', code => {
        if (code === 0) {
          resolve(stdout.trim())
        } else {
          const errorMessage = stderr.trim() || `Exit code: ${code}`
          reject(
            new Error(
              `Binary execution failed at ${binaryPath}: ${errorMessage}`,
            ),
          )
        }
      })
    })
  }
}
