import { Module } from '@nestjs/common'

import { EmbyService } from './emby.service'

/**
 * Emby integration. Currently just the raw HTTP client; the cached,
 * status-computing layer that consumers actually want gets added here
 * alongside it.
 */
@Module({
  providers: [EmbyService],
  exports: [EmbyService],
})
export class EmbyModule {}
