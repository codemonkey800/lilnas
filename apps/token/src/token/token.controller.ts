import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common'

import { CreateTokenSchema } from './token.dto'
import { TokenService } from './token.service'

@Controller('apps/:appSlug/tokens')
export class TokenController {
  constructor(private readonly tokenService: TokenService) {}

  @Get()
  async listTokens(@Param('appSlug') appSlug: string) {
    return this.tokenService.listTokens(appSlug)
  }

  @Post()
  async createToken(@Param('appSlug') appSlug: string, @Body() body: unknown) {
    const dto = CreateTokenSchema.parse(body)
    return this.tokenService.createToken(appSlug, dto)
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteToken(
    @Param('appSlug') appSlug: string,
    @Param('id') id: string,
  ) {
    await this.tokenService.deleteToken(appSlug, id)
  }
}
