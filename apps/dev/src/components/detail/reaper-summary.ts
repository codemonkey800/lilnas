import type { ReapEstimate } from 'src/activity/host-activity.service'
import type { IdleReap } from 'src/registry/registry.types'
import type { ServiceView, StackView } from 'src/stacks/stacks.types'

export interface ReaperSummary {
  /** Whether the reaper would ever stop this stack. */
  enabled: boolean
  /** Hours; unset when no service is reapable. */
  maxIdleHours?: number
  /** Where the setting came from: `label`, `auto-detected` or `mixed`. */
  maxIdleSource?: string
  /** ISO time of the last sign of life across the running routed services. */
  lastActiveAt?: string
  activeUsers?: number
  reapsAt?: string
  /** 0–100: how much of the max-idle window has gone by. */
  idlePct?: number
  /** One or two sentences on where the numbers come from. */
  basis: string
}

const HOUR_MS = 3_600_000

const isRunning = (svc: ServiceView) => svc.container?.state === 'running'

function sourceOf(reapable: IdleReap[]): string {
  const reasons = new Set(reapable.map(r => r.reason))
  if (reasons.size > 1) return 'mixed'
  return reasons.has('label') ? 'label' : 'auto-detected'
}

function routeCount(stack: StackView): number {
  return new Set(stack.services.flatMap(s => s.routes.map(r => r.url))).size
}

/** What the reaper does with the containers, which differs by source. */
function scope(stack: StackView): string {
  return stack.source === 'dev'
    ? 'The reaper stops and removes every container of the stack together and keeps its networks and volumes.'
    : 'The reaper stops and removes one container at a time and keeps its networks and volumes.'
}

function basisSentence(stack: StackView, basis: ReapEstimate['basis']): string {
  const routes = routeCount(stack)
  switch (basis) {
    case 'auth':
      return `Latest visit across the stack’s ${routes} ${routes === 1 ? 'route' : 'routes'}, from the auth service. ${scope(stack)}`
    case 'container-start':
      return `Nobody has visited yet, so the clock runs from when the container started. ${scope(stack)}`
    case 'unknown':
      return 'The auth service didn’t answer, so the reaper leaves this stack alone until it does.'
    case 'disabled':
      return 'Idle reaping is off for this stack.'
  }
}

/**
 * Folds the per-container reap estimates into the one clock the panel shows.
 * A stack is reaped as a unit, so the clock is the *latest* activity of any
 * reapable running container and it runs out when the last of them does.
 */
export function summarizeReaper(stack: StackView): ReaperSummary {
  const reapable = stack.services.filter(s => s.idleReap.enabled)

  if (reapable.length === 0) {
    const labelled = stack.services.some(s => s.idleReap.reason === 'label')
    return {
      enabled: false,
      basis: labelled
        ? 'Idle reaping is off: lilnas.idle-reap.enabled=false on this stack.'
        : 'Idle reaping is off: none of its routes is on *.dev.lilnas.io, so the reaper doesn’t look at it.',
    }
  }

  const idleReaps = reapable.map(s => s.idleReap)
  const maxIdleHours = Math.min(...idleReaps.map(r => r.maxIdleHours))
  const maxIdleSource = sourceOf(idleReaps)

  const live = reapable.filter(isRunning)
  if (live.length === 0) {
    return {
      enabled: true,
      maxIdleHours,
      maxIdleSource,
      basis:
        'Nothing is running, so there is nothing to reap. The clock starts when a container does.',
    }
  }

  const estimates = live.map(s => s.reap)
  const basis = estimates.some(e => e.basis === 'unknown')
    ? 'unknown'
    : estimates.some(e => e.basis === 'auth')
      ? 'auth'
      : 'container-start'

  if (basis === 'unknown') {
    return {
      enabled: true,
      maxIdleHours,
      maxIdleSource,
      basis: basisSentence(stack, basis),
    }
  }

  const lastActiveAt = estimates
    .map(e => e.lastActiveAt)
    .filter((t): t is string => Boolean(t))
    .sort()
    .at(-1)
  const activeUsers = Math.max(0, ...estimates.map(e => e.activeUsers ?? 0))
  const reapsAt =
    activeUsers > 0
      ? undefined
      : estimates
          .map(e => e.reapsAt)
          .filter((t): t is string => Boolean(t))
          .sort()
          .at(-1)

  return {
    enabled: true,
    maxIdleHours,
    maxIdleSource,
    lastActiveAt,
    activeUsers,
    reapsAt,
    basis: basisSentence(stack, basis),
  }
}

/** Share of the window already idle, clamped to a bar. */
export function idlePercent(
  lastActiveAt: string | undefined,
  maxIdleHours: number | undefined,
  now: number,
): number | undefined {
  const last = lastActiveAt ? Date.parse(lastActiveAt) : NaN
  if (Number.isNaN(last) || !maxIdleHours) return undefined
  return Math.min(
    100,
    Math.max(0, ((now - last) / (maxIdleHours * HOUR_MS)) * 100),
  )
}
