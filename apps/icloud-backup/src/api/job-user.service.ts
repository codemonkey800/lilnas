import { Injectable } from '@nestjs/common'

import { AdminCheckService } from 'src/auth/admin-check.service'
import type { ForwardedUser } from 'src/auth/forwarded-user'
import type { JobUser } from 'src/jobs/jobs.types'

/** Turns a forwarded identity into the `JobUser` the orchestrator takes. */
@Injectable()
export class JobUserService {
  constructor(private readonly adminCheck: AdminCheckService) {}

  async resolve(user: ForwardedUser): Promise<JobUser> {
    return {
      email: user.email,
      userId: user.userId,
      isAdmin: await this.adminCheck.checkIsAdmin(user.email),
    }
  }
}
