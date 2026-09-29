import { DownloadType } from '@lilnas/utils/download/types'
import { getErrorMessage } from '@lilnas/utils/error'
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common'

import { DbService } from 'src/db/db.service'
import { syncFlaggedReleases } from 'src/media/flagged-release-sync.util'
import { RadarrService } from 'src/media/radarr.service'
import { SonarrService } from 'src/media/sonarr.service'

/**
 * Plan 024. Brings the profiles this app manages in Radarr and Sonarr into
 * shape once the app is up: the `lilnas · <tier>` quality profiles (see
 * `ensureTierProfiles()`) and the `lilnas · Flagged releases` release
 * profile (see `syncFlaggedReleaseProfile()`).
 *
 * Never fails boot, and never holds it up: the run is started, not awaited,
 * and a failure is only logged. Radarr or Sonarr being down at boot is
 * fine - the first `tierProfileId()` call retries the tier work lazily, and
 * the next flag or unflag re-syncs the flagged releases.
 */
@Injectable()
export class ArrProfilesBootstrap implements OnApplicationBootstrap {
  private readonly logger = new Logger(ArrProfilesBootstrap.name)

  constructor(
    private readonly dbService: DbService,
    private readonly radarrService: RadarrService,
    private readonly sonarrService: SonarrService,
  ) {}

  onApplicationBootstrap(): void {
    void this.ensureAll()
  }

  /** Every app and profile, independently - one failing doesn't stop the rest. */
  async ensureAll(): Promise<void> {
    await Promise.all([
      this.ensure('Radarr', () => this.radarrService.ensureTierProfiles()),
      this.ensure('Sonarr', () => this.sonarrService.ensureTierProfiles()),
      this.mirrorFlags('Radarr', DownloadType.Movie, this.radarrService),
      this.mirrorFlags('Sonarr', DownloadType.Show, this.sonarrService),
    ])
  }

  private async ensure(app: string, run: () => Promise<void>): Promise<void> {
    try {
      await run()
    } catch (error) {
      this.logger.error(
        `Could not set up the ${app} quality tier profiles; retrying on first use: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      )
    }
  }

  // - A warning, not an error: `ReleaseService` still refuses a flagged
  //   release itself; only Radarr's/Sonarr's own automatic grabs miss out
  private async mirrorFlags(
    app: string,
    type: DownloadType,
    owner: RadarrService | SonarrService,
  ): Promise<void> {
    try {
      await syncFlaggedReleases(this.dbService.db, type, owner, this.logger)
    } catch (error) {
      this.logger.warn(
        `Could not mirror the flagged releases into ${app}; the next flag or restart retries: ${getErrorMessage(error)}`,
      )
    }
  }
}
