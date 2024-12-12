import { Module } from '@nestjs/common'

import { StatusService } from 'src/status.service'

import { SchedulesService } from './schedules.service'

@Module({
  providers: [SchedulesService, StatusService],
})
export class SchedulesModule {}
