import { env } from '@lilnas/utils/env'
import {
  Controller,
  type MessageEvent,
  Query,
  Req,
  Sse,
  UseGuards,
} from '@nestjs/common'
import type { Request } from 'express'
import { filter, map, merge, Observable, timer } from 'rxjs'

import { AdminGuard } from 'src/admin/admin.guard'
import { EnvKeys } from 'src/env'
import { AccessCacheService } from 'src/verify/access-cache.service'

import { ADMIN_TOPIC, NotifyBusService, topicFor } from './notify-bus.service'

const KEEPALIVE_EVENT_TYPE = 'keepalive'
const STATUS_CHANGED_EVENT_TYPE = 'status-changed'
const ADMIN_CHANGED_EVENT_TYPE = 'admin-changed'

// ──────────────────────────────────────────────────────────────────────────────
// U6 (R9, AE3): the pending page's live channel. GET /sse/pending?host=<serviceHost>,
// reached from the browser through next.config.js's future `/api/sse/:path*`
// rewrite (this unit adds that rewrite — see next.config.js) so the browser
// never needs to know about port 8081 directly, matching the auth mount's
// own non-stripping-rewrite convention.
//
// Identity comes from the SAME session-cookie resolution /verify uses
// (AccessCacheService.resolveSession(), reused rather than reimplemented) —
// not a query param — so a client cannot subscribe to another user's topic
// by guessing a userId. `host` IS a query param (the service host the
// pending page is about), since it's not secret and the browser already
// knows it (it's embedded in the page's own `redirect` URL).
//
// No auth failure response here (no 401/403) — an unauthenticated or
// malformed request just gets a connection that only ever emits keepalives,
// mirroring apps/tdr-code/src/sse/sse.controller.ts's own "nothing to
// subscribe to is not an error" posture. The pending page itself never
// opens this connection without a real session (U5's /verify already
// redirected anyone without one to /login before the pending page ever
// renders), so this is defense in depth, not the primary gate.
//
// admin()'s own route below is the exception to that "no auth failure
// response" posture: it IS guarded (@UseGuards(AdminGuard)), a real 401/403
// rather than a keepalive-only degrade. The pending route above is
// deliberately permissive because a signed-out or wrong-host request there
// simply has no topic to subscribe to and leaks nothing by degrading
// silently; the admin route broadcasts one flat, unscoped topic to every
// subscriber, so there is real data (that admin state is changing at all)
// to keep from a non-admin, and AdminGuard is the same guard every other
// admin-only route in this app already uses.
// ──────────────────────────────────────────────────────────────────────────────
@Controller('sse')
export class SseController {
  constructor(
    private readonly notifyBus: NotifyBusService,
    private readonly accessCache: AccessCacheService,
  ) {}

  @Sse('pending')
  async pending(
    @Req() req: Request,
    @Query('host') serviceHost: string | undefined,
  ): Promise<Observable<MessageEvent>> {
    const session = await this.accessCache.resolveSession(req.headers.cookie)
    const topic =
      session && serviceHost ? topicFor(session.userId, serviceHost) : null

    // A monotonic per-connection counter, assigned explicitly on every
    // message — never NestJS's own auto-id, which falls back to a
    // starts-at-null `lastEventId++` that produces the string "NaN" forever
    // (see apps/tdr-code/src/sse/sse.controller.ts's identical comment for
    // the full citation against the installed SseStream source).
    let nextId = 0

    const keepaliveMs = parseInt(env(EnvKeys.SSE_KEEPALIVE_MS, '25000'), 10)
    const keepalive$ = timer(keepaliveMs, keepaliveMs).pipe(
      map(
        (): MessageEvent => ({
          data: {},
          id: String(nextId++),
          type: KEEPALIVE_EVENT_TYPE,
        }),
      ),
    )

    if (!topic) return keepalive$

    // The signal payload carries no data beyond "something changed for this
    // pair" — deliberately. The pending page reacts by re-checking status
    // (GET the same status endpoint it calls on load/reconnect) rather than
    // trusting anything this event claims, which is also what makes the
    // reconnect-then-recheck property hold with one code path instead of
    // two.
    const data$ = this.notifyBus.stream$.pipe(
      filter(signal => signal.topic === topic),
      map(
        (): MessageEvent => ({
          data: {},
          id: String(nextId++),
          type: STATUS_CHANGED_EVENT_TYPE,
        }),
      ),
    )

    return merge(data$, keepalive$)
  }

  // The admin dashboard's live channel. GET /sse/admin, reached through the
  // SAME non-stripping /api/sse/:path* rewrite the pending route above
  // already relies on (a wildcard — no next.config.js change needed for
  // this second path). Unlike pending() above, this is a flat broadcast
  // with no per-connection topic to derive: every admin subscribes to the
  // SAME ADMIN_TOPIC, so there's no `host`/userId query param and no `topic`
  // local to compute.
  @Sse('admin')
  @UseGuards(AdminGuard)
  admin(): Observable<MessageEvent> {
    let nextId = 0

    const keepaliveMs = parseInt(env(EnvKeys.SSE_KEEPALIVE_MS, '25000'), 10)
    const keepalive$ = timer(keepaliveMs, keepaliveMs).pipe(
      map(
        (): MessageEvent => ({
          data: {},
          id: String(nextId++),
          type: KEEPALIVE_EVENT_TYPE,
        }),
      ),
    )

    // Same "carries no data beyond the fact that something changed"
    // contract as the pending route's data$ above — the dashboard reacts by
    // calling router.refresh() (a full server-side re-fetch), never by
    // trusting anything this event claims.
    const data$ = this.notifyBus.stream$.pipe(
      filter(signal => signal.topic === ADMIN_TOPIC),
      map(
        (): MessageEvent => ({
          data: {},
          id: String(nextId++),
          type: ADMIN_CHANGED_EVENT_TYPE,
        }),
      ),
    )

    return merge(data$, keepalive$)
  }
}
