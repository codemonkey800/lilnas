import { Injectable } from '@nestjs/common'
import { Subject } from 'rxjs'

// ──────────────────────────────────────────────────────────────────────────────
// U6 (R9, AE3): in-process pub/sub for "something changed for this (user,
// service) pair" — originally just a grant, now also a rejection (see
// requests.service.ts's own header comment on the rejection-visibility
// revision). Deliberately much simpler than
// apps/tdr-code/src/sse/sse-hub.service.ts's equivalent: that file's
// fallback-polling/data_version/groupBy-throttle machinery exists because
// tdr-code is a TWO-PROCESS topology (a separate bot process writes, the web
// server reads), where a notify can genuinely be missed by the subscriber's
// own process. lilnas-auth is ONE process — the admin approve/reject actions
// and this SSE plumbing share the same event loop and the same
// AccessCacheService instance, so an in-process publish() is never missed by
// a live subscriber. No polling backstop is needed; a plain RxJS Subject is
// the whole job. (A dropped/reconnecting BROWSER connection is a different,
// real concern — that's handled by the pending page re-checking status on
// every SSE open, not by anything in this file.)
//
// Extended for the admin dashboard's live updates: a second, broadcast-style
// topic (ADMIN_TOPIC below) rides the SAME Subject/stream$ as the per-
// (userId, serviceHost) topics above — there is no reason for the dashboard's
// "something changed" signal to need its own Subject, timer, or module; it
// only needs its own topic string so SseController's admin route can filter
// on it independently of the pending route's per-user filtering.
// ──────────────────────────────────────────────────────────────────────────────

export type StatusChangeSignal = { topic: string }

// One topic per (userId, serviceHost) pair — exported so both the publisher
// (RequestsService's approve/reject/bulkReject, and this unit's own tests
// standing in for it) and the subscriber (SseController) derive the
// identical key from the same two values, rather than each formatting it
// separately and risking drift.
export function topicFor(userId: string, serviceHost: string): string {
  return `${userId}:${serviceHost}`
}

// The admin dashboard's one flat, broadcast topic — every admin connection
// subscribes to the SAME topic (there is no per-admin scoping the way the
// pending topic is scoped per user), so this is a plain constant rather
// than a function like topicFor() above.
export const ADMIN_TOPIC = 'admin'

@Injectable()
export class NotifyBusService {
  private readonly subject = new Subject<StatusChangeSignal>()

  readonly stream$ = this.subject.asObservable()

  // Fire-and-forget, deliberately synchronous and side-effect-free beyond
  // the emit itself — the approve action calls this AFTER writing the
  // grant and invalidating AccessCacheService, in that order (per the
  // plan's Key Technical Decisions: "Publishing before invalidating would
  // race the user's redirect against a stale cache"); reject/bulkReject
  // call this after writing the decision, with no cache step (there is no
  // grant to invalidate). This class has no opinion on that ordering; it
  // just fans the signal out to whoever is subscribed at call time.
  publishStatusChange(userId: string, serviceHost: string): void {
    this.subject.next({ topic: topicFor(userId, serviceHost) })
  }

  // Fire-and-forget, same posture as publishStatusChange() above — every
  // admin-visible mutation (RequestsService's approve/reject/bulkReject/new-
  // request paths, UsersService's pre-authorize/edit-access/remove/block/
  // unblock) calls this AFTER its own write (and, where one exists, AFTER
  // its own AccessCacheService invalidation), mirroring the same
  // write -> invalidate -> publish ordering this file's own header comment
  // already documents for publishStatusChange().
  publishAdminChange(): void {
    this.subject.next({ topic: ADMIN_TOPIC })
  }
}
