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
