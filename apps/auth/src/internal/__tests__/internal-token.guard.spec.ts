import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { Reflector } from '@nestjs/core'
import type { PinoLogger } from 'nestjs-pino'

import { AdminController } from 'src/admin/admin.controller'
import { AdminGuard } from 'src/admin/admin.guard'
import { AdminCheckController } from 'src/admin/admin-check.controller'
import { AppModule } from 'src/app.module'
import {
  DiscordIdentityController,
  DiscordLinkLookupController,
} from 'src/internal/discord-internal.controller'
import { HostActivityController } from 'src/internal/host-activity.controller'
import {
  INTERNAL_CALLERS,
  INTERNAL_SCOPES,
} from 'src/internal/internal-callers'
import {
  INTERNAL_SCOPE_KEY,
  InternalTokenGuard,
  isEnforcing,
  resolveCallerConfig,
} from 'src/internal/internal-token.guard'
import { MeController } from 'src/me/me.controller'
import { RequestsController } from 'src/requests/requests.controller'
import { SseController } from 'src/sse/sse.controller'
import { StripCookieController } from 'src/verify/strip-cookie.controller'
import { VerifyController } from 'src/verify/verify.controller'

type Ctor = abstract new (...args: never[]) => unknown

const GUARDED: Ctor[] = [
  AdminCheckController,
  DiscordLinkLookupController,
  DiscordIdentityController,
  HostActivityController,
]

// Route handlers: prototype methods carrying Nest's route path metadata.
function handlers(controller: Ctor): [string, unknown][] {
  const proto = controller.prototype as Record<string, unknown>
  return Object.getOwnPropertyNames(proto)
    .filter(name => name !== 'constructor')
    .map(name => [name, proto[name]] as [string, unknown])
    .filter(
      ([, fn]) =>
        typeof fn === 'function' &&
        Reflect.getMetadata(PATH_METADATA, fn) !== undefined,
    )
}

function classGuards(controller: Ctor): unknown[] {
  return Reflect.getMetadata(GUARDS_METADATA, controller) ?? []
}

const TOKEN = 'z'.repeat(40)

describe('internal route contract', () => {
  it('the scope table equals the contract', () => {
    expect([...INTERNAL_SCOPES]).toEqual([
      'admin-check',
      'discord-link:read',
      'discord-identity:write',
      'host-activity:read',
    ])
  })

  it('the caller table equals the contract', () => {
    expect(INTERNAL_CALLERS).toEqual({
      download: {
        tokenEnv: 'INTERNAL_TOKEN_DOWNLOAD',
        scopes: ['admin-check', 'discord-link:read', 'discord-identity:write'],
      },
      'icloud-backup': {
        tokenEnv: 'INTERNAL_TOKEN_ICLOUD_BACKUP',
        scopes: ['admin-check'],
      },
      dev: { tokenEnv: 'INTERNAL_TOKEN_DEV', scopes: ['host-activity:read'] },
      'dev-idle-reaper': {
        tokenEnv: 'INTERNAL_TOKEN_DEV_IDLE_REAPER',
        scopes: ['host-activity:read'],
      },
    })
  })

  it.each(GUARDED.map(c => [c.name, c] as const))(
    '%s is guarded by InternalTokenGuard and every handler has a scope',
    (_name, controller) => {
      expect(classGuards(controller)).toEqual([InternalTokenGuard])
      const routes = handlers(controller)
      expect(routes.length).toBeGreaterThan(0)
      for (const [, fn] of routes) {
        const scope: unknown = Reflect.getMetadata(
          INTERNAL_SCOPE_KEY,
          fn as object,
        )
        expect(INTERNAL_SCOPES).toContain(scope)
      }
    },
  )

  it('each guarded route carries the scope the contract names', () => {
    const scopeOf = (controller: Ctor, method: string): unknown =>
      Reflect.getMetadata(
        INTERNAL_SCOPE_KEY,
        (controller.prototype as Record<string, object>)[method]!,
      )

    expect(scopeOf(AdminCheckController, 'check')).toBe('admin-check')
    expect(scopeOf(DiscordLinkLookupController, 'discordLink')).toBe(
      'discord-link:read',
    )
    expect(scopeOf(DiscordIdentityController, 'registerIdentity')).toBe(
      'discord-identity:write',
    )
    expect(scopeOf(HostActivityController, 'hostActivityFor')).toBe(
      'host-activity:read',
    )
  })

  it('AdminController keeps AdminGuard only', () => {
    expect(classGuards(AdminController)).toEqual([AdminGuard])
  })

  it.each(
    [
      VerifyController,
      StripCookieController,
      MeController,
      RequestsController,
      SseController,
    ].map(c => [c.name, c] as const),
  )('%s takes no token guard', (_name, controller) => {
    expect(classGuards(controller)).not.toContain(InternalTokenGuard)
    for (const [, fn] of handlers(controller)) {
      const guards: unknown[] =
        Reflect.getMetadata(GUARDS_METADATA, fn as object) ?? []
      expect(guards).not.toContain(InternalTokenGuard)
    }
  })

  it('AppModule provides the guard', () => {
    const providers: unknown[] =
      Reflect.getMetadata('providers', AppModule) ?? []

    expect(providers).toContain(InternalTokenGuard)
  })
})

describe('resolveCallerConfig', () => {
  const full = {
    INTERNAL_TOKEN_DOWNLOAD: 'a'.repeat(32),
    INTERNAL_TOKEN_ICLOUD_BACKUP: 'b'.repeat(32),
    INTERNAL_TOKEN_DEV: 'c'.repeat(32),
    INTERNAL_TOKEN_DEV_IDLE_REAPER: 'd'.repeat(32),
  }

  it('enables every caller with a token of at least 32 characters', () => {
    expect(resolveCallerConfig(full).callers.map(c => c.name)).toEqual([
      'download',
      'icloud-backup',
      'dev',
      'dev-idle-reaper',
    ])
  })

  it('leaves out unset and short tokens', () => {
    const config = resolveCallerConfig({
      ...full,
      INTERNAL_TOKEN_DEV: undefined,
      INTERNAL_TOKEN_ICLOUD_BACKUP: 'b'.repeat(31),
    })

    expect(config.callers.map(c => c.name)).toEqual([
      'download',
      'dev-idle-reaper',
    ])
  })

  it('disables every caller that shares a value and reports them', () => {
    const config = resolveCallerConfig({
      ...full,
      INTERNAL_TOKEN_DEV_IDLE_REAPER: full.INTERNAL_TOKEN_DEV,
    })

    expect(config.callers.map(c => c.name)).toEqual([
      'download',
      'icloud-backup',
    ])
    expect(config.duplicates).toEqual([['dev', 'dev-idle-reaper']])
  })
})

describe('isEnforcing', () => {
  it.each([
    ['true', true],
    ['TRUE', false],
    ['1', false],
    ['', false],
    [undefined, false],
  ])('%j -> %s', (value, expected) => {
    expect(isEnforcing({ INTERNAL_TOKEN_ENFORCE: value })).toBe(expected)
  })
})

describe('InternalTokenGuard startup', () => {
  const ORIGINAL = {
    dev: process.env.INTERNAL_TOKEN_DEV,
    reaper: process.env.INTERNAL_TOKEN_DEV_IDLE_REAPER,
  }

  afterEach(() => {
    for (const [key, value] of [
      ['INTERNAL_TOKEN_DEV', ORIGINAL.dev],
      ['INTERNAL_TOKEN_DEV_IDLE_REAPER', ORIGINAL.reaper],
    ] as const) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  function makeGuard() {
    const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
    const guard = new InternalTokenGuard(
      new Reflector(),
      logger as unknown as PinoLogger,
    )
    return { guard, logger }
  }

  it('logs one error naming the callers, never the value, and does not throw', () => {
    process.env.INTERNAL_TOKEN_DEV = TOKEN
    process.env.INTERNAL_TOKEN_DEV_IDLE_REAPER = TOKEN
    const { guard, logger } = makeGuard()

    expect(() => guard.onModuleInit()).not.toThrow()
    expect(logger.error).toHaveBeenCalledTimes(1)
    expect(logger.error.mock.calls[0]?.[0]).toMatchObject({
      duplicateCallers: ['dev', 'dev-idle-reaper'],
    })
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain(TOKEN)
  })

  it('logs nothing when every token is distinct or unset', () => {
    process.env.INTERNAL_TOKEN_DEV = TOKEN
    delete process.env.INTERNAL_TOKEN_DEV_IDLE_REAPER
    const { guard, logger } = makeGuard()

    guard.onModuleInit()

    expect(logger.error).not.toHaveBeenCalled()
  })
})
