import { Module } from '@nestjs/common'

import { AuthModule } from 'src/auth/auth.module'
import { JobsModule } from 'src/jobs/jobs.module'

import { BackupController } from './backup.controller'
import { BackupGateway } from './backup.gateway'
import { JobUserService } from './job-user.service'
import { RequestedWithGuard } from './requested-with.guard'

@Module({
  imports: [AuthModule, JobsModule],
  controllers: [BackupController],
  providers: [BackupGateway, JobUserService, RequestedWithGuard],
})
export class ApiModule {}
