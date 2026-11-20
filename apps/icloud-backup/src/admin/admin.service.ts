import { Injectable } from '@nestjs/common'

import { AccountsRepo } from 'src/db/repos/accounts.repo'
import { JobsRepo } from 'src/db/repos/jobs.repo'
import type { AdminAccountRow, BackupState } from 'src/shared/contract'

@Injectable()
export class AdminService {
  constructor(
    private readonly accounts: AccountsRepo,
    private readonly jobs: JobsRepo,
  ) {}

  /**
   * One row per account with its latest job's state. The totals are the
   * stored ones; no disk is walked.
   */
  async listAccounts(): Promise<AdminAccountRow[]> {
    const accounts = await this.accounts.list()
    return Promise.all(
      accounts.map(async account => {
        const job = await this.jobs.findLatestForAccount(account.id)
        return {
          email: account.lilnasEmail,
          appleId: account.appleId ?? '',
          folder: account.slug,
          state: job ? (job.state as BackupState) : null,
          lastBackupAt: account.lastBackupAt?.toISOString() ?? null,
          totalItems: account.totalItems,
          totalBytes: account.totalBytes,
          hasImmich: account.immichLibraryId !== null,
        }
      }),
    )
  }
}
