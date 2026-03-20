import { Module } from '@nestjs/common'

import {
  RADARR_CLIENT,
  radarrClientProvider,
  SONARR_CLIENT,
  sonarrClientProvider,
} from './clients'

@Module({
  providers: [radarrClientProvider, sonarrClientProvider],
  exports: [RADARR_CLIENT, SONARR_CLIENT],
})
export class MediaModule {}
