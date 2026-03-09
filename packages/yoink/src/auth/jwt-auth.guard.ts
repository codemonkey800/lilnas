import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { eq } from 'drizzle-orm'
import type { Request } from 'express'

import { db } from 'src/db'
import { users } from 'src/db/schema'
import { EnvKeys } from 'src/env'

import { AUTH_TOKEN_COOKIE } from './constants'

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const token = request.cookies?.[AUTH_TOKEN_COOKIE]

    if (!token) throw new UnauthorizedException()

    let payload: { sub: string; email: string }
    try {
      payload = await this.jwtService.verifyAsync(token)
      request['user'] = payload
    } catch {
      throw new UnauthorizedException()
    }

    const user = await db.query.users.findFirst({
      where: eq(users.id, payload.sub),
      columns: { status: true, email: true },
    })

    const isAdmin = user?.email === process.env[EnvKeys.ADMIN_EMAIL]
    if (!user || (user.status !== 'approved' && !isAdmin)) {
      throw new ForbiddenException()
    }

    return true
  }
}
