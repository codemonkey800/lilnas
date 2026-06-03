// Shared `/health` response shape for lilnas apps. Standardizing the shape so
// load balancers, monitoring, and oncall dashboards can discriminate across
// the fleet uniformly (#35).
//
// The shape: { status: 'ok' | 'degraded', timestamp, service, deps? }
//
// `status` is `'degraded'` if any dep probe throws or returns falsy. `deps`
// is the per-dep outcome — `'ok'` or `'degraded'` strings — included only
// when at least one dep was registered.
//
// Apps wrap this in their framework's response helper (NextResponse.json,
// res.json, etc.) and choose the HTTP status from `result.status` (200 for
// 'ok', 503 for 'degraded').

export type HealthStatus = 'ok' | 'degraded'

export type HealthResponse = {
  status: HealthStatus
  timestamp: string
  service: string
  deps?: Record<string, HealthStatus>
}

export type HealthDeps = Record<string, () => unknown | Promise<unknown>>

export type HealthArgs = {
  service: string
  deps?: HealthDeps
}

export async function healthResponse(
  args: HealthArgs,
): Promise<HealthResponse> {
  const result: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: args.service,
  }
  if (!args.deps) return result

  const depResults: Record<string, HealthStatus> = {}
  for (const [name, probe] of Object.entries(args.deps)) {
    try {
      await probe()
      depResults[name] = 'ok'
    } catch {
      depResults[name] = 'degraded'
      result.status = 'degraded'
    }
  }
  result.deps = depResults
  return result
}

// HTTP status code for a `HealthResponse`. 200 when everything is up, 503
// when at least one dep is degraded — matches the convention every probe
// and load balancer in the fleet already expects.
export function healthStatusCode(result: HealthResponse): 200 | 503 {
  return result.status === 'ok' ? 200 : 503
}
