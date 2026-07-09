import { render } from '@testing-library/react'

import { WebVitalsReporter } from 'src/app/lib/web-vitals-reporter'

// next/web-vitals' useReportWebVitals internally wires a useEffect that only
// fires in a real browser with the web-vitals observers — mock it to simply
// capture the callback the component registers, so a test can drive it with a
// fabricated metric. Mirrors login.spec.tsx's own next/navigation mock shape
// (a mock-prefixed jest.fn referenced inside the factory).
const mockUseReportWebVitals = jest.fn<void, [(metric: unknown) => void]>()
jest.mock('next/web-vitals', () => ({
  useReportWebVitals: (cb: (metric: unknown) => void) =>
    mockUseReportWebVitals(cb),
}))

// logEvent -> a bare global fetch, which jsdom does not provide (see
// browser-logger.spec.tsx) — install the same stand-in.
const mockFetch = jest.fn()

beforeEach(() => {
  mockUseReportWebVitals.mockReset()
  mockFetch.mockReset().mockResolvedValue(undefined)
  global.fetch = mockFetch as unknown as typeof fetch
})

function reportMetric(metric: Record<string, unknown>): void {
  render(<WebVitalsReporter />)
  const cb = mockUseReportWebVitals.mock.calls[0]?.[0]
  if (!cb) throw new Error('WebVitalsReporter did not register a callback')
  cb(metric)
}

function lastBeaconBody(): {
  level: string
  event: string
  context?: { name?: string; value?: number; rating?: string; id?: string }
} {
  const call = mockFetch.mock.calls.at(-1)
  if (!call) throw new Error('expected a browser-log beacon fetch')
  return JSON.parse(call[1]?.body as string)
}

describe('WebVitalsReporter', () => {
  it('logs a web-vital event (info) with name, rating, id, and the rounded value', () => {
    reportMetric({
      name: 'LCP',
      value: 1234.5678,
      rating: 'good',
      id: 'v1-abc',
    })

    expect(mockFetch).toHaveBeenCalledTimes(1)
    const body = lastBeaconBody()
    expect(body.level).toBe('info')
    expect(body.event).toBe('web-vital')
    expect(body.context).toEqual({
      name: 'LCP',
      value: 1234.568, // rounded to 3 decimals
      rating: 'good',
      id: 'v1-abc',
    })
  })

  it('preserves a small CLS value when rounding instead of flooring it to 0', () => {
    reportMetric({
      name: 'CLS',
      value: 0.0473,
      rating: 'needs-improvement',
      id: 'v1-cls',
    })

    // Math.round(0.0473) would be 0 — the * 1000 / 1000 rounding keeps it.
    expect(lastBeaconBody().context?.value).toBe(0.047)
  })

  it('renders nothing — it is a telemetry-only component', () => {
    const { container } = render(<WebVitalsReporter />)
    expect(container).toBeEmptyDOMElement()
  })
})
