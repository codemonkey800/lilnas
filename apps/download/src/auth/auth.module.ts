import { Module } from '@nestjs/common'

import { AdminGuard } from './admin.guard'
import { AdminCheckService } from './admin-check.service'
import { AuthDebugController } from './auth-debug.controller'
import { ForwardedUserGuard } from './forwarded-user.guard'

@Module({
  controllers: [AuthDebugController],
  providers: [ForwardedUserGuard, AdminCheckService, AdminGuard],
  exports: [ForwardedUserGuard, AdminCheckService, AdminGuard],
})
export class AuthModule {}
