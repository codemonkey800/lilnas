import { env } from '@lilnas/utils/env'
import {
  Controller,
  Headers,
  type MessageEvent,
  Query,
  Sse,
} from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'
import { finalize, map, merge, Observable, timer } from 'rxjs'

import { EnvKeys } from 'src/env'
import { LOG_EVENTS } from 'src/logging/log-events'

import { isTopic, type Topic } from './sse.types'
import { SseHubService } from './sse-hub.service'

// Parses the comma-separated `?topics=` query value into a validated
// Topic[], silently dropping anything isTopic() rejects. A GET request with
// no meaningful topics is not an error (there is nothing to synchronously
// reject on an SSE handshake) — the caller just opens a connection that
// only ever emits keepalives, per the plan's own resolved approach.
function parseTopics(raw: string | undefined): Topic[] {
  if (!raw) return []
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(isTopic)
}

// The keepalive event's `type` — distinguishes it from a real signal on the
// wire (a real signal's MessageEvent carries `type: <topic>`) without the
// client needing to inspect `data`.
const KEEPALIVE_EVENT_TYPE = 'keepalive'

// One multiplexed `@Sse('stream')` endpoint (R1): the client selects topics
// via `?topics=a,b,c`; this controller subscribes to SseHubService for
// exactly those topics and maps each hub signal to a MessageEvent, merged
// with a periodic keepalive so the connection doesn't look dead while idle
// (R2's keepalive carve-out).
//
// No auth code here (R3): the global APP_GUARD (AuthGuard, registered in
// app.module.ts) already covers every route that isn't @Public() — and this
// class carries no @Public() decorator, so it is guarded like any other
// route. @Sse() itself only tags the handler as GET + SSE metadata (verified
// by reading the installed decorator source) — it has no auth-adjacent
// behavior of its own.
@Controller()
export class SseController {
  constructor(
    private readonly sseHub: SseHubService,
    private readonly logger: PinoLogger,
  ) {}

  @Sse('stream')
  stream(
    @Query('topics') topicsParam: string | undefined,
    @Headers('last-event-id') lastEventId: string | undefined,
  ): Observable<MessageEvent> {
    const topics = parseTopics(topicsParam)
    const { connectionId, signals$ } = this.sseHub.subscribe(topics)

    this.logger.info(
      {
        event: LOG_EVENTS.sseConnected,
        connectionId,
        topics,
        lastEventId,
      },
      'SSE client connected',
    )

    // A monotonic per-connection counter, assigned explicitly on every
    // message — never NestJS's own auto-id. (The installed SseStream
    // writeMessage() falls back to `this.lastEventId++` starting from
    // `null`, which produces the string "NaN" forever incrementing from
    // NaN — a genuinely broken counter, not merely an inconvenient one.)
    let nextId = 0

    const keepaliveMs = parseInt(env(EnvKeys.SSE_KEEPALIVE_MS, '25000'), 10)

    const data$ = signals$.pipe(
      map(
        (signal): MessageEvent => ({
          data: signal,
          id: String(nextId++),
          type: signal.topic,
        }),
      ),
    )

    // A benign, comment-equivalent event on a steady cadence — chosen over
    // a raw `:\n\n` write to keep this handler entirely within the
    // Observable<MessageEvent> contract @Sse() expects (no @Res()
    // passthrough, no manual response handle to track/clear on teardown).
    // The keepalive carries its own `id` from the same counter as the data
    // stream so ids stay monotonic across both sources on one connection,
    // and a `type` distinct from any real topic so a client can ignore it
    // without inspecting `data`.
    const keepalive$ = timer(keepaliveMs, keepaliveMs).pipe(
      map(
        (): MessageEvent => ({
          data: {},
          id: String(nextId++),
          type: KEEPALIVE_EVENT_TYPE,
        }),
      ),
    )

    return merge(data$, keepalive$).pipe(
      finalize(() => {
        this.sseHub.unsubscribe(connectionId)
        this.logger.info(
          { event: LOG_EVENTS.sseClientDisconnected, connectionId },
          'SSE client disconnected',
        )
      }),
    )
  }
}
