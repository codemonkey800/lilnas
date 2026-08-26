import { Module } from '@nestjs/common'

import { AuditModule } from 'src/audit/audit.module'
import { AuthModule } from 'src/auth/auth.module'

import { AdminController } from './admin.controller'
import { AdminStatsService } from './admin-stats.service'

/**
 * `AuthModule` for the class-level `AdminGuard` (and the `AdminCheckService`
 * it injects); `AuditModule` for the audit log's read side.
 *
 * No `DbModule` even though `AdminStatsService` injects `DbService` -
 * `DbModule` is `@Global()` (see db.module.ts), so listing it would be
 * noise. Nothing is exported: this module is a leaf, and `AdminStatsService`
 * is only ever reached through the guarded controller.
 */
@Module({
  imports: [AuditModule, AuthModule],
  controllers: [AdminController],
  providers: [AdminStatsService],
})
export class AdminModule {}
