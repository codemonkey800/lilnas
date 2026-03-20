import { Controller, Get, NotFoundException, Param } from '@nestjs/common'

import { TokenService } from 'src/token/token.service'

import { AppsService } from './apps.service'

@Controller('apps')
export class AppsController {
  constructor(
    private readonly appsService: AppsService,
    private readonly tokenService: TokenService,
  ) {}

  @Get()
  async listApps() {
    return this.appsService.getAppsWithDetails()
  }

  @Get(':slug')
  async getApp(@Param('slug') slug: string) {
    const app = this.appsService.getApp(slug)

    if (!app) {
      throw new NotFoundException(`App '${slug}' not found`)
    }

    const [tokens] = await Promise.all([this.tokenService.listTokens(slug)])

    return {
      ...app,
      tokens,
      tokenCount: tokens.length,
    }
  }
}
