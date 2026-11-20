import { Module } from '@nestjs/common'

import { AuthModule } from 'src/auth/auth.module'

import { AdminController } from './admin.controller'
import { AdminService } from './admin.service'

@Module({
  imports: [AuthModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
