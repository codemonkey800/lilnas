'use client'

import type { JSX, ReactNode } from 'react'
import { useEffect, useState } from 'react'

import type { CreateJobEventsStoreOptions } from 'src/lib/use-job-events'
import { createJobEventsStore, JobEventsContext } from 'src/lib/use-job-events'

export type JobEventsProviderProps = CreateJobEventsStoreOptions & {
  children: ReactNode
}

/**
 * Owns one download-gateway socket for the subtree below it, and the job map
 * every `useJobEvents()` call inside reads from.
 *
 * One provider per page, not one per consumer: several components on the
 * activity page want the same feed, and each of them opening its own socket
 * would multiply the gateway's client count for no gain. `useJobEvents()`
 * throws without this ancestor precisely so that cannot happen by accident.
 *
 * Renders nothing of its own — no wrapper element, so it can be dropped
 * anywhere in a tree without disturbing layout. The socket is opened in an
 * effect, so a server render costs nothing and an unmount (a route change,
 * a closed modal) closes the connection and cancels any pending reconnect
 * rather than leaking either.
 *
 * The store options are read once, when the store is created. They exist as
 * test seams (jsdom has no usable `WebSocket`) and are not meant to change
 * over a mounted provider's life.
 */
export function JobEventsProvider({
  children,
  ...options
}: JobEventsProviderProps): JSX.Element {
  // Lazy `useState` rather than `useMemo`: React may discard a `useMemo`
  // result at will, and a second store would silently orphan every
  // subscription registered against the first.
  const [store] = useState(() => createJobEventsStore(options))

  useEffect(() => store.connect(), [store])

  return (
    <JobEventsContext.Provider value={store}>
      {children}
    </JobEventsContext.Provider>
  )
}
