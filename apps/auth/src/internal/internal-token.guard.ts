import { createHash, timingSafeEqual } from 'node:crypto'

import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  type OnModuleInit,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Request } from 'express'
import { PinoLogger } from 'nestjs-pino'

import { EnvKeys } from 'src/env'

import {
  INTERNAL_CALLERS,
  INTERNAL_SCOPES,
  type InternalScope,
} from './internal-callers'

// ──────────────────────────────────────────────────────────────────────────────
// Bearer-token guard for this app's internal (server-to-server) routes:
// /admin/check and /internal/*. Port 8081 has no Traefik router and publishes
// no port, so only containers on the shared Docker network reach these — but
// that is every container, not just the callers that need them. The token
// says WHICH caller is asking; the handler's scope says whether that caller
// may.
//
// Two modes. With INTERNAL_TOKEN_ENFORCE exactly `true`, a missing or unknown
// token is 401 and a known caller without the scope is 403. Otherwise every
// request is allowed and only logged, so callers can be rolled out first and
// the log checked before anything is rejected.
//
// Never throws at startup: a boot failure here would take down /verify and
// with it every gated site. A bad configuration disables callers instead.
// ──────────────────────────────────────────────────────────────────────────────

export const INTERNAL_SCOPE_KEY = 'lilnas:internal-scope'

export const RequireInternalScope = (scope: InternalScope): MethodDecorator =>
  SetMetadata(INTERNAL_SCOPE_KEY, scope)

export type InternalAuthOutcome = 'ok' | 'missing' | 'invalid' | 'forbidden'

// Shorter than this and a caller is disabled rather than matched.
export const MIN_INTERNAL_TOKEN_LENGTH = 32

// Scheme case-insensitive, exactly one space, a non-empty token with no
// whitespace. Anything else is `invalid`.
const BEARER = /^bearer ([^\s]+)$/i

// process.env, or a plain object in a spec.
export type EnvSource = Readonly<Record<string, string | undefined>>

type ConfiguredCaller = { name: string; digest: Buffer }

type CallerConfig = {
  callers: ConfiguredCaller[]
  // Callers disabled because they share a token value with another caller.
  duplicates: string[][]
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

// Builds the matchable callers from the current env. A caller whose token is
// unset or too short is left out; callers sharing one value are all left out.
export function resolveCallerConfig(
  source: EnvSource = process.env,
): CallerConfig {
  const byValue = new Map<string, string[]>()
  for (const [name, caller] of Object.entries(INTERNAL_CALLERS)) {
    const value = source[caller.tokenEnv]
    if (value === undefined || value.length < MIN_INTERNAL_TOKEN_LENGTH) {
      continue
    }
    byValue.set(value, [...(byValue.get(value) ?? []), name])
  }

  const callers: ConfiguredCaller[] = []
  const duplicates: string[][] = []
  for (const [value, names] of byValue) {
    const [name, ...others] = names
    if (name === undefined) {
      continue
    }
    if (others.length > 0) {
      duplicates.push(names)
      continue
    }
    callers.push({ name, digest: sha256(value) })
  }
  return { callers, duplicates }
}

export function isEnforcing(source: EnvSource = process.env): boolean {
  return source[EnvKeys.INTERNAL_TOKEN_ENFORCE] === 'true'
}

// The caller whose token equals `presented`, compared in constant time over
// SHA-256 digests. Every configured caller is compared, match or not, so the
// time taken does not say which caller (if any) matched.
function matchCaller(
  presented: string,
  callers: ConfiguredCaller[],
): string | null {
  const presentedDigest = sha256(presented)
  let matched: string | null = null
  for (const caller of callers) {
    if (timingSafeEqual(presentedDigest, caller.digest)) {
      matched = caller.name
    }
  }
  return matched
}

function isInternalScope(value: unknown): value is InternalScope {
  return (
    typeof value === 'string' &&
    (INTERNAL_SCOPES as readonly string[]).includes(value)
  )
}

@Injectable()
export class InternalTokenGuard implements CanActivate, OnModuleInit {
  constructor(
    private readonly reflector: Reflector,
    private readonly logger: PinoLogger,
  ) {}

  onModuleInit(): void {
    for (const names of resolveCallerConfig().duplicates) {
      // Names only, never the shared value.
      this.logger.error(
        { event: 'internal-auth-config', duplicateCallers: names },
        'internal-auth: callers share one token; all of them are disabled',
      )
    }
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>()
    const rawScope: unknown = this.reflector.get(
      INTERNAL_SCOPE_KEY,
      context.getHandler(),
    )
    const scope = isInternalScope(rawScope) ? rawScope : null
    const enforced = isEnforcing()

    const { outcome, caller } = this.authenticate(
      req.headers.authorization,
      scope,
    )

    const line = {
      event: 'internal-auth',
      outcome,
      caller,
      scope,
      enforced,
      remoteAddress: req.socket?.remoteAddress ?? null,
    }
    if (outcome === 'ok') {
      this.logger.info(line, 'internal-auth: ok')
    } else {
      this.logger.warn(line, `internal-auth: ${outcome}`)
    }

    if (!enforced || outcome === 'ok') {
      return true
    }
    if (outcome === 'forbidden') {
      throw new ForbiddenException()
    }
    throw new UnauthorizedException()
  }

  private authenticate(
    header: string | undefined,
    scope: InternalScope | null,
  ): { outcome: InternalAuthOutcome; caller: string | null } {
    if (header === undefined) {
      return { outcome: 'missing', caller: null }
    }
    const token = BEARER.exec(header)?.[1]
    if (token === undefined) {
      return { outcome: 'invalid', caller: null }
    }
    const caller = matchCaller(token, resolveCallerConfig().callers)
    if (caller === null) {
      return { outcome: 'invalid', caller: null }
    }
    // No scope metadata on a guarded handler is forbidden for everyone.
    const scopes = INTERNAL_CALLERS[caller]?.scopes ?? []
    if (scope === null || !scopes.includes(scope)) {
      return { outcome: 'forbidden', caller }
    }
    return { outcome: 'ok', caller }
  }
}
