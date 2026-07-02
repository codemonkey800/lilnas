import { GitWriteLock } from 'src/agent/git-write-lock'

describe('GitWriteLock', () => {
  it('immediately resolves acquire for the first caller', async () => {
    const lock = new GitWriteLock()
    const release = await Promise.race([
      lock.acquire('ch1'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout')), 50),
      ),
    ])
    expect(typeof release).toBe('function')
    expect(lock.currentHolder).toBe('ch1')
    release()
    expect(lock.currentHolder).toBeNull()
  })

  it('second acquire waits until first releases', async () => {
    const lock = new GitWriteLock()
    const events: string[] = []

    const r1 = await lock.acquire('ch1')
    events.push('ch1:acquired')

    // Start ch2 but do not await yet
    const ch2Promise = lock.acquire('ch2').then(r2 => {
      events.push('ch2:acquired')
      r2()
      events.push('ch2:released')
    })

    // ch2 should be waiting
    expect(lock.currentHolder).toBe('ch1')
    expect(events).toEqual(['ch1:acquired'])

    r1()
    events.push('ch1:released')

    await ch2Promise

    expect(events).toEqual([
      'ch1:acquired',
      'ch1:released',
      'ch2:acquired',
      'ch2:released',
    ])
  })

  it('releases in FIFO order with N queued acquirers', async () => {
    const lock = new GitWriteLock()
    const order: string[] = []
    const CHANNELS = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5']

    const r1 = await lock.acquire(CHANNELS[0]!)

    // Queue all others before releasing ch1
    const promises = CHANNELS.slice(1).map(ch =>
      lock.acquire(ch).then(rel => {
        order.push(ch)
        rel()
      }),
    )

    r1()
    await Promise.all(promises)

    expect(order).toEqual(CHANNELS.slice(1))
  })

  it('releaseIfHeldBy releases when channelId matches holder', async () => {
    const lock = new GitWriteLock()
    await lock.acquire('ch1')
    expect(lock.currentHolder).toBe('ch1')

    lock.releaseIfHeldBy('ch1')
    expect(lock.currentHolder).toBeNull()
  })

  it('releaseIfHeldBy is a no-op when channelId does not match', async () => {
    const lock = new GitWriteLock()
    const r1 = await lock.acquire('ch1')
    expect(lock.currentHolder).toBe('ch1')

    lock.releaseIfHeldBy('ch2') // ch2 does not hold
    expect(lock.currentHolder).toBe('ch1')

    r1() // clean up
  })

  it('releaseIfHeldBy unblocks the next queued acquirer', async () => {
    const lock = new GitWriteLock()
    const events: string[] = []

    await lock.acquire('ch1')

    const ch2 = lock.acquire('ch2').then(r2 => {
      events.push('ch2:acquired')
      r2()
    })

    lock.releaseIfHeldBy('ch1')
    await ch2

    expect(events).toContain('ch2:acquired')
    expect(lock.currentHolder).toBeNull()
  })

  it('double-release via both release fn and releaseIfHeldBy is idempotent', async () => {
    const lock = new GitWriteLock()
    const r1 = await lock.acquire('ch1')

    r1() // first release
    lock.releaseIfHeldBy('ch1') // second release — should be a no-op

    expect(lock.currentHolder).toBeNull()
    // No queued items left in an inconsistent state
    expect(lock.acquire('ch2')).resolves.toBeTruthy()
  })

  it('cancelWaiter removes a queued waiter — the holder release passes to the next real waiter, never the cancelled one', async () => {
    const lock = new GitWriteLock()
    const order: string[] = []

    const r1 = await lock.acquire('ch1')

    // Queue ch2 (to be cancelled) then ch3 (should be granted next).
    const ch2Promise = lock.acquire('ch2').then(r2 => {
      order.push('ch2:acquired')
      r2()
    })
    const ch3Promise = lock.acquire('ch3').then(r3 => {
      order.push('ch3:acquired')
      r3()
    })

    lock.cancelWaiter('ch2')

    r1()
    await ch3Promise

    // ch2 was spliced out of the queue — it never acquires.
    expect(order).toEqual(['ch3:acquired'])
    expect(lock.currentHolder).toBeNull()

    // ch2's acquire() promise never settles now that it was cancelled —
    // race it against a short timeout to prove it, then clean up.
    const ch2Settled = await Promise.race([
      ch2Promise.then(() => true),
      new Promise<boolean>(resolve => setTimeout(() => resolve(false), 20)),
    ])
    expect(ch2Settled).toBe(false)
  })

  it('cancelWaiter goes to idle (no queued waiters left) when the only waiter is cancelled', async () => {
    const lock = new GitWriteLock()
    const r1 = await lock.acquire('ch1')

    const ch2Promise = lock.acquire('ch2')
    lock.cancelWaiter('ch2')

    r1()

    // Lock should now be idle — a fresh acquire resolves immediately.
    const r3 = await Promise.race([
      lock.acquire('ch3'),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('timeout — ch3 never granted')), 50),
      ),
    ])
    expect(typeof r3).toBe('function')
    expect(lock.currentHolder).toBe('ch3')
    r3()

    void ch2Promise // never settles — intentionally left pending, GC'd with the lock
  })

  it('cancelWaiter for the current HOLDER (not queued) is a no-op — the holder is unaffected', async () => {
    const lock = new GitWriteLock()
    const r1 = await lock.acquire('ch1')
    expect(lock.currentHolder).toBe('ch1')

    lock.cancelWaiter('ch1') // ch1 holds, is not queued
    expect(lock.currentHolder).toBe('ch1') // still holds

    r1() // clean up
    expect(lock.currentHolder).toBeNull()
  })

  it('cancelWaiter for an unknown/never-seen channel is a no-op', async () => {
    const lock = new GitWriteLock()
    const r1 = await lock.acquire('ch1')

    expect(() => lock.cancelWaiter('never-seen')).not.toThrow()
    expect(lock.currentHolder).toBe('ch1')

    r1()
  })

  it('cancelWaiter is a no-op on an entirely idle lock', () => {
    const lock = new GitWriteLock()
    expect(() => lock.cancelWaiter('ch1')).not.toThrow()
    expect(lock.currentHolder).toBeNull()
  })

  it('concurrent turns: second does not call connection.prompt until first releases', async () => {
    // Simulates two executePrompt calls contending at acquire()
    const lock = new GitWriteLock()
    const promptOrder: string[] = []

    async function simulateTurn(channelId: string): Promise<void> {
      const release = await lock.acquire(channelId)
      promptOrder.push(`${channelId}:start`)
      // Simulate async work (connection.prompt)
      await new Promise(r => setImmediate(r))
      promptOrder.push(`${channelId}:end`)
      release()
    }

    const t1 = simulateTurn('ch1')
    const t2 = simulateTurn('ch2')
    await Promise.all([t1, t2])

    // ch1 must complete before ch2 starts (FIFO, not interleaved)
    expect(promptOrder).toEqual([
      'ch1:start',
      'ch1:end',
      'ch2:start',
      'ch2:end',
    ])
  })
})
