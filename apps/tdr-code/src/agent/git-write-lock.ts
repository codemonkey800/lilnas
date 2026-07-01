// Process-global async mutex for git-writing turns. Only one channel can hold
// the lock at a time — the single shared workspace means concurrent .git/config
// writes would interleave identities (Decision #4).
//
// The holder is tracked so teardown paths can call releaseIfHeldBy(channelId)
// as a belt-and-suspenders release when executePrompt's finally might not fire
// (e.g. process death during the lock-acquire window before connection.prompt
// is called — Decision #4, U8 risk note).

type Release = () => void

export class GitWriteLock {
  private queue: Array<{ channelId: string; resolve: () => void }> = []
  private holderChannelId: string | null = null

  // Acquire the lock. Returns a release function. Callers MUST call the
  // returned function unconditionally at the top of their finally block.
  acquire(channelId: string): Promise<Release> {
    return new Promise<Release>(resolve => {
      const tryAcquire = () => {
        if (this.holderChannelId === null) {
          this.holderChannelId = channelId
          const release: Release = () => {
            if (this.holderChannelId === channelId) {
              this.holderChannelId = null
            }
            const next = this.queue.shift()
            if (next) {
              this.holderChannelId = next.channelId
              next.resolve()
            }
          }
          resolve(release)
        } else {
          this.queue.push({ channelId, resolve: tryAcquire })
        }
      }
      tryAcquire()
    })
  }

  // Release the lock only if channelId currently holds it. Idempotent with
  // the release function returned by acquire() — safe to call on every
  // force-kill path even if the turn's finally already released.
  releaseIfHeldBy(channelId: string): void {
    if (this.holderChannelId !== channelId) return
    this.holderChannelId = null
    const next = this.queue.shift()
    if (next) {
      this.holderChannelId = next.channelId
      next.resolve()
    }
  }

  get currentHolder(): string | null {
    return this.holderChannelId
  }
}

// Module-level singleton — one lock for the entire bot process.
export const globalGitWriteLock = new GitWriteLock()
