import { ExecutionContext, UnauthorizedException } from '@nestjs/common'

import { GrafanaWebhookGuard } from 'src/alerts/grafana-webhook.guard'

const TOKEN = 'a'.repeat(64)

function contextWithHeaders(
  headers: Record<string, string | undefined>,
): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
  } as unknown as ExecutionContext
}

describe('GrafanaWebhookGuard', () => {
  const guard = new GrafanaWebhookGuard()
  const originalToken = process.env.GRAFANA_WEBHOOK_TOKEN

  beforeEach(() => {
    process.env.GRAFANA_WEBHOOK_TOKEN = TOKEN
  })

  afterAll(() => {
    if (originalToken === undefined) delete process.env.GRAFANA_WEBHOOK_TOKEN
    else process.env.GRAFANA_WEBHOOK_TOKEN = originalToken
  })

  it('rejects a request with no Authorization header', () => {
    expect(() => guard.canActivate(contextWithHeaders({}))).toThrow(
      UnauthorizedException,
    )
  })

  it('rejects a wrong token of a different length', () => {
    const context = contextWithHeaders({ authorization: 'Bearer nope' })

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('rejects a wrong token of the same length', () => {
    const context = contextWithHeaders({
      authorization: `Bearer ${'b'.repeat(64)}`,
    })

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('rejects the right token under a non-Bearer scheme', () => {
    const context = contextWithHeaders({ authorization: `Basic ${TOKEN}` })

    expect(() => guard.canActivate(context)).toThrow(UnauthorizedException)
  })

  it('passes the right bearer token', () => {
    const context = contextWithHeaders({ authorization: `Bearer ${TOKEN}` })

    expect(guard.canActivate(context)).toBe(true)
  })

  it('accepts a case-insensitive scheme', () => {
    const context = contextWithHeaders({ authorization: `bearer ${TOKEN}` })

    expect(guard.canActivate(context)).toBe(true)
  })

  it('rejects every request when the token env is unset', () => {
    delete process.env.GRAFANA_WEBHOOK_TOKEN

    expect(() =>
      guard.canActivate(contextWithHeaders({ authorization: 'Bearer ' })),
    ).toThrow(UnauthorizedException)
    expect(() =>
      guard.canActivate(
        contextWithHeaders({ authorization: `Bearer ${TOKEN}` }),
      ),
    ).toThrow(UnauthorizedException)
  })

  it('rejects every request when the token env is empty', () => {
    process.env.GRAFANA_WEBHOOK_TOKEN = ''

    expect(() =>
      guard.canActivate(contextWithHeaders({ authorization: 'Bearer x' })),
    ).toThrow(UnauthorizedException)
  })
})
