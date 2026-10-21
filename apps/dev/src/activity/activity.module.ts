import { Module } from '@nestjs/common'

import { HostActivityService } from 'src/activity/host-activity.service'

@Module({
  providers: [HostActivityService],
  exports: [HostActivityService],
})
export class ActivityModule {}

export type {
  HostActivity,
  ReapEstimate,
} from 'src/activity/host-activity.service'
export { estimateReap } from 'src/activity/host-activity.service'
