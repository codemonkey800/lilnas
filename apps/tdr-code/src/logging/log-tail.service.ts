import fs from 'node:fs'
import { StringDecoder } from 'node:string_decoder'

import { env } from '@lilnas/utils/env'
import { Injectable, OnModuleDestroy } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { Observable } from 'rxjs'

import { EnvKeys } from 'src/env'
import { LOG_EVENTS } from 'src/logging/log-events'
import { LOG_DIR, logFilePath } from 'src/logging/log-paths'
import type { LogStream, LogTailMessage } from 'src/logging/log-view.types'

// A tail connection emits exactly one of these two shapes. Kept as a
// service-level discriminated union (not log-view.types.ts's own
// LogTailMessage, which is only the wire `data` payload for a real
// log-append message) so the controller can distinguish "map this to a
// log-append MessageEvent with an id" from "map this to a bare keepalive
// MessageEvent with no line data" without re-deriving that distinction from
// shape alone.
export type LogTailEvent =
  | { kind: 'append'; message: LogTailMessage }
  | { kind: 'keepalive' }

export interface WatchTailParams {
  stream: LogStream
  // Resume offset precedence (R16, this unit's constraint #2): the
  // controller has ALREADY resolved lastEventId-vs-from-vs-undefined into
  // this single value before calling watch() — this service has no opinion
  // on where the number came from, only on clamping/using it.
  from: number | undefined
}

// Coalesces fs.watch's duplicate 'change' events per write (nodejs/node#3042
// — the kernel fires more than one notification for a single write() under
// both inotify and kqueue) into a bounded cadence, so a burst of appends
// triggers one debounced read per quiet period rather than one read per raw
// OS event. Offset-vs-size idempotency (see drainOnce below) is what
// actually makes a redundant fire harmless even if this window is too short
// for some platform/write pattern — the debounce is a throughput
// optimization layered on top of that correctness guarantee, not a
// substitute for it.
const DEFAULT_DEBOUNCE_MS = 30
const DEFAULT_KEEPALIVE_MS = 25000
// fs.watchFile's own poll interval when LOG_TAIL_POLL_FALLBACK is set —
// distinct from the debounce constant above (that one coalesces REAL
// fs.watch events; this one IS the polling mechanism itself for mounts
// where fs.watch's native inotify/kqueue backend doesn't fire at all, e.g.
// NFS/osxfs).
const POLL_FALLBACK_INTERVAL_MS = 1000

@Injectable()
export class LogTailService implements OnModuleDestroy {
  // Same test-only override seam as LogReaderService/LogSourcesService —
  // production code always resolves paths through log-paths.ts's own
  // LOG_DIR constant, never a client-supplied value (R17).
  private logDir: string = LOG_DIR

  // Every live connection's cleanup function, so onModuleDestroy can tear
  // all of them down on process shutdown rather than only relying on each
  // connection's own finalize() (which fires when THAT connection's own
  // subscriber unsubscribes — a graceful server shutdown needs to
  // proactively close every still-open watcher/handle/timer instead of
  // waiting for clients to notice the process is gone).
  private readonly activeCleanups = new Set<() => void>()

  constructor(private readonly logger: PinoLogger) {}

  setLogDirForTests(dir: string): void {
    this.logDir = dir
  }

  private resolvePath(stream: LogStream): string {
    return this.logDir === LOG_DIR
      ? logFilePath(stream)
      : logFilePath(stream).replace(LOG_DIR, this.logDir)
  }

  onModuleDestroy(): void {
    // Copy before iterating: each cleanup() call synchronously removes
    // itself from activeCleanups (see watch() below), and mutating a Set
    // while for..of-ing it is exactly the kind of thing that's easy to get
    // subtly wrong under a future refactor — iterating a snapshot array
    // sidesteps the question entirely.
    for (const cleanup of [...this.activeCleanups]) cleanup()
  }

  // Returns a cold Observable: nothing (file handle, fs.watch, debounce
  // timer, keepalive timer) is created until a subscriber actually
  // subscribes, and everything is torn down exactly once when that
  // subscription ends — via finalize() on the subscriber's own teardown,
  // the watcher's own 'error' event, or this service's onModuleDestroy.
  // Mirrors sse-hub.service.ts's subscribe()'s "create the Observable's
  // internals inside its own executor" discipline, applied per-connection
  // here rather than per-topic-registry-entry there.
  watch(params: WatchTailParams): Observable<LogTailEvent> {
    return new Observable<LogTailEvent>(subscriber => {
      const filePath = this.resolvePath(params.stream)
      const debounceMs = parseInt(
        env(EnvKeys.LOG_TAIL_DEBOUNCE_MS, String(DEFAULT_DEBOUNCE_MS)),
        10,
      )
      const keepaliveMs = parseInt(
        env(EnvKeys.LOG_TAIL_KEEPALIVE_MS, String(DEFAULT_KEEPALIVE_MS)),
        10,
      )
      const pollFallback = env(EnvKeys.LOG_TAIL_POLL_FALLBACK, '') === 'true'

      // An AbortController dedicated to this one connection's fs.watch
      // call (constraint #9's "everything created inside the returned
      // Observable" — the signal itself is also created here, not shared
      // across connections). Passing { signal } to fs.watch is Node's own
      // sanctioned teardown mechanism (equivalent to watcher.close() but
      // matching the plan's stated approach and composing naturally with
      // the same controller this connection could use for other async
      // work if it ever needed to).
      const abortController = new AbortController()

      let handle: fs.promises.FileHandle | undefined
      let watcher: fs.FSWatcher | undefined
      let debounceTimer: ReturnType<typeof setTimeout> | undefined
      let keepaliveTimer: ReturnType<typeof setInterval> | undefined
      let lastOffset = 0
      let lastIno: number | undefined
      // Held across every read on this connection — a partial trailing line
      // from one read is prepended to the NEXT read's decoded text, and a
      // multi-byte UTF-8 sequence split across two reads is completed by
      // this SAME decoder instance's own internal byte buffer (StringDecoder
      // deliberately withholds an incomplete trailing multi-byte sequence
      // from write()'s return value until the rest arrives — this is the
      // API guarantee that makes it correct here; a fresh
      // `Buffer.toString('utf8')` per read would instead silently emit
      // U+FFFD replacement characters for a sequence split across a read
      // boundary).
      const decoder = new StringDecoder('utf8')
      let pendingPartial = ''
      // The file byte offset one past the last COMPLETE line this
      // connection has emitted (or the resolved resume offset, before any
      // line has been emitted yet) — the anchor drainOnce walks forward
      // from to compute each newly emitted line's own byteOffset.
      // Deliberately NOT derived from `lastOffset - Buffer.byteLength
      // (pendingPartial, 'utf8')`: StringDecoder can hold an incomplete
      // multi-byte sequence INSIDE ITS OWN internal buffer — bytes already
      // consumed from the file (already reflected in lastOffset via
      // bytesRead) but never returned by decoder.write() and therefore
      // never present in `pendingPartial`'s string value at all. That
      // formula would silently UNDERCOUNT by exactly however many bytes
      // the decoder is holding back — a real, caught bug (see this unit's
      // UTF-8-split-across-two-reads test) where the byteOffset reported
      // for a line completed on a LATER read came out short by the number
      // of held-back bytes. Tracking this as its own explicit field,
      // updated only where pendingPartial itself changes (drainOnce's own
      // end, and the truncation/rotation resets in checkForChanges), avoids
      // re-deriving it from decoder-internal state that isn't observable
      // from the outside.
      let pendingPartialStartOffset = 0
      // Guards every code path below against running again after teardown —
      // an in-flight async op (drainOnce, checkForChanges) that resolves
      // AFTER cleanup() has already fired must not touch
      // subscriber/handle/lastOffset, since fs.watch/timers were already
      // released and racing a subscriber.next() after cleanup would be a
      // use-after-teardown bug, not merely a wasted call.
      let closed = false

      // Idempotent by construction (constraint #8): every one of its
      // internal guards is itself a no-op on a second call (clearTimeout/
      // clearInterval on an already-cleared timer, abort() on an
      // already-aborted controller, handle.close() on an already-closed
      // handle all tolerate repeat calls per their own Node docs), and the
      // `closed` flag short-circuits cleanup's own body from running twice.
      // Bound to THREE independent triggers below: the Observable's own
      // finalize (subscriber unsubscribed/errored/completed), the
      // watcher's own 'error' event, and — for every currently-open
      // connection at once — onModuleDestroy.
      const cleanup = (): void => {
        if (closed) return
        closed = true
        this.activeCleanups.delete(cleanup)
        if (debounceTimer !== undefined) clearTimeout(debounceTimer)
        if (keepaliveTimer !== undefined) clearInterval(keepaliveTimer)
        if (pollFallback) fs.unwatchFile(filePath)
        abortController.abort()
        // Fire-and-forget: a close failure here has no recovery action a
        // caller could take (the fd is going away either way), and
        // Observable teardown functions are synchronous/void, not awaited.
        void handle?.close().catch(() => undefined)
      }
      this.activeCleanups.add(cleanup)

      // Reads [lastOffset, size) from the (possibly just-reopened) handle,
      // decodes through the persistent decoder, splits complete lines, and
      // emits each as an 'append' event — retaining any trailing partial
      // line for the next call. Called from three sites: once for the
      // initial backlog, once more for the post-attach re-drain (closing
      // the backlog/watcher-attach race), and once per debounced live
      // 'change'. Safe to call when size <= lastOffset (a no-op) — this is
      // exactly the idempotency debounce+duplicate-events relies on
      // (constraint #5): a redundant fire against an unchanged file costs
      // nothing beyond the caller's own stat().
      const drainOnce = async (size: number): Promise<void> => {
        if (closed || handle === undefined) return
        if (size <= lastOffset) return
        const length = size - lastOffset
        const buf = Buffer.allocUnsafe(length)
        const { bytesRead } = await handle.read(buf, 0, length, lastOffset)
        if (closed) return
        const region = bytesRead === length ? buf : buf.subarray(0, bytesRead)

        // lastOffset advances by EXACTLY bytesRead — the real number of
        // bytes consumed from the file by THIS read. Deliberately NOT
        // derived from the decoded text's byte length: a multi-byte UTF-8
        // sequence split across the end of `region` is correctly withheld
        // by StringDecoder INSIDE ITS OWN internal buffer (decoder.write()
        // simply omits those trailing bytes from its return value until the
        // rest arrives — see the decoder's own field comment above), so
        // those bytes are already "consumed from the file" even though they
        // don't yet appear in any decoded string this call can see.
        lastOffset += bytesRead

        // decoder.write() is what makes multi-byte UTF-8 split across two
        // `region`s correct (see the decoder's own field comment above) —
        // never region.toString('utf8') here.
        const text = pendingPartial + decoder.write(region)
        const parts = text.split('\n')
        // The last element is either '' (region ended exactly on a '\n') or
        // a genuine partial final line with no trailing newline yet —
        // either way it is NOT a complete line and must be held, never
        // emitted (constraint #6: readline is not used here for exactly
        // this reason — it would emit this fragment prematurely).
        pendingPartial = parts.pop() ?? ''

        // Walks forward from pendingPartialStartOffset (the file offset one
        // past the previous call's last COMPLETE line — see that field's
        // own comment) by each complete line's own decoded byte length
        // (Buffer.byteLength — constraint #7 — never line.length, a UTF-16
        // code-unit count that would silently under-count any multi-byte
        // character) plus one for the '\n' each split() boundary consumed.
        // This is intentionally a SEPARATE running total from lastOffset's
        // own bytesRead-based bookkeeping above: the two diverge exactly
        // when the decoder is holding an incomplete multi-byte sequence
        // internally (bytes already reflected in lastOffset via bytesRead,
        // but with no representation in any decoded string this call can
        // see) — walking from a real anchor offset by each fully-decoded
        // line's own byte length sidesteps that gap entirely, since every
        // line reaching this loop is by definition complete.
        let offset = pendingPartialStartOffset
        for (const line of parts) {
          offset += Buffer.byteLength(line, 'utf8') + 1
          subscriber.next({
            kind: 'append',
            message: { line, byteOffset: offset },
          })
        }
        // Advance the anchor to right after whatever was just emitted (or
        // leave it unchanged if nothing was — `parts` empty means
        // `pendingPartial` absorbed the entire text with no complete line
        // found, so the anchor for the NEXT call is still wherever it was
        // for THIS one).
        pendingPartialStartOffset = offset
      }

      // Truncation (size < lastOffset -> reset to 0, clear pendingPartial,
      // reset decoder) and rotation (inode changed -> close + reopen +
      // reset to 0) both funnel through this one function so every
      // debounced 'change'/poll tick handles both without duplicating the
      // reset logic inline at each call site.
      const checkForChanges = async (): Promise<void> => {
        if (closed) return
        try {
          const stat = await fs.promises.stat(filePath)
          if (closed) return
          if (stat.ino !== lastIno) {
            // Rotation: the file at this path is a DIFFERENT inode than
            // the one this connection has open — reopen and follow the new
            // file from its start. This is also what recovers a connection
            // whose fs.watch went deaf after the original watched path was
            // renamed away (file-level fs.watch stops reporting changes
            // once its target path is renamed out from under it — verified
            // empirically against this platform's fs.watch backend), as
            // long as SOME later tick still fires; the poll-fallback path
            // (LOG_TAIL_POLL_FALLBACK) is the one that reliably keeps
            // firing across a rename+recreate on platforms/mounts where
            // native fs.watch does not.
            await handle?.close().catch(() => undefined)
            handle = await fs.promises.open(filePath, 'r')
            if (closed) {
              await handle.close().catch(() => undefined)
              return
            }
            lastIno = stat.ino
            lastOffset = 0
            pendingPartial = ''
            pendingPartialStartOffset = 0
            decoder.end() // discard any incomplete multi-byte tail from
            // the OLD file — it belongs to bytes that no longer exist
            // under this path.
            this.logger.info(
              { event: LOG_EVENTS.logTailReopened, stream: params.stream },
              'log tail reopened after rotation',
            )
            await drainOnce(stat.size)
            return
          }
          if (stat.size < lastOffset) {
            // Truncation: same path, same inode, but shorter than what
            // this connection already consumed — the file was cleared in
            // place (not rotated). Reset to 0 and re-drain from the start
            // of the now-shorter file.
            lastOffset = 0
            pendingPartial = ''
            pendingPartialStartOffset = 0
            decoder.end()
          }
          await drainOnce(stat.size)
        } catch (err) {
          if (closed) return
          this.logger.error(
            {
              err,
              event: LOG_EVENTS.logTailWatchFailed,
              stream: params.stream,
            },
            'log tail stat/read failed on change',
          )
        }
      }

      const scheduleCheck = (): void => {
        if (closed) return
        if (debounceTimer !== undefined) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          debounceTimer = undefined
          void checkForChanges()
        }, debounceMs)
      }

      const start = async (): Promise<void> => {
        try {
          let stat: fs.Stats
          try {
            stat = await fs.promises.stat(filePath)
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
              // The stream has never been written to yet (R2's existing
              // empty-state precedent — see LogReaderService/
              // LogSourcesService's identical ENOENT handling). There is
              // nothing to watch or open YET; end this connection
              // gracefully (a native EventSource auto-reconnects and will
              // succeed once the file exists) rather than throwing out of
              // an Observable executor for a normal, expected state.
              this.logger.info(
                {
                  event: LOG_EVENTS.logTailWatchFailed,
                  stream: params.stream,
                  reason: 'file-does-not-exist-yet',
                },
                'log tail: stream file does not exist yet',
              )
              subscriber.complete()
              return
            }
            throw err
          }
          if (closed) return

          const fileSize = stat.size
          // Resume-offset clamping mirrors LogReaderService's own anchor
          // clamp: coerce to a real in-range value regardless of what the
          // controller resolved (a stale Last-Event-ID from a long-idle
          // client could exceed the current, possibly-truncated, file
          // size).
          lastOffset = Math.max(0, Math.min(params.from ?? fileSize, fileSize))
          // The anchor for the first line this connection ever emits starts
          // exactly at the resolved resume offset — see
          // pendingPartialStartOffset's own field comment.
          pendingPartialStartOffset = lastOffset
          lastIno = stat.ino
          handle = await fs.promises.open(filePath, 'r')
          if (closed) {
            await handle.close().catch(() => undefined)
            return
          }

          // Attach the watcher BEFORE reading the backlog (constraint #3):
          // from this point on, any append is guaranteed to trigger at
          // least one scheduleCheck() call, even one that lands mid-backlog
          // -read below. The debounce+idempotent-drain design is what makes
          // firing "too early" (before the backlog read even starts) just
          // as harmless as firing "too late" — either way, the eventual
          // drainOnce() call only ever reads [lastOffset, current size).
          if (pollFallback) {
            fs.watchFile(
              filePath,
              { interval: POLL_FALLBACK_INTERVAL_MS },
              () => scheduleCheck(),
            )
          } else {
            try {
              watcher = fs.watch(
                filePath,
                { signal: abortController.signal },
                () => scheduleCheck(),
              )
              watcher.on('error', err => {
                if (closed) return
                this.logger.error(
                  {
                    err,
                    event: LOG_EVENTS.logTailWatchFailed,
                    stream: params.stream,
                  },
                  'log tail watcher errored',
                )
                cleanup()
                subscriber.error(err)
              })
            } catch (err) {
              this.logger.error(
                {
                  err,
                  event: LOG_EVENTS.logTailWatchFailed,
                  stream: params.stream,
                },
                'log tail failed to attach watcher',
              )
              cleanup()
              subscriber.error(err)
              return
            }
          }

          // Emit the backlog from the resolved resume offset up to EOF-at-
          // attach-time...
          await drainOnce(fileSize)
          if (closed) return
          // ...then re-stat and drain ONCE MORE (constraint #3): a line
          // appended in the narrow window between the stat() above and the
          // watcher actually being live would otherwise never trigger a
          // 'change' callback for it (the watcher only reports FUTURE
          // changes) and would sit unread until some LATER unrelated write
          // happened to fire the debounce again. This second drain closes
          // that race unconditionally, and costs nothing when nothing
          // arrived (drainOnce's own size<=lastOffset guard makes it a
          // no-op in the common case).
          const postAttachStat = await fs.promises
            .stat(filePath)
            .catch(() => undefined) // file could have been removed in this
          // exact instant; a later watcher 'error'/debounced check is the
          // recovery path, not this one-off stat.
          if (closed) return
          if (postAttachStat) await drainOnce(postAttachStat.size)
          if (closed) return

          this.logger.info(
            {
              event: LOG_EVENTS.logTailStarted,
              stream: params.stream,
              from: lastOffset,
            },
            'log tail started',
          )

          keepaliveTimer = setInterval(() => {
            if (closed) return
            subscriber.next({ kind: 'keepalive' })
          }, keepaliveMs)
        } catch (err) {
          if (closed) return
          this.logger.error(
            {
              err,
              event: LOG_EVENTS.logTailWatchFailed,
              stream: params.stream,
            },
            'log tail failed to start',
          )
          cleanup()
          subscriber.error(err)
        }
      }

      void start()

      return cleanup
    })
  }
}
