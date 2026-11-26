import { env } from '@lilnas/utils/env'
import {
  BadRequestException,
  Controller,
  HttpException,
  HttpStatus,
  type MessageEvent,
  Query,
  Req,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { filter, finalize, map, merge, Observable, timer } from 'rxjs'

import { AdminGuard } from 'src/admin/admin.guard'
import { EnvKeys } from 'src/env'
import { AccessCacheService } from 'src/verify/access-cache.service'

import { ADMIN_TOPIC, NotifyBusService, topicFor } from './notify-bus.service'
import { SseStreamLimiter } from './sse-stream-limiter.service'

const KEEPALIVE_EVENT_TYPE = 'keepalive'
const STATUS_CHANGED_EVENT_TYPE = 'status-changed'
const ADMIN_CHANGED_EVENT_TYPE = 'admin-changed'

// ──────────────────────────────────────────────────────────────────────────────
// U6 (R9, AE3): the pending page's live channel. GET /sse/pending?host=<serviceHost>,
// reached from the browser through next.config.js's `/api/sse/:path*`
// rewrite so the browser never needs to know about port 8081 directly,
// matching the auth mount's own non-stripping-rewrite convention.
//
// Identity comes from the SAME session-cookie resolution /verify uses
// (AccessCacheService.resolveSession(), reused rather than reimplemented) —
// not a query param — so a client cannot subscribe to another user's topic
// by guessing a userId. `host` IS a query param (the service host the
// pending page is about), since it's not secret and the browser already
// knows it (it's embedded in the page's own `redirect` URL).
//
// Both routes answer a request that can never receive data with an error
// BEFORE any stream starts, instead of handing it an endless keepalive
// stream (this route is public as /api/sse/pending, so that stream was free
// to anyone):
//   - pending(): 401 with no session, 400 with no (or a blank) `host`.
//   - admin():   AdminGuard's 401 (no session) / 403 (not an admin email).
//     The admin route broadcasts one flat, unscoped topic to every
//     subscriber, so there is real data (that admin state is changing at
//     all) to keep from a non-admin.
// Then both apply one per-user cap on open streams (SseStreamLimiter,
// shared count across both routes): 429 at the cap. Errors are thrown
// before the handler returns, so Nest's exception filter answers with a
// plain JSON error, never `text/event-stream`. The pages already cope: a
// non-2xx makes the browser close the EventSource for good, their `error`
// handler rechecks and rebuilds it after 5 s, and a 30 s poll keeps the page
// correct with no stream at all (pending-client.tsx,
// admin-dashboard-client.tsx).
//
// A slot is released both when the returned Observable is torn down and on
// the request's `close` event — whichever comes first — so a slot is never
// left behind even if Nest never subscribes. The release is idempotent.
// ──────────────────────────────────────────────────────────────────────────────
@Controller('sse')
export class SseController {
  constructor(
    private readonly notifyBus: NotifyBusService,
    private readonly accessCache: AccessCacheService,
    private readonly limiter: SseStreamLimiter,
  ) {}

  @Sse('pending')
  async pending(
    @Req() req: Request,
    @Query('host') serviceHost: string | undefined,
  ): Promise<Observable<MessageEvent>> {
    const session = await this.accessCache.resolveSession(req.headers.cookie)
    if (!session) throw new UnauthorizedException()

    const host = typeof serviceHost === 'string' ? serviceHost.trim() : ''
    if (!host) throw new BadRequestException('host is required')

    const release = this.takeSlot(req, session.userId)
    const topic = topicFor(session.userId, host)

    // A monotonic per-connection counter, assigned explicitly on every
    // message — never NestJS's own auto-id, which falls back to a
    // starts-at-null `lastEventId++` that produces the string "NaN" forever
    // (see apps/tdr-code/src/sse/sse.controller.ts's identical comment for
    // the full citation against the installed SseStream source).
    const ids = { next: 0 }

    // The signal payload carries no data beyond "something changed for this
    // pair" — deliberately. The pending page reacts by re-checking status
    // (GET the same status endpoint it calls on load/reconnect) rather than
    // trusting anything this event claims, which is also what makes the
    // reconnect-then-recheck property hold with one code path instead of
    // two.
    const data$ = this.notifyBus.stream$.pipe(
      filter(signal => signal.topic === topic),
      map((): MessageEvent => ({
        data: {},
        id: String(ids.next++),
        type: STATUS_CHANGED_EVENT_TYPE,
      })),
    )

    return merge(data$, keepalive$(ids)).pipe(finalize(release))
  }

  // The admin dashboard's live channel. GET /sse/admin, reached through the
  // SAME non-stripping /api/sse/:path* rewrite the pending route above
  // already relies on. Unlike pending() above, this is a flat broadcast
  // with no per-connection topic to derive: every admin subscribes to the
  // SAME ADMIN_TOPIC. The session is resolved again after AdminGuard only
  // to get the userId the stream cap counts against.
  @Sse('admin')
  @UseGuards(AdminGuard)
  async admin(@Req() req: Request): Promise<Observable<MessageEvent>> {
    const session = await this.accessCache.resolveSession(req.headers.cookie)
    // AdminGuard has already rejected a missing session; this only covers a
    // session that expired between the guard and here.
    if (!session) throw new UnauthorizedException()

    const release = this.takeSlot(req, session.userId)
    const ids = { next: 0 }

    // Same "carries no data beyond the fact that something changed"
    // contract as the pending route's data$ above — the dashboard reacts by
    // calling router.refresh() (a full server-side re-fetch), never by
    // trusting anything this event claims.
    const data$ = this.notifyBus.stream$.pipe(
      filter(signal => signal.topic === ADMIN_TOPIC),
      map((): MessageEvent => ({
        data: {},
        id: String(ids.next++),
        type: ADMIN_CHANGED_EVENT_TYPE,
      })),
    )

    return merge(data$, keepalive$(ids)).pipe(finalize(release))
  }

  // Takes a stream slot for the user or throws 429. The returned release is
  // also bound to the request's `close` event, so the slot is freed even if
  // the Observable is never subscribed (or never torn down).
  private takeSlot(req: Request, userId: string): () => void {
    const release = this.limiter.acquire(userId)
    if (!release) {
      throw new HttpException(
        'Too many open streams',
        HttpStatus.TOO_MANY_REQUESTS,
      )
    }
    req.once('close', release)
    // The client may already be gone (it hung up while the session was
    // being resolved); `close` will not fire again, so release now.
    if (req.socket?.destroyed) release()
    return release
  }
}

function keepalive$(ids: { next: number }): Observable<MessageEvent> {
  const keepaliveMs = parseInt(env(EnvKeys.SSE_KEEPALIVE_MS, '25000'), 10)
  return timer(keepaliveMs, keepaliveMs).pipe(
    map((): MessageEvent => ({
      data: {},
      id: String(ids.next++),
      type: KEEPALIVE_EVENT_TYPE,
    })),
  )
}
