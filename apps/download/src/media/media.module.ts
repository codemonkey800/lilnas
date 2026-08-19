import { forwardRef, Module } from '@nestjs/common'

import { DownloadModule } from 'src/download/download.module'

import { radarrClientProvider, sonarrClientProvider } from './clients'
import { DiscoveryService } from './discovery.service'
import { MediaDownloadService } from './media-download.service'
import { MediaPollerService } from './media-poller.service'
import { RadarrService } from './radarr.service'
import { SonarrService } from './sonarr.service'

// MediaPollerService and MediaDownloadService both need DownloadStateService,
// which lives in DownloadModule; DownloadModule in turn needs
// MediaDownloadService for DownloadController's new movie/show endpoints.
// That mutual need is a genuine module-level cycle, resolved the standard
// NestJS way with forwardRef() on both sides (see download.module.ts).
// DiscoveryService only needs RadarrService/SonarrService - no DownloadJob
// state, no forwardRef needed on its account.
@Module({
  imports: [forwardRef(() => DownloadModule)],
  providers: [
    radarrClientProvider,
    sonarrClientProvider,
    DiscoveryService,
    RadarrService,
    SonarrService,
    MediaDownloadService,
    MediaPollerService,
  ],
  exports: [
    DiscoveryService,
    MediaDownloadService,
    RadarrService,
    SonarrService,
  ],
})
export class MediaModule {}
