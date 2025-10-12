import { Module } from '@nestjs/common'

import { RetryConfigService } from 'src/config/retry.config'
import { ServicesModule } from 'src/services/services.module'

import { RadarrClient } from './clients/radarr.client'
import { SonarrClient } from './clients/sonarr.client'
import { RadarrService } from './services/radarr.service'
import { SonarrService } from './services/sonarr.service'

@Module({
  imports: [ServicesModule],
  providers: [
    RetryConfigService,
    RadarrClient,
    SonarrClient,
    RadarrService,
    SonarrService,
  ],
  controllers: [],
  exports: [RadarrService, SonarrService],
})
export class MediaModule {}
