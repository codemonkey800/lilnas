import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { eq } from 'drizzle-orm'
import type { Request } from 'express'

import { db } from 'src/db'
import { users } from 'src/db/schema'
import { EnvKeys } from 'src/env'

import { AUTH_TOKEN_COOKIE } from './constants'

interface JwtPayload {
  sub: string
  email: string
}

interface CachedUser {
  status: string
  email: string | null
  expiresAt: number
}

const USER_CACHE_TTL_MS = 60_000

@Injectable()
export class JwtAuthGuard implements CanActivate {
  private readonly userCache = new Map<string, CachedUser>()

  constructor(private jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>()
    const token = request.cookies?.[AUTH_TOKEN_COOKIE]

    if (!token) throw new UnauthorizedException()

    let payload: JwtPayload
    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token)
      request.user = payload
    } catch {
      throw new UnauthorizedException()
    }

    const cached = this.userCache.get(payload.sub)
    if (cached && Date.now() < cached.expiresAt) {
      const isAdmin = cached.email === process.env[EnvKeys.ADMIN_EMAIL]
      if (cached.status !== 'approved' && !isAdmin) {
        throw new ForbiddenException()
      }
      return true
    }

    let user: { status: string; email: string | null } | undefined
    try {
      user = await db.query.users.findFirst({
        where: eq(users.id, payload.sub),
        columns: { status: true, email: true },
      })
    } catch (err) {
      throw new InternalServerErrorException(
        'Database unavailable',
        err instanceof Error ? err.message : String(err),
      )
    }

    if (!user) throw new ForbiddenException()

    this.userCache.set(payload.sub, {
      status: user.status,
      email: user.email ?? null,
      expiresAt: Date.now() + USER_CACHE_TTL_MS,
    })

    const isAdmin = user.email === process.env[EnvKeys.ADMIN_EMAIL]
    if (user.status !== 'approved' && !isAdmin) {
      throw new ForbiddenException()
    }

    return true
  }
}
