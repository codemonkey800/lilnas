import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { Request } from 'express'

import { AUTH_TOKEN_COOKIE } from './constants'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const token = request.cookies?.[AUTH_TOKEN_COOKIE]

    if (!token) throw new UnauthorizedException()

    try {
      request['user'] = await this.jwtService.verifyAsync(token)
    } catch {
      throw new UnauthorizedException()
    }

    return true
  }
}
