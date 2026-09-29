import { env } from '@lilnas/utils/env'

import { EnvKeys } from 'src/env'

/**
 * Base URL of the download app's HTTP API, which every bot-side
 * `DownloadClient` talks to. Defaults to production's download service.
 *
 * Point it at a dev instance (e.g. http://lilnas-download-dev:8081) to test
 * against unmerged download changes. Set DOWNLOAD_URL alongside it so the
 * links in replies name the same instance (see `downloadLinks`).
 *
 * Read per call rather than at module load so tests can set it.
 */
export function downloadApiUrl(): string {
  return env(EnvKeys.DOWNLOAD_API_URL, 'http://download:8081')
}
