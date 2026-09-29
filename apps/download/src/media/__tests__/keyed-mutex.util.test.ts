import { KeyedMutex, mediaMutex } from 'src/media/keyed-mutex.util'

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (reason: Error) => void
}

function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Lets every already-queued promise continuation run. */
function flush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve))
}

describe('KeyedMutex', () => {
  let mutex: KeyedMutex

  beforeEach(() => {
    mutex = new KeyedMutex()
  })

  it('returns the value fn resolves with', async () => {
    await expect(mutex.run('a', async () => 42)).resolves.toBe(42)
  })

  it('runs callers sharing a key one at a time, in FIFO order', async () => {
    const events: string[] = []
    const gate0 = deferred()
    const gate1 = deferred()
    const gate2 = deferred()
    const gates = [gate0, gate1, gate2]

    const runs = gates.map((gate, i) =>
      mutex.run('a', async () => {
        events.push(`start ${i}`)
        await gate.promise
        events.push(`end ${i}`)
        return i
      }),
    )

    await flush()
    expect(events).toEqual(['start 0'])

    // Releasing later callers first must not let them jump the queue.
    gate2.resolve()
    gate1.resolve()
    await flush()
    expect(events).toEqual(['start 0'])

    gate0.resolve()
    await expect(Promise.all(runs)).resolves.toEqual([0, 1, 2])
    expect(events).toEqual([
      'start 0',
      'end 0',
      'start 1',
      'end 1',
      'start 2',
      'end 2',
    ])
  })

  it('runs different keys concurrently', async () => {
    const started: string[] = []
    const gateA = deferred()
    const gateB = deferred()

    const runA = mutex.run('a', async () => {
      started.push('a')
      await gateA.promise
    })
    const runB = mutex.run('b', async () => {
      started.push('b')
      await gateB.promise
    })

    await flush()
    expect(started).toEqual(['a', 'b'])
    expect(mutex.size).toBe(2)

    // `b` finishing while `a` is still held proves neither waits on the other.
    gateB.resolve()
    await runB
    expect(mutex.size).toBe(1)

    gateA.resolve()
    await runA
    expect(mutex.size).toBe(0)
  })

  it('releases the lock when fn rejects, failing only that caller', async () => {
    const failing = mutex.run('a', async () => {
      throw new Error('boom')
    })
    const next = mutex.run('a', async () => 'ran')

    await expect(failing).rejects.toThrow('boom')
    await expect(next).resolves.toBe('ran')
    expect(mutex.size).toBe(0)
  })

  it('releases the lock when fn throws synchronously', async () => {
    const failing = mutex.run('a', () => {
      throw new Error('sync boom')
    })
    const next = mutex.run('a', async () => 'ran')

    await expect(failing).rejects.toThrow('sync boom')
    await expect(next).resolves.toBe('ran')
  })

  it('drops a key once its queue drains, and reuses it afterwards', async () => {
    expect(mutex.size).toBe(0)

    const gate = deferred()
    const first = mutex.run('a', () => gate.promise)
    const second = mutex.run('a', async () => undefined)
    expect(mutex.size).toBe(1)

    gate.resolve()
    await first
    // `second` is still queued, so the key must stay held.
    expect(mutex.size).toBe(1)

    await second
    expect(mutex.size).toBe(0)

    await mutex.run('a', async () => undefined)
    expect(mutex.size).toBe(0)
  })

  it('leaves no entries behind after many interleaved keys', async () => {
    const runs = Array.from({ length: 50 }, (_, i) =>
      mutex.run(`key-${i % 5}`, async () => {
        if (i % 7 === 0) {
          throw new Error(`fail ${i}`)
        }
        return i
      }),
    )

    await Promise.allSettled(runs)
    expect(mutex.size).toBe(0)
  })
})

describe('mediaMutex', () => {
  it('is a shared KeyedMutex instance', () => {
    expect(mediaMutex).toBeInstanceOf(KeyedMutex)
  })
})
