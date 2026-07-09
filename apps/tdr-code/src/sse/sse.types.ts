// Plane-neutral SSE topic + message contract: Node stdlib + dependency-free
// local imports ONLY. No @nestjs/*, no react/next, no pino, no rxjs. This
// file is imported by the main backend process (producer + hub), the bot
// child process (a later unit's notify emitter), and the browser bundle (a
// later unit's EventSource client), so it must never pull in a framework —
// mirrors src/logging/log-events.ts's plane-neutrality rule.
//
// Three topic shapes: the two fixed derived topics ('live', 'bot-status')
// plus a parameterized per-session topic ('session:<id>'). isTopic()/
// sessionTopic()/parseSessionTopic() are the only sanctioned way to
// construct/validate a Topic — never hand-format a `session:${id}` template
// literal at a call site, so the prefix stays in one place.

export const FIXED_TOPICS = ['live', 'bot-status'] as const
export type FixedTopic = (typeof FIXED_TOPICS)[number]

const SESSION_TOPIC_PREFIX = 'session:'

export type SessionTopic = `session:${string}`
export type Topic = FixedTopic | SessionTopic

// A signal is a bare topic wake-up — never a payload. The receiver always
// re-reads current state (the notify-bus / hub / snapshot-refetch model);
// carrying data on this type would re-introduce the fork-coupling failure
// the two-process design consciously avoids (see the plan's "notify stays
// non-authoritative" note).
export interface NotifySignal {
  topic: Topic
}

export function sessionTopic(sessionId: number | string): SessionTopic {
  return `${SESSION_TOPIC_PREFIX}${sessionId}`
}

export function isFixedTopic(value: string): value is FixedTopic {
  return (FIXED_TOPICS as readonly string[]).includes(value)
}

export function isSessionTopic(value: string): value is SessionTopic {
  return (
    value.startsWith(SESSION_TOPIC_PREFIX) &&
    value.length > SESSION_TOPIC_PREFIX.length
  )
}

export function isTopic(value: unknown): value is Topic {
  return (
    typeof value === 'string' && (isFixedTopic(value) || isSessionTopic(value))
  )
}

// Returns the raw id suffix (still a string — callers that need a number
// parse it themselves) or null if `value` is not a well-formed session
// topic.
export function parseSessionTopic(value: string): string | null {
  return isSessionTopic(value) ? value.slice(SESSION_TOPIC_PREFIX.length) : null
}
