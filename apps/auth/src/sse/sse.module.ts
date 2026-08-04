import { Module } from '@nestjs/common'

import { AdminGuard } from 'src/admin/admin.guard'
import { AccessCacheModule } from 'src/verify/access-cache.module'

import { NotifyBusService } from './notify-bus.service'
import { SseController } from './sse.controller'

// NotifyBusService is exported so U7's admin controller can inject it (via
// RequestsService) and call publishStatusChange() after its own
// approve/reject-action writes — see that service's header comment for the
// required write -> invalidate -> publish ordering (approve) and the
// simpler write -> publish ordering (reject, no cache step).
//
// AccessCacheModule is imported (not just AccessCacheService listed as a
// provider here) because SseController needs the SAME singleton instance
// AppModule's own VerifyService/RequestsService/AdminGuard already share —
// see access-cache.module.ts's own header comment for why this module had
// to be split out, and how its absence was an app-boot-time bug no
// direct-construction unit test could have caught.
//
// AdminGuard is listed here as its OWN provider (a second instance,
// distinct from the one AppModule provides directly to AdminController) —
// not imported from anywhere, since AppModule never wraps AdminGuard in a
// module of its own to export it from. Nest scopes providers per module;
// without this, SseController's `@UseGuards(AdminGuard)` on its `admin`
// route has nothing to resolve AdminGuard from and boot fails. This is
// safe to duplicate (unlike NotifyBusService, which must stay a true
// singleton): AdminGuard is stateless and constructor-injects only
// AccessCacheService, which AccessCacheModule above already guarantees is
// the SAME shared singleton either provider resolves to.
@Module({
  imports: [AccessCacheModule],
  controllers: [SseController],
  providers: [NotifyBusService, AdminGuard],
  exports: [NotifyBusService],
})
export class SseModule {}
