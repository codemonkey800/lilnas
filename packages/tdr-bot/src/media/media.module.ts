import { Module } from '@nestjs/common'

import { RetryConfigService } from 'src/config/retry.config'
import { ServicesModule } from 'src/services/services.module'

import { RadarrClient } from './clients/radarr.client'
import { RadarrService } from './services/radarr.service'

@Module({
  imports: [ServicesModule],
  providers: [RetryConfigService, RadarrClient, RadarrService],
  controllers: [],
  exports: [RadarrService],
})
export class MediaModule {}
