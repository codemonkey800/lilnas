import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { Request, Response } from 'express'

import { AuthService } from './auth.service'
import { LoginRequestSchema } from './login-request.schema'
import { AppThrottlerGuard } from './throttler.guard'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @UseGuards(AppThrottlerGuard)
  login(
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ): { username: string } {
    const parsed = LoginRequestSchema.safeParse(body)
    if (!parsed.success) {
      throw new HttpException(
        {
          info: 'Invalid input',
          errors: parsed.error.issues.map(issue => issue.message),
        },
        HttpStatus.BAD_REQUEST,
      )
    }

    const { username, password } = parsed.data
    if (!this.authService.verifyPassword(password)) {
      throw new UnauthorizedException('Invalid password')
    }

    this.authService.issueSession(res, username)
    return { username }
  }

  @Get('session')
  getSession(@Req() req: Request): { username: string } {
    const username = this.authService.readSession(req)
    if (!username) {
      throw new UnauthorizedException()
    }

    return { username }
  }

  @Post('logout')
  logout(@Res({ passthrough: true }) res: Response): { ok: true } {
    this.authService.clearSession(res)
    return { ok: true }
  }
}
