'use client'

import {
  createContext,
  type JSX,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from 'react'

export interface PendingPassword {
  /** Holds a password until `take` or `clear`; replaces any held one. */
  set: (password: string) => void
  /** Returns the held password and forgets it, or null when none is held. */
  take: () => string | null
  clear: () => void
}

const PendingPasswordContext = createContext<PendingPassword | null>(null)

/**
 * Holds one password typed before a wait for the sign-in turn, so it can be
 * sent when the turn comes. It lives in a ref, never in state that renders,
 * and is dropped when the provider unmounts.
 */
export function PendingPasswordProvider({
  children,
}: {
  children: ReactNode
}): JSX.Element {
  const held = useRef<string | null>(null)

  const value = useMemo<PendingPassword>(
    () => ({
      set: password => {
        held.current = password
      },
      take: () => {
        const password = held.current
        held.current = null
        return password
      },
      clear: () => {
        held.current = null
      },
    }),
    [],
  )

  useEffect(
    () => () => {
      held.current = null
    },
    [],
  )

  return (
    <PendingPasswordContext.Provider value={value}>
      {children}
    </PendingPasswordContext.Provider>
  )
}

export function usePendingPassword(): PendingPassword {
  const value = useContext(PendingPasswordContext)
  if (!value) {
    throw new Error(
      'usePendingPassword must be used inside <PendingPasswordProvider>',
    )
  }
  return value
}
