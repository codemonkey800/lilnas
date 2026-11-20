import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'

import { AdminGuard } from './admin.guard'
import { AdminCheckService } from './admin-check.service'
import { ForwardedUserGuard } from './forwarded-user.guard'

@Module({
  providers: [
    AdminCheckService,
    AdminGuard,
    { provide: APP_GUARD, useClass: ForwardedUserGuard },
  ],
  exports: [AdminCheckService, AdminGuard],
})
export class AuthModule {}
