/**
 * An in-process async lock keyed by string: callers that share a key run one
 * at a time in arrival (FIFO) order, while different keys run concurrently.
 *
 * - A rejected (or synchronously throwing) `fn` still releases the lock; the
 *   rejection reaches only that caller, never the ones queued behind it.
 * - Each key holds just the tail of its queue, and the entry is dropped as
 *   soon as that tail settles with nobody queued behind it, so idle keys
 *   never accumulate.
 *
 * Single-process only - it serialises work inside this Node process, not
 * across replicas.
 */
export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>()

  /** Number of keys currently held or queued; `0` once every queue drains. */
  get size(): number {
    return this.tails.size
  }

  run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // Tails never reject (see below), so chaining on one can't skip `fn`.
    const previous = this.tails.get(key) ?? Promise.resolve()
    const result = previous.then(() => fn())

    // Registered on `result` before the caller can attach its own handlers,
    // so the entry is already gone by the time the caller's `await` resumes.
    // Only the newest tail may delete: a later caller that queued behind this
    // one has replaced it and now owns the key.
    const release = () => {
      if (this.tails.get(key) === tail) {
        this.tails.delete(key)
      }
    }
    const tail = result.then(release, release)
    this.tails.set(key, tail)

    return result
  }
}

/**
 * The process-wide lock for per-title upstream sequences, keyed by `mediaId`.
 * Every ensure/monitor sequence for one title in `release.service.ts` and
 * `media-download.service.ts` runs inside it, so two requests for the same
 * title can't interleave their Radarr/Sonarr calls.
 *
 * A module-level singleton rather than a Nest provider because neither
 * service may take a new injected dependency.
 */
export const mediaMutex = new KeyedMutex()
