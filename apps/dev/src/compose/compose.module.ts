import { Module } from '@nestjs/common'

import { ComposeRunnerService } from 'src/compose/compose-runner.service'

@Module({
  providers: [ComposeRunnerService],
  exports: [ComposeRunnerService],
})
export class ComposeModule {}
