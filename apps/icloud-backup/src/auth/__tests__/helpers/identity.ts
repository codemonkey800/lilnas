import type { ExecutionContext } from '@nestjs/common'
import type { IncomingHttpHeaders } from 'http'

export const ENV_KEYS = ['NODE_ENV', 'DEV_USER_EMAIL', 'DEV_USER_ID'] as const

// `process.env.NODE_ENV` is typed readonly, so tests replace the whole object.
export function setEnv(overrides: Record<string, string | undefined>): void {
  const next: Record<string, string | undefined> = { ...process.env }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete next[key]
    } else {
      next[key] = value
    }
  }
  process.env = next as typeof process.env
}

export function fakeContext(headers: IncomingHttpHeaders): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext
}

export const USER_HEADERS = {
  'x-forwarded-user': 'alice@example.com',
  'x-forwarded-user-id': 'user_1',
}
