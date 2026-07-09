import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Put,
} from '@nestjs/common'

import { UpdateConfigBodySchema } from './config.dto'
import { ConfigService } from './config.service'

// Allowed origin for mutating PUT routes. Set ALLOWED_CONSOLE_ORIGIN in dev.
const ALLOWED_ORIGIN =
  process.env.ALLOWED_CONSOLE_ORIGIN ?? 'https://tdr-code.lilnas.io'

function requireSameOrigin(origin: string | undefined): void {
  if (origin !== ALLOWED_ORIGIN) {
    throw new ForbiddenException('cross-origin request rejected')
  }
}

// Trust boundary — Phase D (D6) must enumerate these routes for deny-by-default
// guards. /config (PUT) accepts operator-editable spawn settings — treat as sensitive.
@Controller('config')
export class ConfigController {
  constructor(private readonly configService: ConfigService) {}

  @Get()
  getConfig() {
    return this.configService.getConfig()
  }

  @Put()
  @HttpCode(200)
  updateConfig(
    @Headers('origin') origin: string | undefined,
    @Body() body: unknown,
  ) {
    requireSameOrigin(origin)

    const parsed = UpdateConfigBodySchema.safeParse(body)
    if (!parsed.success) {
      throw new BadRequestException(
        parsed.error.issues[0]?.message ?? 'Invalid config body',
      )
    }

    return this.configService.updateConfig(parsed.data)
  }
}
