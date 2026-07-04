'use client'

import { useEffect } from 'react'

import { LOG_EVENTS } from 'src/logging/log-events'

import { logEvent } from './browser-logger'

// Delegated, single-listener click tracking via a `data-track-id` attribute
// convention — mirrors error-reporter.tsx's "one mounted listener" shape
// rather than scattering logEvent() calls inside individual onClick
// handlers. `grep -r data-track-id src/app` is the complete audit of
// everything tracked; instrumenting a new button later is a one-line JSX
// attribute, no new imports or wiring required.
export function ClickTracker() {
  useEffect(() => {
    function handleClick(event: MouseEvent) {
      const target = event.target
      if (!(target instanceof Element)) return
      const trackedEl = target.closest<HTMLElement>('[data-track-id]')
      if (!trackedEl) return
      logEvent(LOG_EVENTS.buttonClick, { id: trackedEl.dataset.trackId })
    }

    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [])

  return null
}
