// Process-global async mutex for git-writing turns. Only one channel can hold
// the lock at a time — the single shared workspace means concurrent .git/config
// writes would interleave identities (Decision #4).
//
// The holder is tracked so teardown paths can call releaseIfHeldBy(channelId)
// as a belt-and-suspenders release when executePrompt's finally might not fire
// (e.g. process death during the lock-acquire window before connection.prompt
// is called — Decision #4, U8 risk note).

import { Logger } from '@nestjs/common'

// Non-DI singleton — see acp-client.ts's header comment for why this Logger's
// calls are one interpolated string rather than PinoLogger's object-first API.
const logger = new Logger('GitWriteLock')

type Release = () => void
type Grant = () => void
type Reject = (err: Error) => void

export class GitWriteLock {
  private queue: Array<{ channelId: string; grant: Grant; reject: Reject }> = []
  private holderChannelId: string | null = null

  // Acquire the lock. Returns a release function. Callers MUST call the
  // returned function unconditionally at the top of their finally block.
  acquire(channelId: string): Promise<Release> {
    return new Promise<Release>((resolve, reject) => {
      // grant-closure: sets holder and resolves the outer promise directly,
      // so the woken waiter never re-runs the null-check (fixes deadlock when
      // a queued waiter is released — it would re-queue instead of settling).
      const grant: Grant = () => {
        this.holderChannelId = channelId
        resolve(() => {
          if (this.holderChannelId === channelId) this.holderChannelId = null
          const next = this.queue.shift()
          if (next) next.grant()
        })
      }
      if (this.holderChannelId === null) grant()
      else this.queue.push({ channelId, grant, reject })
    })
  }

  // Release the lock only if channelId currently holds it. Idempotent with
  // the release function returned by acquire() — safe to call on every
  // force-kill path even if the turn's finally already released.
  // A stale release (caller is no longer the holder) is a no-op — the
  // queue and current holder are left undisturbed.
  releaseIfHeldBy(channelId: string): void {
    if (this.holderChannelId !== channelId) return
    this.holderChannelId = null
    const next = this.queue.shift()
    if (next) next.grant()
  }

  // Remove a queued waiter for channelId, if one exists, and reject its
  // parked acquire() so the waiter's turn settles instead of hanging forever.
  // Sibling of releaseIfHeldBy — that touches only the holder, this touches
  // only the queue. A no-op if channelId is not currently queued, and a
  // no-op if channelId is the current HOLDER (only the queue is spliced; a
  // holder is never removed from itself here — that's what
  // release()/releaseIfHeldBy are for). Defense-in-depth for tearing down a
  // session that may be parked on acquire(): without the rejection, the
  // caller's `await acquire()` never settles (grant() — the only place that
  // resolves it — never runs for a spliced-out entry), stranding the
  // suspended executePrompt frame forever even though the queue entry itself
  // is gone. executePrompt's existing catch/finally already handles a
  // rejected acquire() the same as any other lock-acquire failure.
  cancelWaiter(channelId: string): void {
    const idx = this.queue.findIndex(w => w.channelId === channelId)
    if (idx === -1) return
    const [waiter] = this.queue.splice(idx, 1)
    if (!waiter) return
    logger.warn(
      `Queued git-write-lock waiter cancelled during teardown channel=${channelId}`,
    )
    waiter.reject(
      new Error(
        `git-write-lock: waiter ${channelId} cancelled during teardown`,
      ),
    )
  }

  get currentHolder(): string | null {
    return this.holderChannelId
  }
}

// Module-level singleton — one lock for the entire bot process.
export const globalGitWriteLock = new GitWriteLock()
