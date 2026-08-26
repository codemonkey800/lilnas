import { Test, TestingModule } from '@nestjs/testing'

import { AdminController } from 'src/admin/admin.controller'
import { AdminModule } from 'src/admin/admin.module'
import { AdminStatsService } from 'src/admin/admin-stats.service'
import { AuditLogService } from 'src/audit/audit-log.service'
import { AdminGuard } from 'src/auth/admin.guard'
import { createTestDbService } from 'src/db/__tests__/test-utils'
import { DbModule } from 'src/db/db.module'
import { DbService } from 'src/db/db.service'

/**
 * A DI smoke test rather than a behavioural one. `AdminModule` reaches
 * outside itself for three things - `AdminGuard` and `AdminCheckService`
 * from `AuthModule`, `AuditLogService` from `AuditModule`, and `DbService`
 * from the `@Global()` `DbModule` - and a missing `imports` entry for any of
 * them is invisible to `tsc` and only fails when the app boots. Compiling
 * the real module here turns that into a test failure instead.
 *
 * `DbModule` is listed explicitly because `@Global()` still means "imported
 * once, by the root module", which in production is `AppModule`; the
 * override then swaps in an in-memory database so nothing touches
 * `DATABASE_PATH`.
 */
describe('AdminModule', () => {
  let dbService: DbService
  let module: TestingModule

  beforeEach(async () => {
    dbService = createTestDbService()

    module = await Test.createTestingModule({
      imports: [AdminModule, DbModule],
    })
      .overrideProvider(DbService)
      .useValue(dbService)
      .compile()
  })

  afterEach(async () => {
    await module.close()
    dbService.onModuleDestroy()
  })

  it('resolves the controller and its whole dependency graph', () => {
    expect(module.get(AdminController)).toBeInstanceOf(AdminController)
    expect(module.get(AdminStatsService)).toBeInstanceOf(AdminStatsService)
  })

  it('exposes AdminGuard and AuditLogService through the modules it imports', () => {
    expect(module.get(AdminGuard, { strict: false })).toBeInstanceOf(AdminGuard)
    expect(module.get(AuditLogService, { strict: false })).toBeInstanceOf(
      AuditLogService,
    )
  })
})
