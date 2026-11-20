import { Global, Module } from '@nestjs/common'
import { Test } from '@nestjs/testing'

import { createTestDb } from 'src/db/__tests__/helpers/test-db'
import { DB } from 'src/db/database'
import { AccountsRepo } from 'src/db/repos/accounts.repo'
import { JobEventsRepo } from 'src/db/repos/job-events.repo'
import { JobsRepo } from 'src/db/repos/jobs.repo'
import { JobsModule } from 'src/jobs/jobs.module'
import { JobsService } from 'src/jobs/jobs.service'

describe('JobsModule', () => {
  it('wires JobsService with the real providers and exports it', async () => {
    const { db, close } = await createTestDb()

    // Stands in for the global DbModule, which needs a Postgres server.
    @Global()
    @Module({
      providers: [
        { provide: DB, useValue: db },
        AccountsRepo,
        JobsRepo,
        JobEventsRepo,
      ],
      exports: [DB, AccountsRepo, JobsRepo, JobEventsRepo],
    })
    class FakeDbModule {}

    const moduleRef = await Test.createTestingModule({
      imports: [FakeDbModule, JobsModule],
    }).compile()
    const service = moduleRef.get(JobsService)
    expect(service).toBeInstanceOf(JobsService)

    // A first look at a person with no account touches the repos, the clock
    // seam and statfs on the real PHOTOS_ROOT default without throwing.
    const view = await service.getView({
      email: 'a@example.com',
      userId: 'u',
      isAdmin: false,
    })
    expect(view).toMatchObject({ account: null, job: null })
    await moduleRef.close()
    await close()
  })
})
