import { env } from '@lilnas/utils/env'
import { Logger as NestLogger } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { WsAdapter } from '@nestjs/platform-ws'
import { Logger } from 'nestjs-pino'

import { AppModule } from './app.module'
import { DbService } from './db/db.service'
import { reconcileInterruptedJobs } from './db/reconcile-interrupted-jobs'
import { DownloadStateService } from './download/download-state.service'
import { EnvKeys } from './env'
import { syncDownloadedLibrary } from './media/library-sync'
import { RadarrService } from './media/radarr.service'
import { SonarrService } from './media/sonarr.service'

export async function bootstrap() {
  try {
    const app = await NestFactory.create(AppModule, { bufferLogs: true })
    app.useWebSocketAdapter(new WsAdapter(app))
    app.useLogger(app.get(Logger))

    // Migrations run automatically at boot, hard-fail on a bad integrity
    // check — never serve traffic on a half-migrated schema. Explicit
    // method calls (not DbService.onModuleInit()) keep this sequence
    // linear and visible in one place.
    const dbService = app.get(DbService)
    dbService.runMigrations()
    dbService.checkIntegrity()
    // After integrity is confirmed sound, but before serving any traffic -
    // any row left at a non-terminal status belongs to the previous
    // process, which is gone along with its in-memory DownloadStateService
    // Map. The exception is RESTART_SURVIVING_STATUSES, which the sweep
    // leaves alone because the state they name (a Radarr/Sonarr queue row)
    // outlived this process; those get re-adopted into the fresh Map right
    // after, so the poller tracks them again from its first tick.
    reconcileInterruptedJobs(dbService.db)
    const adopted = app.get(DownloadStateService).adoptSurvivingJobs()
    console.log(`Re-adopted ${adopted} restart-surviving job(s)`)

    // Backfills a completed job for every Radarr/Sonarr title that's already
    // downloaded but has no job of its own, so "Browse movies/shows" (built
    // entirely from the job log, plan §3.2) reflects what's actually in the
    // library rather than only what was requested through this app. Runs
    // after the checks above but still before any traffic is served;
    // best-effort internally, so a Radarr/Sonarr outage here never blocks
    // boot.
    const librarySyncResult = await syncDownloadedLibrary(
      dbService.db,
      app.get(RadarrService),
      app.get(SonarrService),
      new NestLogger('LibrarySync'),
    )
    console.log(
      `Library sync: backfilled ${librarySyncResult.moviesAdded} movie(s), ` +
        `${librarySyncResult.showsAdded} show(s)`,
    )

    const port = +env(EnvKeys.BACKEND_PORT)
    await app.listen(port)

    console.log(`Started backend server at http://localhost:${port}`)
  } catch (err) {
    // NestFactory.create() itself can throw here (e.g. DbService's
    // constructor opening the sqlite file eagerly, CANTOPEN/EACCES), not
    // just the explicit runMigrations()/checkIntegrity() calls above.
    // Plain console.error (not the pino Logger) deliberately — if
    // create() itself failed, `app` (and app.get(Logger)) may not exist.
    console.error(
      'download: fatal boot error (Nest init, migration, or integrity check failed); exiting',
      err,
    )
    process.exit(1)
  }
}
