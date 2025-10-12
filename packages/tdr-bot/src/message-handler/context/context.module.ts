import { Module } from '@nestjs/common'

import { ContextManagementService } from './context-management.service'

@Module({
  providers: [ContextManagementService],
  exports: [ContextManagementService],
})
export class ContextModule {}
