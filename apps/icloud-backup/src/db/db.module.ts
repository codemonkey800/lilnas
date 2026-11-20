import { Global, Module } from '@nestjs/common'

import { DB } from './database'
import { DbService } from './db.service'
import { AccountsRepo } from './repos/accounts.repo'
import { JobEventsRepo } from './repos/job-events.repo'
import { JobsRepo } from './repos/jobs.repo'

const repos = [AccountsRepo, JobsRepo, JobEventsRepo]

@Global()
@Module({
  providers: [
    DbService,
    { provide: DB, inject: [DbService], useFactory: (s: DbService) => s.db },
    ...repos,
  ],
  exports: [DbService, DB, ...repos],
})
export class DbModule {}
