import { env } from '@lilnas/utils/env'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import axios from 'axios'
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import { chmod, copy, move, pathExists, remove } from 'fs-extra'
import { gt } from 'semver'

import { DownloadStateService } from 'src/download/download-state.service'
import { EnvKey } from 'src/utils/env'

import { GitHubRelease, UpdateCheckResult, UpdateResult } from './types'

const YTDLP_BINARY_PATH = '/usr/bin/yt-dlp'
const YTDLP_BACKUP_PATH = '/tmp/yt-dlp-backup'
const YTDLP_TEMP_PATH = '/tmp/yt-dlp-new'
const GITHUB_API_URL =
  'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'

@Injectable()
export class YtdlpUpdateService {
  private logger = new Logger(YtdlpUpdateService.name)
  private isUpdating = false
  private lastUpdateCheck: Date | null = null
  private lastUpdateAttempt: Date | null = null
  private updateRetryCount = 0

  constructor(private readonly downloadStateService: DownloadStateService) {}

  @Cron(env<EnvKey>('YTDLP_UPDATE_CRON', CronExpression.EVERY_DAY_AT_3AM))
  async scheduledUpdateCheck(): Promise<void> {
    const action = 'scheduledUpdateCheck'
    const isEnabled =
      env<EnvKey>('YTDLP_AUTO_UPDATE_ENABLED', 'true') === 'true'

    if (!isEnabled) {
      this.logger.log({ action }, 'Auto-update is disabled, skipping check')
      return
    }

    this.logger.log({ action }, 'Starting scheduled yt-dlp update check')
    await this.checkForUpdates()
  }

  async checkForUpdates(): Promise<UpdateCheckResult> {
    const action = 'checkForUpdates'
    const startTime = Date.now()

    if (this.isUpdating) {
      this.logger.warn({ action }, 'Update already in progress, skipping')
      return {
        currentVersion: 'unknown',
        latestVersion: 'unknown',
        updateAvailable: false,
        canUpdate: false,
        reason: 'Update already in progress',
      }
    }

    try {
      this.lastUpdateCheck = new Date()

      this.logger.log({ action }, 'Checking current yt-dlp version')
      const currentVersion = await this.getCurrentVersion()

      this.logger.log(
        { action, currentVersion },
        'Fetching latest version from GitHub',
      )
      const latestRelease = await this.getLatestRelease()
      const latestVersion = this.parseVersionFromTag(latestRelease.tag_name)

      // Normalize both versions for semver comparison
      const normalizedLatest = this.normalizeVersionForComparison(latestVersion)
      const normalizedCurrent =
        this.normalizeVersionForComparison(currentVersion)

      const updateAvailable = gt(normalizedLatest, normalizedCurrent)

      this.logger.log(
        {
          action,
          currentVersion,
          latestVersion,
          updateAvailable,
          duration: Date.now() - startTime,
        },
        'Version check completed',
      )

      if (!updateAvailable) {
        this.logger.log({ action }, 'Already running latest version')
        return {
          currentVersion,
          latestVersion,
          updateAvailable: false,
          canUpdate: false,
          reason: 'Already running latest version',
        }
      }

      const canUpdate = this.canPerformUpdate()

      if (!canUpdate) {
        this.logger.log(
          {
            action,
            activeDownloads: this.downloadStateService.inProgressJobs.size,
          },
          'Cannot update - downloads in progress, will retry later',
        )

        this.scheduleRetry()

        return {
          currentVersion,
          latestVersion,
          updateAvailable: true,
          canUpdate: false,
          reason: 'Downloads in progress',
        }
      }

      this.logger.log({ action }, 'Update available and safe to proceed')
      await this.performUpdate(latestRelease)

      return {
        currentVersion,
        latestVersion,
        updateAvailable: true,
        canUpdate: true,
      }
    } catch (err) {
      const error = getErrorMessage(err)
      const duration = Date.now() - startTime

      this.logger.error(
        {
          action,
          error,
          duration,
        },
        'Error during update check',
      )

      return {
        currentVersion: 'unknown',
        latestVersion: 'unknown',
        updateAvailable: false,
        canUpdate: false,
        reason: `Error: ${error}`,
      }
    }
  }

  async getCurrentVersion(): Promise<string> {
    const action = 'getCurrentVersion'

    return new Promise((resolve, reject) => {
      const proc = spawn(YTDLP_BINARY_PATH, ['--version'])
      let output = ''

      proc.stdout.on('data', chunk => {
        output += chunk.toString()
      })

      proc.on('error', err => {
        this.logger.error(
          { action, error: err.message },
          'Failed to get current version',
        )
        reject(err)
      })

      proc.on('close', code => {
        if (code !== 0) {
          const error = `yt-dlp version check failed with code ${code}`
          this.logger.error({ action, exitCode: code }, error)
          reject(new Error(error))
          return
        }

        const version = output.trim()
        this.logger.debug({ action, version }, 'Current version retrieved')
        resolve(version)
      })
    })
  }

  private async getLatestRelease(): Promise<GitHubRelease> {
    const action = 'getLatestRelease'

    try {
      const response = await axios.get<GitHubRelease>(GITHUB_API_URL, {
        timeout: 10000,
        headers: {
          'User-Agent': 'lilnas-download-service',
        },
      })

      this.logger.debug(
        {
          action,
          tagName: response.data.tag_name,
          publishedAt: response.data.published_at,
        },
        'Latest release info fetched',
      )

      return response.data
    } catch (err) {
      const error = getErrorMessage(err)
      this.logger.error({ action, error }, 'Failed to fetch latest release')
      throw new Error(`Failed to fetch latest release: ${error}`)
    }
  }

  private parseVersionFromTag(tag: string): string {
    return tag.replace(/^v/, '')
  }

  /**
   * Normalizes yt-dlp's date-based versions to semver-compatible format
   * Converts "YYYY.MM.DD" to "YYYY.M.D" (removing leading zeros)
   * This ensures compatibility with semver comparison functions
   */
  private normalizeVersionForComparison(version: string): string {
    // yt-dlp uses date-based versions like "2024.02.01" or "2024.12.15"
    // We need to remove leading zeros to make them semver-compatible
    const parts = version.split('.')
    if (parts.length !== 3) {
      // If it's not a date-based version, return as is
      return version
    }

    // Convert "2024.02.01" to "2024.2.1" by removing leading zeros
    return parts.map(part => parseInt(part, 10).toString()).join('.')
  }

  private canPerformUpdate(): boolean {
    return this.downloadStateService.inProgressJobs.size === 0
  }

  private async performUpdate(release: GitHubRelease): Promise<UpdateResult> {
    const action = 'performUpdate'
    const startTime = Date.now()

    this.isUpdating = true
    this.lastUpdateAttempt = new Date()

    try {
      const currentVersion = await this.getCurrentVersion()
      const newVersion = this.parseVersionFromTag(release.tag_name)

      this.logger.log(
        {
          action,
          currentVersion,
          newVersion,
        },
        'Starting yt-dlp update process',
      )

      await this.downloadNewBinary()
      await this.verifyNewBinary()
      await this.backupCurrentBinary()
      await this.installNewBinary()
      await this.testNewBinary()
      await this.cleanup()

      const duration = Date.now() - startTime
      this.updateRetryCount = 0

      this.logger.log(
        {
          action,
          currentVersion,
          newVersion,
          duration,
        },
        'yt-dlp update completed successfully',
      )

      return {
        success: true,
        previousVersion: currentVersion,
        newVersion,
      }
    } catch (err) {
      const error = getErrorMessage(err)
      const duration = Date.now() - startTime

      this.logger.error(
        {
          action,
          error,
          duration,
        },
        'Update failed, attempting rollback',
      )

      try {
        await this.rollback()
        this.logger.log({ action }, 'Rollback completed successfully')
      } catch (rollbackErr) {
        const rollbackError = getErrorMessage(rollbackErr)
        this.logger.error(
          {
            action,
            rollbackError,
          },
          'Rollback failed - manual intervention may be required',
        )
      }

      return {
        success: false,
        previousVersion: 'unknown',
        newVersion: 'unknown',
        error,
      }
    } finally {
      this.isUpdating = false
    }
  }

  private async downloadNewBinary(): Promise<void> {
    const action = 'downloadNewBinary'

    const downloadUrl =
      'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp'

    this.logger.log({ action, downloadUrl }, 'Downloading new yt-dlp binary')

    try {
      const response = await axios.get(downloadUrl, {
        responseType: 'stream',
        timeout: 30000,
      })

      const writer = createWriteStream(YTDLP_TEMP_PATH)
      response.data.pipe(writer)

      await new Promise<void>((resolve, reject) => {
        writer.on('finish', () => resolve())
        writer.on('error', reject)
      })

      await chmod(YTDLP_TEMP_PATH, 0o755)

      this.logger.log({ action }, 'Binary download completed')
    } catch (err) {
      const error = getErrorMessage(err)
      this.logger.error({ action, error }, 'Failed to download new binary')
      throw new Error(`Failed to download new binary: ${error}`)
    }
  }

  private async verifyNewBinary(): Promise<void> {
    const action = 'verifyNewBinary'

    this.logger.log({ action }, 'Verifying new binary')

    return new Promise((resolve, reject) => {
      const proc = spawn(YTDLP_TEMP_PATH, ['--version'])
      let output = ''

      proc.stdout.on('data', chunk => {
        output += chunk.toString()
      })

      proc.on('error', err => {
        this.logger.error(
          { action, error: err.message },
          'Binary verification failed',
        )
        reject(new Error(`Binary verification failed: ${err.message}`))
      })

      proc.on('close', code => {
        if (code !== 0) {
          const error = `New binary failed verification with code ${code}`
          this.logger.error({ action, exitCode: code }, error)
          reject(new Error(error))
          return
        }

        const version = output.trim()
        this.logger.log({ action, version }, 'Binary verification successful')
        resolve()
      })
    })
  }

  private async backupCurrentBinary(): Promise<void> {
    const action = 'backupCurrentBinary'

    this.logger.log({ action }, 'Backing up current binary')

    try {
      await copy(YTDLP_BINARY_PATH, YTDLP_BACKUP_PATH)
      this.logger.log({ action }, 'Backup completed')
    } catch (err) {
      const error = getErrorMessage(err)
      this.logger.error({ action, error }, 'Failed to backup current binary')
      throw new Error(`Failed to backup current binary: ${error}`)
    }
  }

  private async installNewBinary(): Promise<void> {
    const action = 'installNewBinary'

    this.logger.log({ action }, 'Installing new binary')

    try {
      await move(YTDLP_TEMP_PATH, YTDLP_BINARY_PATH, { overwrite: true })
      this.logger.log({ action }, 'Installation completed')
    } catch (err) {
      const error = getErrorMessage(err)
      this.logger.error({ action, error }, 'Failed to install new binary')
      throw new Error(`Failed to install new binary: ${error}`)
    }
  }

  private async testNewBinary(): Promise<void> {
    const action = 'testNewBinary'

    this.logger.log({ action }, 'Testing new binary installation')

    return new Promise((resolve, reject) => {
      const proc = spawn(YTDLP_BINARY_PATH, ['--version'])
      let output = ''

      proc.stdout.on('data', chunk => {
        output += chunk.toString()
      })

      proc.on('error', err => {
        this.logger.error(
          { action, error: err.message },
          'New binary test failed',
        )
        reject(new Error(`New binary test failed: ${err.message}`))
      })

      proc.on('close', code => {
        if (code !== 0) {
          const error = `New binary test failed with code ${code}`
          this.logger.error({ action, exitCode: code }, error)
          reject(new Error(error))
          return
        }

        const version = output.trim()
        this.logger.log({ action, version }, 'New binary test successful')
        resolve()
      })
    })
  }

  private async rollback(): Promise<void> {
    const action = 'rollback'

    this.logger.log({ action }, 'Rolling back to previous version')

    try {
      if (await pathExists(YTDLP_BACKUP_PATH)) {
        await move(YTDLP_BACKUP_PATH, YTDLP_BINARY_PATH, { overwrite: true })
        this.logger.log({ action }, 'Rollback completed')
      } else {
        this.logger.warn({ action }, 'No backup found for rollback')
      }
    } catch (err) {
      const error = getErrorMessage(err)
      this.logger.error({ action, error }, 'Rollback failed')
      throw new Error(`Rollback failed: ${error}`)
    }
  }

  private async cleanup(): Promise<void> {
    const action = 'cleanup'

    this.logger.log({ action }, 'Cleaning up temporary files')

    try {
      const filesToClean = [YTDLP_TEMP_PATH, YTDLP_BACKUP_PATH]

      await Promise.all(
        filesToClean.map(async file => {
          if (await pathExists(file)) {
            await remove(file)
          }
        }),
      )

      this.logger.log({ action }, 'Cleanup completed')
    } catch (err) {
      this.logger.warn(
        { action, error: getErrorMessage(err) },
        'Cleanup failed',
      )
    }
  }

  private scheduleRetry(): void {
    const action = 'scheduleRetry'
    const maxRetries = +env<EnvKey>('YTDLP_UPDATE_MAX_RETRIES', '24')
    const retryInterval = +env<EnvKey>('YTDLP_UPDATE_RETRY_INTERVAL', '3600000') // 1 hour

    if (this.updateRetryCount >= maxRetries) {
      this.logger.warn(
        {
          action,
          retryCount: this.updateRetryCount,
          maxRetries,
        },
        'Maximum retry attempts reached, giving up',
      )
      this.updateRetryCount = 0
      return
    }

    this.updateRetryCount++

    this.logger.log(
      {
        action,
        retryCount: this.updateRetryCount,
        retryInMs: retryInterval,
      },
      'Scheduling retry for later',
    )

    setTimeout(() => {
      this.logger.log({ action }, 'Retry attempt triggered')
      this.checkForUpdates()
    }, retryInterval)
  }

  getUpdateStatus(): {
    isUpdating: boolean
    lastCheck: Date | null
    lastAttempt: Date | null
    retryCount: number
  } {
    return {
      isUpdating: this.isUpdating,
      lastCheck: this.lastUpdateCheck,
      lastAttempt: this.lastUpdateAttempt,
      retryCount: this.updateRetryCount,
    }
  }
}
