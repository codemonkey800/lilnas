import { AsyncLocalStorage } from 'node:async_hooks'

export interface RequestContext {
  requestId: string
  userId?: string
  channelId?: string
  guildId?: string
  skill?: string
}

export const requestContext = new AsyncLocalStorage<RequestContext>()

/** Runs `fn` with `ctx` as the active request context (copied, so nested
 * runs and field updates never leak into the caller's object). */
export function runWithRequestContext<T>(
  ctx: RequestContext,
  fn: () => Promise<T>,
): Promise<T> {
  return requestContext.run({ ...ctx }, fn)
}

export function getRequestContext(): RequestContext | undefined {
  return requestContext.getStore()
}

/** Sets a field on the active context; no-op outside a request. */
export function setRequestContextField<K extends keyof RequestContext>(
  key: K,
  value: RequestContext[K],
): void {
  const store = requestContext.getStore()
  if (store) store[key] = value
}

/** pino `mixin`: merges the active request context into every log line. */
export function requestContextMixin(): Record<string, unknown> {
  return { ...getRequestContext() }
}
