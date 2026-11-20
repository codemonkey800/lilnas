import { Module } from '@nestjs/common'

import { IcloudpdModule } from 'src/icloudpd/icloudpd.module'
import { ImmichModule } from 'src/immich/immich.module'

import { JobsService } from './jobs.service'
import { CLOCK, nodeStatfs, STATFS, systemClock } from './jobs.types'

@Module({
  imports: [IcloudpdModule, ImmichModule],
  providers: [
    JobsService,
    { provide: CLOCK, useValue: systemClock },
    { provide: STATFS, useValue: nodeStatfs },
  ],
  exports: [JobsService],
})
export class JobsModule {}
