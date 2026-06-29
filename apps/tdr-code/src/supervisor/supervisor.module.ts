import { Module } from '@nestjs/common'

import {
  defaultClock,
  defaultSpawn,
  SUPERVISOR_CLOCK,
  SUPERVISOR_SPAWN,
  SupervisorService,
} from './supervisor.service'

@Module({
  providers: [
    SupervisorService,
    { provide: SUPERVISOR_CLOCK, useFactory: () => defaultClock() },
    { provide: SUPERVISOR_SPAWN, useFactory: () => defaultSpawn() },
  ],
  exports: [SupervisorService],
})
export class SupervisorModule {}
