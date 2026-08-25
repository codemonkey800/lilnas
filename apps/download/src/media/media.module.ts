import { forwardRef, Module } from '@nestjs/common'

import { DownloadModule } from 'src/download/download.module'
import { EmbyModule } from 'src/emby/emby.module'

import { radarrClientProvider, sonarrClientProvider } from './clients'
import { DiscoveryService } from './discovery.service'
import { MediaDownloadService } from './media-download.service'
import { MediaFileService } from './media-file.service'
import { MediaPollerService } from './media-poller.service'
import { MediaResolverService } from './media-resolver.service'
import { RadarrService } from './radarr.service'
import { ReleaseService } from './release.service'
import { ShowService } from './show.service'
import { SonarrService } from './sonarr.service'

// MediaPollerService and MediaDownloadService both need DownloadStateService,
// which lives in DownloadModule; DownloadModule in turn needs
// MediaDownloadService for DownloadController's new movie/show endpoints.
// That mutual need is a genuine module-level cycle, resolved the standard
// NestJS way with forwardRef() on both sides (see download.module.ts).
// DiscoveryService only needs RadarrService/SonarrService - no DownloadJob
// state, no forwardRef needed on its account.
//
// EmbyModule is a plain import, deliberately: it depends on nothing in
// MediaModule or DownloadModule (EmbyService talks to Emby over HTTP,
// EmbyStatusService only to EmbyService), so there is no cycle to break and
// forwardRef() would only hide that fact from the next reader.
@Module({
  imports: [forwardRef(() => DownloadModule), EmbyModule],
  providers: [
    radarrClientProvider,
    sonarrClientProvider,
    DiscoveryService,
    RadarrService,
    SonarrService,
    MediaDownloadService,
    MediaFileService,
    MediaPollerService,
    MediaResolverService,
    ReleaseService,
    ShowService,
  ],
  exports: [
    DiscoveryService,
    MediaDownloadService,
    MediaFileService,
    MediaResolverService,
    RadarrService,
    ReleaseService,
    ShowService,
    SonarrService,
  ],
})
export class MediaModule {}
