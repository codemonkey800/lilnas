import { Module } from '@nestjs/common'

import { ServicesModule } from 'src/services/services.module'

import { radarrClientProvider, sonarrClientProvider } from './clients'
import { RadarrService } from './services/radarr.service'
import { SonarrService } from './services/sonarr.service'

@Module({
  imports: [ServicesModule],
  providers: [
    radarrClientProvider,
    sonarrClientProvider,
    RadarrService,
    SonarrService,
  ],
  controllers: [],
  exports: [RadarrService, SonarrService],
})
export class MediaModule {}
