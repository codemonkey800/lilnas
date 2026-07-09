import { Injectable } from '@nestjs/common'
import { PinoLogger } from 'nestjs-pino'

import { LOG_EVENTS } from 'src/logging/log-events'
import type { NotifyMessage } from 'src/sse/notify.types'
import type { Topic } from 'src/sse/sse.types'

// Per-topic coalescing window (R7): a fresh 50ms window opens on the first
// notify() call for a topic; further notify() calls for that SAME topic
// within the window are absorbed into it (no additional process.send).
// Mirrors SseHubService's THROTTLE_WINDOW_MS on the main-process side, kept
// as an independent local constant rather than a shared import — the plan
// explicitly defers an env-tunable window to a future follow-up, and the two
// windows are allowed to drift independently since they gate different
// hops (bot->main IPC vs. main->browser SSE).
const COALESCE_WINDOW_MS = 50

// NotifyEmitterService — the bot process's half of the notify channel
// (Decision 1A / process-scoping invariant). Turns bot-side writes into IPC
// notify messages sent to the parent (main-server) process via
// `process.send`. A DiscordModule provider, injected directly by the three
// write chokepoints in that same module (CompositeAcpHandler,
// SessionManagerService, BotLifecycleService) — no cross-module import, no
// DI cycle.
//
// Guarded no-op (load-bearing): `process.send` is undefined whenever this
// process was not spawned with an `ipc` stdio channel — dev-standalone mode
// (SUPERVISE_BOT=false), or any Jest spec that constructs this service
// directly. In that case notify() must never throw, queue, or otherwise
// behave differently from the IPC-connected case from the caller's
// perspective — it silently no-ops. This is the bot-side mirror of
// SseModule's own process-scoping invariant (sse.module.ts): the guarantee
// there is "the hub/bus never instantiate in the bot process"; the
// guarantee here is "the emitter never behaves badly when there is no
// parent to notify".
//
// Fire-and-forget: a failed or backpressured process.send (throws, or
// returns false) is non-fatal — the main-process fallback tick (U1) is the
// correctness backstop for any lost notify, so this service never retries
// and never surfaces a failure to its caller.
@Injectable()
export class NotifyEmitterService {
  private readonly pending = new Map<Topic, NodeJS.Timeout>()

  constructor(private readonly logger: PinoLogger) {}

  notify(topics: Topic[]): void {
    for (const topic of topics) {
      this.scheduleTopic(topic)
    }
  }

  private scheduleTopic(topic: Topic): void {
    // Already have an open window for this topic — the eventual send will
    // cover this call too. Never opens a second timer per topic (one handle
    // per key).
    if (this.pending.has(topic)) return

    const timer = setTimeout(() => {
      this.pending.delete(topic)
      this.send(topic)
    }, COALESCE_WINDOW_MS)
    // Unref so a pending coalesce window can never keep the bot process
    // alive on its own (mirrors session-manager.service.ts's timeoutReject
    // pattern for the same reason).
    timer.unref()
    this.pending.set(topic, timer)
  }

  private send(topic: Topic): void {
    if (!process.send) {
      this.logger.debug(
        { event: LOG_EVENTS.notifyEmitSkippedNoIpc, topic },
        'notify skipped — no IPC channel (standalone/test)',
      )
      return
    }

    const message: NotifyMessage = { type: 'notify', topics: [topic] }
    try {
      process.send(message)
      this.logger.debug(
        { event: LOG_EVENTS.notifyEmitted, topic },
        'notify emitted',
      )
    } catch (err) {
      // Fire-and-forget — see header comment. A throw here (e.g. the parent
      // already exited) must never propagate into the write chokepoint that
      // triggered this notify.
      this.logger.debug(
        { event: LOG_EVENTS.notifyEmitSkippedNoIpc, topic, err },
        'notify send failed — degrading to fallback tick',
      )
    }
  }
}
