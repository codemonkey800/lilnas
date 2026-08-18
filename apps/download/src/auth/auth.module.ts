import { Module } from '@nestjs/common'

import { AdminCheckService } from './admin-check.service'
import { AuthDebugController } from './auth-debug.controller'
import { ForwardedUserGuard } from './forwarded-user.guard'

@Module({
  controllers: [AuthDebugController],
  providers: [ForwardedUserGuard, AdminCheckService],
  exports: [ForwardedUserGuard, AdminCheckService],
})
export class AuthModule {}
