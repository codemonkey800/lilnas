import { useEffect, useState } from 'react'

import type { OpEvent, OpLine } from 'src/compose/compose.types'
import { API_BASE, type Operation } from 'src/lib/api'

/** Wait this long before reopening a dropped stream. */
export const OP_RECONNECT_MS = 1500

export interface OperationStream {
  lines: OpLine[]
  /** The finished operation, once the stream says `done`. */
  done: Operation | null
}

export function operationStreamUrl(opId: string): string {
  return `${API_BASE}/operations/${encodeURIComponent(opId)}/stream`
}

function parseEvent(data: unknown): OpEvent | null {
  if (typeof data !== 'string') return null
  try {
    const event = JSON.parse(data) as OpEvent
    return event.type === 'line' || event.type === 'done' ? event : null
  } catch {
    return null
  }
}

/**
 * Follows one operation. The endpoint replays every line so far and then
 * goes live, so a dropped connection starts over from an empty list rather
 * than letting `EventSource` reconnect and print everything twice. The server
 * closes the stream after `done`; that is not an error and is not retried.
 * `opId` is fixed for the life of the component (callers key on it), so the
 * state never has to be reset for a different operation.
 */
export function useOperationStream(opId: string): OperationStream {
  const [lines, setLines] = useState<OpLine[]>([])
  const [done, setDone] = useState<Operation | null>(null)

  useEffect(() => {
    let source: EventSource | null = null
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let finished = false

    const open = () => {
      setLines([])
      const stream = new EventSource(operationStreamUrl(opId))
      source = stream

      stream.onmessage = message => {
        const event = parseEvent(message.data)
        if (!event) return
        if (event.type === 'line') {
          setLines(prev => [...prev, event.line])
          return
        }
        finished = true
        setDone(event.operation)
        stream.close()
      }
      stream.onerror = () => {
        stream.close()
        if (!finished) reconnect = setTimeout(open, OP_RECONNECT_MS)
      }
    }

    open()

    return () => {
      source?.close()
      clearTimeout(reconnect)
    }
  }, [opId])

  return { lines, done }
}
