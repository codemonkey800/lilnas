import { Controller, Get, UseGuards } from '@nestjs/common'

import { JwtAuthGuard } from 'src/auth/jwt-auth.guard'

import { StorageService } from './storage.service'
import type { StorageOverview } from './storage.types'

@Controller('storage')
@UseGuards(JwtAuthGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  @Get()
  async getStorageOverview(): Promise<StorageOverview> {
    return this.storageService.getStorageOverview()
  }
}
