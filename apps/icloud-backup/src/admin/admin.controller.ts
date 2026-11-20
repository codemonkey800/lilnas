import { Controller, Get, Header, UseGuards } from '@nestjs/common'

import { AdminGuard } from 'src/auth/admin.guard'
import type { AdminAccountRow } from 'src/shared/contract'

import { AdminService } from './admin.service'

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('accounts')
  @Header('Cache-Control', 'no-store')
  accounts(): Promise<AdminAccountRow[]> {
    return this.admin.listAccounts()
  }
}
