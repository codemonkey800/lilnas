import { Module } from '@nestjs/common'

import { SabnzbdService } from './sabnzbd.service'

/**
 * SABnzbd integration: the read-only HTTP client. Optional - with
 * `SABNZBD_URL` / `SABNZBD_API_KEY` unset the service reports
 * `enabled === false` and consumers skip it.
 */
@Module({
  providers: [SabnzbdService],
  exports: [SabnzbdService],
})
export class SabnzbdModule {}
