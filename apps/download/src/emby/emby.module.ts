import { Module } from '@nestjs/common'

import { EmbyService } from './emby.service'
import { EmbyStatusService } from './emby-status.service'

/**
 * Emby integration: the raw HTTP client plus the cached, status-computing
 * layer on top of it.
 *
 * `EmbyStatusService` is what consumers actually want - it never throws and
 * it never hits Emby more than once per TTL. `EmbyService` stays exported
 * alongside it for anything that needs a raw, uncached call, but a consumer
 * reaching for it should first check that it isn't really asking for a
 * status.
 */
@Module({
  providers: [EmbyService, EmbyStatusService],
  exports: [EmbyService, EmbyStatusService],
})
export class EmbyModule {}
