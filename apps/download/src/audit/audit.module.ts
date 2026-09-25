import { Module } from '@nestjs/common'

import { AuditLogService } from './audit-log.service'

/**
 * No `imports` on purpose: `AuditLogService`'s only dependency is
 * `DbService`, and `DbModule` is `@Global()` (see db.module.ts), so listing
 * it here would be noise. Keeping this module dependency-free is also what
 * lets every feature module import it without a cycle - the audit log is
 * written from `DownloadModule`, `MediaModule` and `YtdlpUpdateModule`, so
 * anything `AuditModule` pulled in would have to be upstream of all three.
 */
@Module({
  providers: [AuditLogService],
  exports: [AuditLogService],
})
export class AuditModule {}
