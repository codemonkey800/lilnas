import { createClient as createRadarrClient } from '@lilnas/media/radarr-next/client'
import { createClient as createSonarrClient } from '@lilnas/media/sonarr/client'

import { EnvKeys } from 'src/env'

type RadarrClient = ReturnType<typeof createRadarrClient>
type SonarrClient = ReturnType<typeof createSonarrClient>

let radarrClient: RadarrClient | null = null
let sonarrClient: SonarrClient | null = null

export function getRadarrClient(): RadarrClient {
  if (!radarrClient) {
    radarrClient = createRadarrClient({
      baseUrl: process.env[EnvKeys.RADARR_URL]!,
      headers: { 'X-Api-Key': process.env[EnvKeys.RADARR_API_KEY]! },
    })
  }
  return radarrClient
}

export function getSonarrClient(): SonarrClient {
  if (!sonarrClient) {
    sonarrClient = createSonarrClient({
      baseUrl: process.env[EnvKeys.SONARR_URL]!,
      headers: { 'X-Api-Key': process.env[EnvKeys.SONARR_API_KEY]! },
    })
  }
  return sonarrClient
}
