import {
  Controller,
  Get,
  NotFoundException,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import { AuthGuard } from '@nestjs/passport'
import type { Request, Response } from 'express'

import { EnvKeys } from 'src/env'

import { AuthService } from './auth.service'
import { AUTH_TOKEN_COOKIE, OAUTH_RETURN_TO_COOKIE } from './constants'
import { JwtAuthGuard } from './jwt-auth.guard'

const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000 // 24h

function isRelativePath(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('/')
}

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  /**
   * Initiates the Google OAuth flow. ReturnToMiddleware (registered in
   * AuthModule) sets the oauth_return_to cookie before this guard fires.
   * Passport sends the 302 to Google — this controller body never executes.
   */
  @Get('google')
  @UseGuards(AuthGuard('google'))
  googleInit() {
    // Intentionally empty — Passport redirects before this runs.
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleCallback(
    @Req() req: Request & { user?: { id: string; email: string } },
    @Res() res: Response,
  ): Promise<void> {
    const user = req.user!
    const token = await this.authService.login(user)

    const returnTo = isRelativePath(req.cookies?.[OAUTH_RETURN_TO_COOKIE])
      ? req.cookies[OAUTH_RETURN_TO_COOKIE]
      : '/'

    const isProd = process.env[EnvKeys.NODE_ENV] === 'production'

    res.clearCookie(OAUTH_RETURN_TO_COOKIE)
    res.cookie(AUTH_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    })

    res.redirect(returnTo)
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@Req() req: Request & { user?: Record<string, unknown> }) {
    return req.user
  }

  @Get('agent-login')
  async agentLogin(
    @Query('key') key: string | undefined,
    @Query('return_to') returnTo: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const agentApiKey = process.env[EnvKeys.AGENT_API_KEY]

    if (!agentApiKey) throw new NotFoundException()
    if (key !== agentApiKey) throw new UnauthorizedException()

    const user = await this.authService.findOrCreateAgentUser()
    const token = await this.authService.login({
      id: user.id,
      email: user.email!,
    })

    const isProd = process.env[EnvKeys.NODE_ENV] === 'production'

    res.cookie(AUTH_TOKEN_COOKIE, token, {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    })

    const destination = isRelativePath(returnTo) ? returnTo : '/'
    res.redirect(destination)
  }

  @Get('logout')
  logout(@Res() res: Response): void {
    res.clearCookie(AUTH_TOKEN_COOKIE, { path: '/' })
    res.redirect('/login')
  }
}
