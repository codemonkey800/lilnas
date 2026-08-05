import { createClient as createRadarrClient } from '@lilnas/media/radarr/client'
import { createClient as createSonarrClient } from '@lilnas/media/sonarr/client'
import { env } from '@lilnas/utils/env'
import { FactoryProvider } from '@nestjs/common'

import { EnvKeys } from 'src/env'

export const RADARR_CLIENT = Symbol('RADARR_CLIENT')
export const SONARR_CLIENT = Symbol('SONARR_CLIENT')

export type RadarrMediaClient = ReturnType<typeof createRadarrClient>
export type SonarrMediaClient = ReturnType<typeof createSonarrClient>

export const radarrClientProvider: FactoryProvider<RadarrMediaClient> = {
  provide: RADARR_CLIENT,
  useFactory: () =>
    createRadarrClient({
      baseUrl: env(EnvKeys.RADARR_URL),
      headers: { 'X-Api-Key': env(EnvKeys.RADARR_API_KEY) },
    }),
}

export const sonarrClientProvider: FactoryProvider<SonarrMediaClient> = {
  provide: SONARR_CLIENT,
  useFactory: () =>
    createSonarrClient({
      baseUrl: env(EnvKeys.SONARR_URL),
      headers: { 'X-Api-Key': env(EnvKeys.SONARR_API_KEY) },
    }),
}
