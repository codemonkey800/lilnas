import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common'

import { ValidateTokenSchema } from 'src/token/token.dto'
import { TokenService } from 'src/token/token.service'

@Controller('public')
export class PublicController {
  constructor(private readonly tokenService: TokenService) {}

  @Post('validate')
  @HttpCode(HttpStatus.OK)
  async validateToken(@Body() body: unknown): Promise<{ valid: boolean }> {
    const dto = ValidateTokenSchema.parse(body)

    const valid = await this.tokenService.validateToken(dto.appSlug, dto.value)

    return { valid }
  }
}
