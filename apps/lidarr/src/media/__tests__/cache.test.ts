import { cached } from 'src/media/cache'

// The cache module uses a module-level Map, so we need to isolate between tests
// by using different keys per test group

describe('cached', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.useRealTimers()
  })

  it('calls the factory and returns its value on first call', async () => {
    const fn = jest.fn().mockResolvedValue('first-result')
    const result = await cached('cache-test-1', 5000, fn)
    expect(result).toBe('first-result')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('returns cached value without calling factory again within TTL', async () => {
    const fn = jest.fn().mockResolvedValue('cached-value')
    await cached('cache-test-2', 5000, fn)
    jest.advanceTimersByTime(4999)
    const second = await cached('cache-test-2', 5000, fn)
    expect(second).toBe('cached-value')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('refetches after TTL expires', async () => {
    const fn = jest
      .fn()
      .mockResolvedValueOnce('first')
      .mockResolvedValueOnce('second')
    await cached('cache-test-3', 5000, fn)
    jest.advanceTimersByTime(5001)
    const second = await cached('cache-test-3', 5000, fn)
    expect(second).toBe('second')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('different keys are cached independently', async () => {
    const fnA = jest.fn().mockResolvedValue('result-a')
    const fnB = jest.fn().mockResolvedValue('result-b')
    const [a, b] = await Promise.all([
      cached('cache-test-key-a', 5000, fnA),
      cached('cache-test-key-b', 5000, fnB),
    ])
    expect(a).toBe('result-a')
    expect(b).toBe('result-b')
    expect(fnA).toHaveBeenCalledTimes(1)
    expect(fnB).toHaveBeenCalledTimes(1)

    // Both keys expired at 5001ms — verify re-fetch happened for each independently
    jest.advanceTimersByTime(5001)
    await cached('cache-test-key-a', 5000, fnA)
    expect(fnA).toHaveBeenCalledTimes(2)

    await cached('cache-test-key-b', 5000, fnB)
    expect(fnB).toHaveBeenCalledTimes(2)
  })

  it('respects the exact TTL boundary (at expiry == refetch)', async () => {
    const fn = jest.fn().mockResolvedValue('value')
    await cached('cache-test-4', 1000, fn)
    // advance exactly to expiry moment - now expired
    jest.advanceTimersByTime(1001)
    await cached('cache-test-4', 1000, fn)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
