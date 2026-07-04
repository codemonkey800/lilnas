'use client'

import { usePathname } from 'next/navigation'
import { useEffect } from 'react'

import { LOG_EVENTS } from 'src/logging/log-events'

import { logEvent } from './browser-logger'

// Mounted once in layout.tsx, alongside ErrorReporter — pathname-only (no
// useSearchParams()) deliberately avoids Next's Suspense-boundary
// requirement for that hook (see login/page.tsx's LoginErrorBanner for why
// that requirement exists). Covers page visits AND page-to-page navigation
// as a single mechanism: every pathname change, whether from a <Link>,
// back/forward, or a programmatic redirect, re-runs this effect once.
export function PageViewTracker() {
  const pathname = usePathname()

  useEffect(() => {
    logEvent(LOG_EVENTS.pageView, { path: pathname })
  }, [pathname])

  return null
}
