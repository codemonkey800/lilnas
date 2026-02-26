'use client'

import { createContext, useContext } from 'react'

const ScrollContainerContext = createContext<HTMLDivElement | null>(null)

export const ScrollContainerProvider = ScrollContainerContext.Provider

export function useScrollContainer() {
  return useContext(ScrollContainerContext)
}
