import { FifoGate } from 'src/jobs/fifo-gate'

describe('FifoGate', () => {
  it('admits up to the capacity at once and the rest in order', async () => {
    const gate = new FifoGate(() => 2)
    const order: string[] = []
    const run = (id: string) =>
      gate.acquire(id).then(granted => order.push(`${id}:${granted}`))

    void run('a')
    void run('b')
    void run('c')
    void run('d')
    await Promise.resolve()
    expect(order).toEqual(['a:true', 'b:true'])
    expect(gate.positionOf('c')).toBe(1)
    expect(gate.positionOf('d')).toBe(2)
    expect(gate.positionOf('a')).toBeNull()

    gate.release('a')
    await Promise.resolve()
    expect(order).toEqual(['a:true', 'b:true', 'c:true'])
    expect(gate.positionOf('d')).toBe(1)
  })

  it('lets a waiter leave the line, and a holder give its place back', async () => {
    const gate = new FifoGate(() => 1)
    const results: Record<string, boolean> = {}
    const run = (id: string) =>
      gate.acquire(id).then(granted => (results[id] = granted))
    void run('a')
    void run('b')
    void run('c')
    await Promise.resolve()

    gate.cancel('b')
    await Promise.resolve()
    expect(results).toEqual({ a: true, b: false })

    gate.cancel('a')
    await Promise.resolve()
    expect(results.c).toBe(true)
  })

  it('ignores a release or cancel for an unknown id', () => {
    const gate = new FifoGate(() => 1)
    expect(() => {
      gate.release('nobody')
      gate.cancel('nobody')
    }).not.toThrow()
  })

  it('reads the capacity each time it admits', async () => {
    let capacity = 1
    const gate = new FifoGate(() => capacity)
    const results: boolean[] = []
    void gate.acquire('a').then(g => results.push(g))
    void gate.acquire('b').then(g => results.push(g))
    await Promise.resolve()
    expect(results).toEqual([true])
    capacity = 2
    void gate.acquire('c').then(g => results.push(g))
    await Promise.resolve()
    // b was already waiting and takes the new place; c is next.
    expect(results).toEqual([true, true])
    expect(gate.positionOf('c')).toBe(1)
  })
})
