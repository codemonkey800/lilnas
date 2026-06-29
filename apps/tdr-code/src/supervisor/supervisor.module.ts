import { Module } from '@nestjs/common'

import {
  SUPERVISOR_CLOCK,
  SUPERVISOR_SPAWN,
  SupervisorService,
} from './supervisor.service'

@Module({
  providers: [
    SupervisorService,
    { provide: SUPERVISOR_CLOCK, useValue: null },
    { provide: SUPERVISOR_SPAWN, useValue: null },
  ],
  exports: [SupervisorService],
})
export class SupervisorModule {}
