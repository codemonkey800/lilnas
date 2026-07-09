'use client'

import { useReportWebVitals } from 'next/web-vitals'

import { LOG_EVENTS } from 'src/logging/log-events'

import { logEvent } from './browser-logger'

// Core Web Vitals telemetry — the console had zero performance instrumentation
// before this. useReportWebVitals is Next's first-party hook (part of the
// `next` package, no extra dependency); its callback fires once per metric
// (LCP/FCP/CLS/TTFB/INP) as each is measured. Mounted once in layout.tsx
// alongside the other always-on trackers (ErrorReporter/PageViewTracker/
// ClickTracker).
//
// logEvent (info): the metric name + rating ride in the context object. The
// value is rounded to 3 decimals to strip float noise — via `* 1000` then
// `/ 1000`, NOT a plain Math.round, because CLS is a small unitless ratio
// (typically ~0.0–0.5) that a round-to-integer would floor to 0 and destroy,
// while the millisecond metrics (LCP/FCP/TTFB/INP) are unaffected by the extra
// precision. `id` is web-vitals' own per-instance id, useful for de-duping the
// multiple reports a metric like CLS can emit over a single page's lifetime.
export function WebVitalsReporter() {
  useReportWebVitals(metric => {
    logEvent(LOG_EVENTS.webVital, {
      name: metric.name,
      value: Math.round(metric.value * 1000) / 1000,
      rating: metric.rating,
      id: metric.id,
    })
  })

  return null
}
