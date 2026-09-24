import { forwardRef, Module } from '@nestjs/common'

import { DownloadModule } from 'src/download/download.module'
import { DownloadGatewayModule } from 'src/download-gateway/download-gateway.module'
import { EmbyModule } from 'src/emby/emby.module'

import { radarrClientProvider, sonarrClientProvider } from './clients'
import { CurrentReleaseService } from './current-release.service'
import { DiscoveryService } from './discovery.service'
import { LibraryWatchService } from './library-watch.service'
import { ManualImportService } from './manual-import.service'
import { MediaDownloadService } from './media-download.service'
import { MediaFileService } from './media-file.service'
import { MediaPollerService } from './media-poller.service'
import { MediaResolverService } from './media-resolver.service'
import { MediaStateService } from './media-state.service'
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
//
// DownloadGatewayModule is plain for the same reason: it imports only
// AuthModule, so MediaPollerService and LibraryWatchService can inject
// DownloadGateway to broadcast media state changes without adding a second
// cycle.
@Module({
  imports: [
    forwardRef(() => DownloadModule),
    DownloadGatewayModule,
    EmbyModule,
  ],
  providers: [
    radarrClientProvider,
    sonarrClientProvider,
    CurrentReleaseService,
    DiscoveryService,
    LibraryWatchService,
    RadarrService,
    SonarrService,
    ManualImportService,
    MediaDownloadService,
    MediaFileService,
    MediaPollerService,
    MediaResolverService,
    MediaStateService,
    ReleaseService,
    ShowService,
  ],
  exports: [
    // Exported as well as provided: the release detail a title page renders
    // is assembled outside this module.
    CurrentReleaseService,
    DiscoveryService,
    // Exported for the controller's manual-import routes, which live on the
    // far side of the DownloadModule forwardRef.
    ManualImportService,
    MediaDownloadService,
    MediaFileService,
    MediaResolverService,
    // Exported for DownloadStateService, across the forwardRef, which feeds
    // it the status of every in-flight video job.
    MediaStateService,
    RadarrService,
    ReleaseService,
    ShowService,
    SonarrService,
  ],
})
export class MediaModule {}
