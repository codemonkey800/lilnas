import {
  QueryClient,
  QueryClientProvider,
  useMutation,
} from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { type ReactNode } from 'react'

import { createQueryClient } from 'src/app/providers'

// logToServer only ever calls .catch() on fetch's return value — see
// browser-logger.spec.tsx's identical mock/rationale.
const mockFetch = jest.fn()

beforeEach(() => {
  mockFetch.mockReset().mockResolvedValue(undefined)
  global.fetch = mockFetch as unknown as typeof fetch
})

function loggedBodies() {
  return mockFetch.mock.calls.map(call => JSON.parse(call[1]?.body as string))
}

function mountMutation(
  client: QueryClient,
  mutationKey: string[],
  mutationFn: () => Promise<unknown>,
) {
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
  return renderHook(() => useMutation({ mutationKey, mutationFn }), {
    wrapper,
  })
}

describe('createQueryClient — QueryCache logging', () => {
  it('logs a query-error event for a failing query, with the error message as msg', async () => {
    const client = createQueryClient()

    await client
      .fetchQuery({
        queryKey: ['test-query-a'],
        queryFn: () => Promise.reject(new Error('boom')),
        retry: false,
      })
      .catch(() => {})

    const bodies = loggedBodies()
    expect(bodies).toHaveLength(1)
    expect(bodies[0].level).toBe('warn')
    expect(bodies[0].event).toBe('query-error')
    // The raw error message now lives in the top-level `message` field
    // (the logToServer `msg` argument), not nested under context.
    expect(bodies[0].message).toBe('boom')
    expect(bodies[0].context).toEqual({
      queryKey: ['test-query-a'],
    })
  })

  it('does not re-log an identical failure on a repeated fetch of the same query', async () => {
    const client = createQueryClient()
    const queryKey = ['test-query-b']
    const fail = () => Promise.reject(new Error('boom'))

    await client
      .fetchQuery({ queryKey, queryFn: fail, retry: false })
      .catch(() => {})
    await client
      .fetchQuery({ queryKey, queryFn: fail, retry: false })
      .catch(() => {})

    expect(loggedBodies()).toHaveLength(1)
  })

  it('logs again when the failure message changes', async () => {
    const client = createQueryClient()
    const queryKey = ['test-query-c']

    await client
      .fetchQuery({
        queryKey,
        queryFn: () => Promise.reject(new Error('first')),
        retry: false,
      })
      .catch(() => {})
    await client
      .fetchQuery({
        queryKey,
        queryFn: () => Promise.reject(new Error('second')),
        retry: false,
      })
      .catch(() => {})

    const bodies = loggedBodies()
    expect(bodies).toHaveLength(2)
    expect(bodies[1].message).toBe('second')
  })

  it('clears the dedup entry on success, so an identical later failure logs again', async () => {
    const client = createQueryClient()
    const queryKey = ['test-query-d']
    const fail = () => Promise.reject(new Error('boom'))

    await client
      .fetchQuery({ queryKey, queryFn: fail, retry: false })
      .catch(() => {})
    // staleTime: 0 forces this call to actually re-run rather than return
    // the (about-to-exist) fresh cached success from the default 10s
    // staleTime configured in createQueryClient().
    await client.fetchQuery({
      queryKey,
      queryFn: () => Promise.resolve('ok'),
      staleTime: 0,
    })
    await client
      .fetchQuery({ queryKey, queryFn: fail, retry: false, staleTime: 0 })
      .catch(() => {})

    const errorBodies = loggedBodies().filter(b => b.event === 'query-error')
    expect(errorBodies).toHaveLength(2)
  })

  it('caps an oversized query error message before sending it', async () => {
    const client = createQueryClient()
    const oversized = 'z'.repeat(1000)

    await client
      .fetchQuery({
        queryKey: ['test-query-cap'],
        queryFn: () => Promise.reject(new Error(oversized)),
        retry: false,
      })
      .catch(() => {})

    const bodies = loggedBodies()
    expect(bodies).toHaveLength(1)
    expect(bodies[0].message.length).toBeLessThanOrEqual(300)
    expect(bodies[0].message.length).toBeLessThan(oversized.length)
  })
})

describe('createQueryClient — MutationCache logging', () => {
  it('logs a mutation-error event for a failing mutation, with the error message as msg', async () => {
    const client = createQueryClient()
    const { result } = mountMutation(client, ['test-mutation-a'], () =>
      Promise.reject(new Error('boom')),
    )

    result.current.mutate(undefined)
    await waitFor(() => expect(result.current.isError).toBe(true))

    const bodies = loggedBodies()
    expect(bodies).toHaveLength(1)
    expect(bodies[0].level).toBe('warn')
    expect(bodies[0].event).toBe('mutation-error')
    expect(bodies[0].message).toBe('boom')
    expect(bodies[0].context).toEqual({
      mutationKey: ['test-mutation-a'],
    })
  })

  it('logs a mutation-success event for a succeeding mutation', async () => {
    const client = createQueryClient()
    const { result } = mountMutation(client, ['test-mutation-b'], () =>
      Promise.resolve('ok'),
    )

    result.current.mutate(undefined)
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const bodies = loggedBodies()
    expect(bodies).toHaveLength(1)
    expect(bodies[0].level).toBe('info')
    expect(bodies[0].event).toBe('mutation-success')
    expect(bodies[0].message).toBe('mutation-success')
    expect(bodies[0].context).toEqual({ mutationKey: ['test-mutation-b'] })
  })

  it('does not re-log an identical failure from repeated mutation attempts', async () => {
    const client = createQueryClient()
    const { result } = mountMutation(client, ['test-mutation-c'], () =>
      Promise.reject(new Error('boom')),
    )

    await result.current.mutateAsync(undefined).catch(() => {})
    await waitFor(() => expect(result.current.isError).toBe(true))

    await result.current.mutateAsync(undefined).catch(() => {})

    expect(loggedBodies()).toHaveLength(1)
  })
})
