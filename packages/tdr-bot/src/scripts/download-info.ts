#!/usr/bin/env tsx

/**
 * TDR Bot Download Information Script
 *
 * This script displays comprehensive download information for movies and TV shows
 * using Radarr and Sonarr services without requiring NestJS dependency injection.
 *
 * Usage:
 *   npx tsx src/scripts/download-info.ts
 *   ./src/scripts/download-info.ts  (if tsx is in shebang)
 *
 * Features:
 * - System health status for Radarr and Sonarr
 * - Active downloads with progress bars and ETA
 * - Library overview with completion statistics
 * - Recent additions tracking
 * - Color-coded output with detailed formatting
 * - Graceful error handling when services are unavailable
 *
 * Requirements:
 * - Environment variables for Radarr/Sonarr connections (if configured)
 * - tsx for TypeScript execution
 * - Network access to Radarr/Sonarr instances
 */

import * as dotenv from 'dotenv'
import path from 'path'

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../../.env') })
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

// Import required services and clients
import { RadarrClient } from 'src/media/clients/radarr.client'
import { SonarrClient } from 'src/media/clients/sonarr.client'
import { RadarrService } from 'src/media/services/radarr.service'
import { SonarrService } from 'src/media/services/sonarr.service'
// Types

// Console colors for better formatting
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
}

const c = (color: keyof typeof colors, text: string): string =>
  `${colors[color]}${text}${colors.reset}`

/**
 * TDR Bot Download Information Script
 *
 * Displays comprehensive download information for movies and TV shows
 * using Radarr and Sonarr services without NestJS dependency injection.
 */
class DownloadInfoScript {
  private radarrService: RadarrService | null = null
  private sonarrService: SonarrService | null = null

  constructor() {
    this.initializeServices()
  }

  private initializeServices(): void {
    try {
      // Create comprehensive mock services for dependency injection
      const mockRetryService = {
        executeWithRetry: async (fn: () => Promise<unknown>) => fn(),
        executeWithCircuitBreaker: async (fn: () => Promise<unknown>) => fn(),
        // Add any other methods that might be called
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any

      const mockErrorClassifier = {
        classifyError: () => ({
          isRetryable: false,
          errorType: 'network_error',
          category: 'external_service',
          severity: 'medium',
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any

      const mockRetryConfigService = {
        getRadarrConfig: () => ({
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          backoffFactor: 2,
          jitter: true,
          timeout: 10000,
          logRetryAttempts: false,
          logSuccessfulRetries: false,
          logFailedRetries: true,
          logRetryDelays: false,
          logErrorDetails: true,
        }),
        getSonarrConfig: () => ({
          maxAttempts: 3,
          baseDelay: 1000,
          maxDelay: 30000,
          backoffFactor: 2,
          jitter: true,
          timeout: 10000,
          logRetryAttempts: false,
          logSuccessfulRetries: false,
          logFailedRetries: true,
          logRetryDelays: false,
          logErrorDetails: true,
        }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any

      // Initialize clients with proper mock dependencies
      const radarrClient = new RadarrClient(
        mockRetryService,
        mockErrorClassifier,
        mockRetryConfigService,
      )

      this.radarrService = new RadarrService(
        radarrClient,
        mockRetryService,
        mockErrorClassifier,
      )

      // Initialize Sonarr services with proper mock dependencies
      const sonarrClient = new SonarrClient(
        mockRetryService,
        mockErrorClassifier,
        mockRetryConfigService,
      )

      this.sonarrService = new SonarrService(
        sonarrClient,
        mockRetryService,
        mockErrorClassifier,
      )
    } catch {
      console.error('❌ Failed to initialize services')
    }
  }

  async run(): Promise<void> {
    this.printHeader()

    // Display system status
    await this.displaySystemStatus()

    // Display active downloads
    await this.displayActiveDownloads()

    this.printFooter()
  }

  private printHeader(): void {
    const title = ' TDR Bot - Download Information '
    const border = '═'.repeat(60)
    const padding = Math.floor((60 - title.length) / 2)

    console.log(c('cyan', border))
    console.log(
      c('cyan', '║') +
        ' '.repeat(padding) +
        c('bright', title) +
        ' '.repeat(60 - title.length - padding) +
        c('cyan', '║'),
    )
    console.log(c('cyan', border))
    console.log('')
  }

  private printFooter(): void {
    const timestamp = new Date().toLocaleString()
    console.log(c('dim', `Generated at: ${timestamp}`))
    console.log('')
  }

  private printSection(title: string, icon: string): void {
    console.log(c('bright', `${icon} ${title}`))
    console.log(c('blue', '━'.repeat(60)))
  }

  private async displaySystemStatus(): Promise<void> {
    this.printSection('System Status', '📊')

    // Check Radarr status
    if (this.radarrService) {
      try {
        const radarrStatus = await this.radarrService.getSystemStatus()
        const radarrHealth = await this.radarrService.checkHealth()
        const healthStatus = radarrHealth
          ? c('green', '● HEALTHY')
          : c('red', '● UNHEALTHY')
        const version = c('dim', `v${radarrStatus.version}`)
        console.log(`  🎬 ${c('bright', 'Radarr')}: ${healthStatus} ${version}`)
      } catch {
        console.log(
          `  🎬 ${c('bright', 'Radarr')}: ${c('red', '● UNAVAILABLE')}`,
        )
      }
    } else {
      console.log(
        `  🎬 ${c('bright', 'Radarr')}: ${c('red', '● NOT INITIALIZED')}`,
      )
    }

    // Check Sonarr status
    if (this.sonarrService) {
      try {
        const sonarrStatus = await this.sonarrService.getSystemStatus()
        const sonarrHealth = await this.sonarrService.checkHealth()
        const healthStatus = sonarrHealth
          ? c('green', '● HEALTHY')
          : c('red', '● UNHEALTHY')
        const version = c('dim', `v${sonarrStatus.version}`)
        console.log(`  📺 ${c('bright', 'Sonarr')}: ${healthStatus} ${version}`)
      } catch {
        console.log(
          `  📺 ${c('bright', 'Sonarr')}: ${c('red', '● UNAVAILABLE')}`,
        )
      }
    } else {
      console.log(
        `  📺 ${c('bright', 'Sonarr')}: ${c('red', '● NOT INITIALIZED')}`,
      )
    }

    console.log('')
  }

  private async displayActiveDownloads(): Promise<void> {
    this.printSection('Active Downloads', '⬇️')

    let hasDownloads = false

    // Get downloading movies
    if (this.radarrService) {
      try {
        const downloadingMovies =
          await this.radarrService.getDownloadingMovies()
        if (downloadingMovies.length > 0) {
          hasDownloads = true
          console.log(
            `\n  🎬 ${c('bright', 'Movies')} ${c('dim', `(${downloadingMovies.length} downloading)`)}`,
          )
          downloadingMovies.forEach((movie, index) => {
            const progress = movie.progressPercent.toFixed(1)
            const size = this.formatBytes(movie.size)
            const downloaded = this.formatBytes(movie.downloadedBytes)
            const progressBar = this.createProgressBar(movie.progressPercent)

            console.log(
              `\n    ${index + 1}. ${c('cyan', movie.movieTitle || 'Unknown Movie')} ${c('dim', `(${movie.movieYear || 'Unknown'})`)}`,
            )
            console.log(`       ${progressBar} ${c('green', progress + '%')}`)
            console.log(`       ${c('dim', '📦')} ${downloaded} / ${size}`)
            console.log(
              `       ${c('dim', '⚡')} Status: ${this.getStatusColor(movie.status)}`,
            )
            if (movie.estimatedCompletionTime) {
              const eta = new Date(movie.estimatedCompletionTime)
              console.log(
                `       ${c('dim', '🕒')} ETA: ${c('yellow', eta.toLocaleString())}`,
              )
            }
            if (movie.downloadClient) {
              console.log(
                `       ${c('dim', '💻')} Client: ${movie.downloadClient}`,
              )
            }
          })
        }
      } catch {
        console.log(
          `\n  🎬 ${c('bright', 'Movies')}: ${c('red', 'Failed to fetch downloads')}`,
        )
      }
    }

    // Get downloading TV series
    if (this.sonarrService) {
      try {
        const downloadingSeries =
          await this.sonarrService.getDownloadingEpisodes()
        if (downloadingSeries.length > 0) {
          hasDownloads = true
          console.log(
            `\n  📺 ${c('bright', 'TV Episodes')} ${c('dim', `(${downloadingSeries.length} downloading)`)}`,
          )
          downloadingSeries.forEach((episode, index) => {
            const progress = episode.progressPercent.toFixed(1)
            const size = this.formatBytes(episode.size)
            const downloaded = this.formatBytes(episode.downloadedBytes)
            const seasonEp = `S${episode.seasonNumber?.toString().padStart(2, '0') || '??'}E${episode.episodeNumber?.toString().padStart(2, '0') || '??'}`
            const progressBar = this.createProgressBar(episode.progressPercent)

            console.log(
              `\n    ${index + 1}. ${c('cyan', episode.seriesTitle || 'Unknown Series')} - ${c('magenta', seasonEp)}`,
            )
            console.log(
              `       ${c('dim', episode.episodeTitle || 'Unknown Episode')}`,
            )
            console.log(`       ${progressBar} ${c('green', progress + '%')}`)
            console.log(`       ${c('dim', '📦')} ${downloaded} / ${size}`)
            console.log(
              `       ${c('dim', '⚡')} Status: ${this.getStatusColor(episode.status)}`,
            )
            if (episode.estimatedCompletionTime) {
              const eta = new Date(episode.estimatedCompletionTime)
              console.log(
                `       ${c('dim', '🕒')} ETA: ${c('yellow', eta.toLocaleString())}`,
              )
            }
            if (episode.downloadClient) {
              console.log(
                `       ${c('dim', '💻')} Client: ${episode.downloadClient}`,
              )
            }
          })
        }
      } catch {
        console.log(
          `\n  📺 ${c('bright', 'TV Episodes')}: ${c('red', 'Failed to fetch downloads')}`,
        )
      }
    }

    if (!hasDownloads) {
      console.log(`  ${c('dim', 'No active downloads found.')}`)
    }

    console.log('')
  }

  private createProgressBar(percent: number, length: number = 20): string {
    const filled = Math.floor((percent / 100) * length)
    const empty = length - filled
    const bar = c('green', '█'.repeat(filled)) + c('dim', '░'.repeat(empty))
    return `[${bar}]`
  }

  private getStatusColor(status: string): string {
    const statusLower = status.toLowerCase()
    if (statusLower.includes('downloading')) return c('green', status)
    if (statusLower.includes('queued')) return c('yellow', status)
    if (statusLower.includes('paused')) return c('yellow', status)
    if (statusLower.includes('warning')) return c('yellow', status)
    if (statusLower.includes('failed') || statusLower.includes('error'))
      return c('red', status)
    return c('white', status)
  }

  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }
}

// Main execution
async function main(): Promise<void> {
  const script = new DownloadInfoScript()

  try {
    await script.run()
  } catch (error) {
    console.error('❌ Script failed:', error)
    process.exit(1)
  }
}

// Run the script
if (require.main === module) {
  main()
}
