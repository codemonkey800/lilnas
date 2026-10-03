import {
  getRequestContext,
  requestContextMixin,
  runWithRequestContext,
  setRequestContextField,
} from 'src/llm/observability/request-context'

describe('request context', () => {
  it('is undefined outside a run', () => {
    expect(getRequestContext()).toBeUndefined()
    expect(requestContextMixin()).toEqual({})
    expect(() => setRequestContextField('skill', 'x')).not.toThrow()
  })

  it('exposes the context across awaits', async () => {
    await runWithRequestContext({ requestId: 'r1', userId: 'u' }, async () => {
      await Promise.resolve()
      expect(getRequestContext()).toEqual({ requestId: 'r1', userId: 'u' })
    })
  })

  it('nests and restores the outer context', async () => {
    await runWithRequestContext({ requestId: 'outer' }, async () => {
      await runWithRequestContext({ requestId: 'inner' }, async () => {
        expect(getRequestContext()?.requestId).toBe('inner')
      })
      expect(getRequestContext()?.requestId).toBe('outer')
    })
  })

  it('setRequestContextField mutates only the active context', async () => {
    const original = { requestId: 'r' }
    await runWithRequestContext(original, async () => {
      setRequestContextField('skill', 'math')
      expect(getRequestContext()?.skill).toBe('math')
    })
    expect(original).toEqual({ requestId: 'r' })
  })

  it('mixin output contains requestId', async () => {
    await runWithRequestContext(
      { requestId: 'abc', channelId: 'c1' },
      async () => {
        expect(requestContextMixin()).toMatchObject({
          requestId: 'abc',
          channelId: 'c1',
        })
      },
    )
  })
})
