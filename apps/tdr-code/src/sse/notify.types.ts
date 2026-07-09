// Process-neutral IPC wire type: Node stdlib + dependency-free local imports
// ONLY. No @nestjs/*, no providers, no rxjs — this file must be safely
// importable from the bot child process without ever risking instantiation
// of anything from SseModule (which is main-process-only — see
// sse.module.ts's header comment). Mirrors sse.types.ts's own
// plane-neutrality rule, one level narrower: this is the literal shape sent
// over `process.send`/`child.on('message')`, not the in-process signal type.
//
// The bot's NotifyEmitterService constructs this shape and calls
// process.send?.(msg); the main process's supervisor IPC bridge (U4, not
// built here) validates an incoming `message` payload against isNotifyMessage
// before trusting it and forwarding topics to NotifyBusService.

import { isTopic, type Topic } from './sse.types'

export interface NotifyMessage {
  type: 'notify'
  topics: Topic[]
}

// Defensive validator for the receiving end (U4) — a message arriving over
// IPC is untrusted input regardless of which process sent it. Every element
// of `topics` must itself be a well-formed Topic; a single malformed entry
// fails the whole message rather than silently dropping just that entry.
export function isNotifyMessage(value: unknown): value is NotifyMessage {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    candidate.type === 'notify' &&
    Array.isArray(candidate.topics) &&
    candidate.topics.every((topic: unknown) => isTopic(topic))
  )
}
