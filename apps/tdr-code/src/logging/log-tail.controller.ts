import {
  Controller,
  Headers,
  type MessageEvent,
  Query,
  Sse,
} from '@nestjs/common'
import { map, Observable } from 'rxjs'

import { parseQuery } from 'src/console/query-params'
import {
  LOG_TAIL_EVENT_TYPE,
  LOG_TAIL_KEEPALIVE_EVENT_TYPE,
} from 'src/logging/log-view.types'

import { LogTailService } from './log-tail.service'
import { LogTailQuerySchema } from './logs.dto'

// Resolves the resume offset per this unit's constraint #2: a
// `Last-Event-ID` header (sent automatically by a native EventSource on
// every auto-reconnect to the SAME URL, which cannot change its own query
// string) takes precedence over the first-connect-only `?from=` query
// value, which in turn falls back to "current EOF" (undefined; the service
// resolves that default itself) when neither is present. Malformed/
// non-numeric header values are treated the same as "absent" rather than
// rejected — a garbled Last-Event-ID should degrade to the next fallback,
// not 400 an otherwise-valid reconnect.
function resolveFromOffset(
  lastEventId: string | undefined,
  from: number | undefined,
): number | undefined {
  if (lastEventId !== undefined) {
    const parsed = parseInt(lastEventId, 10)
    if (Number.isInteger(parsed) && parsed >= 0) return parsed
  }
  return from
}

// A NEW, separate `@Controller('logs')` + `@Sse('tail')` — NOT a method
// added to LogsController — so this route's path is exactly `/logs/tail`
// (reached at `/api/logs/tail` through the Next rewrite), never
// `/logs/logs/tail` (this unit's constraint #1: @Sse('tail') on a
// @Controller('logs') class composes as 'logs' + '/' + 'tail', whereas
// @Sse('logs/tail') would double the 'logs' prefix). NestJS allows two
// controller classes to share the same @Controller() prefix as long as
// their method+path pairs don't collide (see logs.controller.ts's own
// header comment on the identical situation with BrowserLogsController) —
// this class is wired into logging.module.ts alongside LogsController.
//
// No auth code here (this unit's constraint #10, mirrors sse.controller.ts's
// own identical note): the global APP_GUARD (AuthGuard, registered in
// app.module.ts) already covers every route that isn't @Public() — and this
// class carries no @Public() decorator.
@Controller('logs')
export class LogTailController {
  constructor(private readonly logTail: LogTailService) {}

  @Sse('tail')
  tail(
    @Query() raw: Record<string, string>,
    @Headers('last-event-id') lastEventId: string | undefined,
  ): Observable<MessageEvent> {
    // R17 enforcement happens HERE, before any fs call: parseQuery throws
    // BadRequestException synchronously for an unknown `stream` value, and
    // LogTailService.watch() is never invoked in that case (see
    // log-tail.controller.spec.ts's error-path test, which asserts the
    // service mock is never called).
    const { stream, from: fromQuery } = parseQuery(LogTailQuerySchema, raw)
    const from = resolveFromOffset(lastEventId, fromQuery)

    return this.logTail.watch({ stream, from }).pipe(
      map((event): MessageEvent => {
        if (event.kind === 'keepalive') {
          // The keepalive's own `id` is deliberately OMITTED (not merely
          // absent from the type): unlike sse.controller.ts's shared
          // counter (where data and keepalive interleave on the SAME
          // monotonic sequence), a tail keepalive carries no byte position
          // of its own to report, and setting `id` to the CURRENT
          // lastOffset would be actively wrong — a reconnect after a
          // keepalive-only quiet period must still resume from the last
          // REAL line's offset, not from a value that merely happened to
          // be true when the keepalive fired (which the service also has
          // no cheap way to guarantee is still accurate by the time the
          // event serializes). Every real EventSource implementation
          // retains the last id it saw across events that omit one, so
          // this is the safe choice, not an oversight.
          return { data: {}, type: LOG_TAIL_KEEPALIVE_EVENT_TYPE }
        }
        // The message `id` = the new byte offset (this unit's constraint
        // #4) — never a bare incrementing counter and never NestJS's own
        // broken default id behavior (see sse.controller.ts's header
        // comment on that installed bug). Using byteOffset directly (not
        // `nextId++`) is what makes `Last-Event-ID` a real resume position
        // instead of an opaque sequence number.
        return {
          data: event.message,
          id: String(event.message.byteOffset),
          type: LOG_TAIL_EVENT_TYPE,
        }
      }),
    )
  }
}
