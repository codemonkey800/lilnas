import { Global, Module } from '@nestjs/common'

import { NotifyBusService } from './notify-bus.service'
import { SseController } from './sse.controller'
import { SseHubService } from './sse-hub.service'

// PROCESS-SCOPING INVARIANT (load-bearing — see the plan's "Process-scoping
// invariant" confidence check): SseModule must be imported ONLY by
// AppModule (src/app.module.ts), which boots the main HTTP-serving process.
// It must never become reachable — directly or transitively — from
// BotModule (src/bot.module.ts), which boots the headless bot child process
// via NestFactory.createApplicationContext with no HTTP listener and no
// SSE subscribers. If BotModule ever imported this module, SseHubService's
// constructor would still run (subscribing to NotifyBusService.stream$ and
// standing up its fallback-tick machinery) with zero possible connections
// to serve — a silently-wrong, wasted instantiation in the wrong process.
//
// @Global so NotifyBusService is injectable from any module in the
// IMPORTING process's graph without that module needing to import
// SseModule directly (e.g. a later unit's SupervisorService, itself under
// SupervisorModule -> ConsoleModule, publishes to the bus with no cycle).
// SseHubService is NOT exported here — it is package-internal to this
// module; only SseController (declared by this module, below) is meant to
// call it.
@Global()
@Module({
  controllers: [SseController],
  providers: [NotifyBusService, SseHubService],
  exports: [NotifyBusService],
})
export class SseModule {}
