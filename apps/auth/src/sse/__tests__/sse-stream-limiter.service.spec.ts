import {
  DEFAULT_MAX_STREAMS_PER_USER,
  parseMaxStreams,
  SseStreamLimiter,
} from 'src/sse/sse-stream-limiter.service'

const KEY = 'SSE_MAX_STREAMS_PER_USER'

function withEnv<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env[KEY]
  if (value === undefined) delete process.env[KEY]
  else process.env[KEY] = value
  try {
    return fn()
  } finally {
    if (previous === undefined) delete process.env[KEY]
    else process.env[KEY] = previous
  }
}

function fill(limiter: SseStreamLimiter, userId: string): number {
  // Bounded so a broken cap fails the assertion instead of looping forever.
  let taken = 0
  while (taken < 100 && limiter.acquire(userId)) taken++
  return taken
}

describe('SseStreamLimiter', () => {
  it('defaults to 6 streams per user when the env var is unset', () => {
    const limiter = withEnv(undefined, () => new SseStreamLimiter())

    expect(DEFAULT_MAX_STREAMS_PER_USER).toBe(6)
    expect(limiter.cap).toBe(6)
    expect(fill(limiter, 'user_1')).toBe(6)
    expect(limiter.acquire('user_1')).toBeNull()
  })

  it('honours SSE_MAX_STREAMS_PER_USER', () => {
    const limiter = withEnv('2', () => new SseStreamLimiter())

    expect(limiter.cap).toBe(2)
    expect(fill(limiter, 'user_1')).toBe(2)
  })

  it.each(['0', '-1', '2.5', 'abc', '', '   ', '1e3', '99999999999999999999'])(
    'falls back to 6 for the invalid value %p',
    raw => {
      expect(parseMaxStreams(raw)).toBe(6)
      const limiter = withEnv(raw, () => new SseStreamLimiter())
      expect(fill(limiter, 'user_1')).toBe(6)
    },
  )

  it('accepts surrounding whitespace around a valid integer', () => {
    expect(parseMaxStreams(' 12 ')).toBe(12)
    expect(parseMaxStreams(undefined)).toBe(6)
  })

  it('counts each user separately', () => {
    const limiter = withEnv(undefined, () => new SseStreamLimiter())
    fill(limiter, 'user_1')

    expect(limiter.acquire('user_2')).not.toBeNull()
    expect(limiter.openStreams('user_2')).toBe(1)
  })

  it('removes the entry when the count reaches zero', () => {
    const limiter = withEnv(undefined, () => new SseStreamLimiter())
    const a = limiter.acquire('user_1')
    const b = limiter.acquire('user_1')
    expect(limiter.trackedUsers()).toBe(1)

    a?.()
    expect(limiter.openStreams('user_1')).toBe(1)
    b?.()
    expect(limiter.openStreams('user_1')).toBe(0)
    expect(limiter.trackedUsers()).toBe(0)
  })

  it('makes release idempotent: a second call never frees a slot held by another stream', () => {
    const limiter = withEnv(undefined, () => new SseStreamLimiter())
    const first = limiter.acquire('user_1')
    limiter.acquire('user_1')

    first?.()
    first?.()
    first?.()

    expect(limiter.openStreams('user_1')).toBe(1)
  })

  it('frees a slot at the cap once released', () => {
    const limiter = withEnv('1', () => new SseStreamLimiter())
    const release = limiter.acquire('user_1')
    expect(limiter.acquire('user_1')).toBeNull()

    release?.()
    expect(limiter.acquire('user_1')).not.toBeNull()
  })
})
