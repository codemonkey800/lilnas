/**
 * First come, first served admission of at most `capacity()` holders. Used
 * for the sign-in turn (capacity 1) and the download slots (MAX_DOWNLOADS).
 */
export class FifoGate {
  private readonly holders = new Set<string>()
  private waiting: Array<{ id: string; resolve: (granted: boolean) => void }> =
    []

  constructor(private readonly capacity: () => number) {}

  /** Resolves true once admitted, false if `cancel(id)` came first. */
  acquire(id: string): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      this.waiting.push({ id, resolve })
      this.dispatch()
    })
  }

  /** Gives the place back. A no-op when `id` does not hold one. */
  release(id: string): void {
    if (this.holders.delete(id)) this.dispatch()
  }

  /** Leaves the line, or gives the place back; safe in either state. */
  cancel(id: string): void {
    const index = this.waiting.findIndex(w => w.id === id)
    if (index >= 0) {
      const [entry] = this.waiting.splice(index, 1)
      entry?.resolve(false)
    }
    this.release(id)
  }

  /** 1 = next in line; null when `id` is not waiting. */
  positionOf(id: string): number | null {
    const index = this.waiting.findIndex(w => w.id === id)
    return index < 0 ? null : index + 1
  }

  waitingIds(): string[] {
    return this.waiting.map(w => w.id)
  }

  private dispatch(): void {
    const limit = Math.max(1, this.capacity())
    while (this.waiting.length > 0 && this.holders.size < limit) {
      const next = this.waiting.shift()
      if (!next) break
      this.holders.add(next.id)
      next.resolve(true)
    }
  }
}
