// Pure derivation helpers for the exercise stats page. No side effects, no
// 'server-only', no DB imports — these are safe to call from server or client.

import type { DayCode } from 'src/db/schema'
import type {
  ExerciseRow,
  ProgressionRow,
  RoutineRow,
  SessionRow,
  SetLogRow,
} from 'src/db/types'

// ---------------------------------------------------------------------------
// R9: Top set (planned weight for the last set in a progressive warm-up)
// ---------------------------------------------------------------------------

/**
 * Returns the weight for the top (hardest) planned set.
 * Each set increases by `increment`, so set N gets
 *   startingWeight + increment × (N - 1)
 * For a 3-set scheme: set 1 = base, set 2 = base+inc, set 3 = base+2×inc.
 */
export function topSetPlanned(
  startingWeight: number,
  increment: number,
  sets: number,
): number {
  return startingWeight + increment * (sets - 1)
}

// ---------------------------------------------------------------------------
// R10: Heaviest weight actually logged
// ---------------------------------------------------------------------------

/**
 * Returns the maximum non-null weight across all provided set logs, or null
 * when the array is empty or every entry has a null weight.
 */
export function heaviestLogged(
  logs: Array<{ setLog: SetLogRow }>,
): number | null {
  let max: number | null = null
  for (const { setLog } of logs) {
    if (setLog.weight !== null && (max === null || setLog.weight > max)) {
      max = setLog.weight
    }
  }
  return max
}

// ---------------------------------------------------------------------------
// R11: Count of distinct completed sessions
// ---------------------------------------------------------------------------

/**
 * Returns the number of distinct sessions represented in the log array.
 */
export function sessionsPerformed(
  logs: Array<{ setLog: SetLogRow; session: SessionRow }>,
): number {
  const ids = new Set<number>()
  for (const { session } of logs) {
    ids.add(session.id)
  }
  return ids.size
}

// ---------------------------------------------------------------------------
// R11 bodyweight: reps from most recent session as "15 · 15 · 12"
// ---------------------------------------------------------------------------

/**
 * Finds the most recent session (by `completedAt` descending, then `id`
 * descending as a tiebreaker for null completedAt), collects the `actualReps`
 * for each set in that session, and formats them joined by " · ".
 *
 * Returns null when no logs are provided.
 */
export function lastResult(
  logs: Array<{ setLog: SetLogRow; session: SessionRow }>,
): string | null {
  if (logs.length === 0) return null

  // Identify the most recent session
  let bestSession: SessionRow | null = null
  for (const { session } of logs) {
    if (bestSession === null) {
      bestSession = session
      continue
    }
    const bestTime = bestSession.completedAt?.getTime() ?? Infinity
    const thisTime = session.completedAt?.getTime() ?? Infinity
    if (
      thisTime > bestTime ||
      (thisTime === bestTime && session.id > bestSession.id)
    ) {
      bestSession = session
    }
  }

  if (bestSession === null) return null
  const bestId = bestSession.id

  // Collect set logs for that session, ordered by setNumber
  const sessionLogs = logs
    .filter(r => r.session.id === bestId)
    .sort((a, b) => a.setLog.setNumber - b.setLog.setNumber)

  return sessionLogs.map(r => String(r.setLog.actualReps ?? 0)).join(' · ')
}

// ---------------------------------------------------------------------------
// R11 time-based: share of Hold sets as "75%"
// ---------------------------------------------------------------------------

/**
 * Returns the percentage of sets whose action is 'Hold', as an integer string
 * like "75%". Returns "—" when there are no sets.
 */
export function successRate(logs: Array<{ setLog: SetLogRow }>): string {
  if (logs.length === 0) return '—'
  const holdCount = logs.filter(r => r.setLog.action === 'Hold').length
  return `${Math.round((holdCount / logs.length) * 100)}%`
}

// ---------------------------------------------------------------------------
// R11 cardio: done / skipped counts
// ---------------------------------------------------------------------------

/**
 * Returns the count of sets with action 'Done' and 'Skipped' respectively.
 */
export function doneSkippedCount(logs: Array<{ setLog: SetLogRow }>): {
  done: number
  skipped: number
} {
  let done = 0
  let skipped = 0
  for (const { setLog } of logs) {
    if (setLog.action === 'Done') done++
    else if (setLog.action === 'Skipped') skipped++
  }
  return { done, skipped }
}

// ---------------------------------------------------------------------------
// R14: Consistency classification
// ---------------------------------------------------------------------------

export type ConsistencyClass = 'hit' | 'partial' | 'done' | 'skipped'

/**
 * Classifies a single session's set logs for the consistency heat-map.
 *
 * - cardio (always 1 set): 'Done' → 'done', 'Skipped' → 'skipped'
 * - weighted / bodyweight / time-based:
 *     any 'Failed' → 'partial'
 *     otherwise → 'hit'
 */
export function classifyConsistency(
  sessionLogs: SetLogRow[],
  type: ExerciseRow['type'],
): ConsistencyClass {
  if (type === 'cardio') {
    const first = sessionLogs[0]
    return first?.action === 'Done' ? 'done' : 'skipped'
  }

  const hasFailed = sessionLogs.some(log => log.action === 'Failed')
  return hasFailed ? 'partial' : 'hit'
}

// ---------------------------------------------------------------------------
// R18: Group set logs by session
// ---------------------------------------------------------------------------

export type SessionGroup<S extends SessionRow = SessionRow> = {
  session: S
  setLogs: SetLogRow[]
}

/**
 * Groups a flat list of (setLog, session) rows into per-session buckets,
 * preserving the order of first appearance (input is already newest-first).
 */
export function groupSetLogsBySession<S extends SessionRow>(
  rows: Array<{ setLog: SetLogRow; session: S }>,
): SessionGroup<S>[] {
  const seen = new Map<number, SessionGroup<S>>()
  const order: number[] = []

  for (const { setLog, session } of rows) {
    if (!seen.has(session.id)) {
      seen.set(session.id, { session, setLogs: [] })
      order.push(session.id)
    }
    seen.get(session.id)!.setLogs.push(setLog)
  }

  return order.map(id => seen.get(id)!)
}

// ---------------------------------------------------------------------------
// R15: Should we render the weight trend chart?
// ---------------------------------------------------------------------------

/**
 * Returns true when there are at least 2 progression data points to plot.
 */
export function shouldRenderWeightChart(points: ProgressionRow[]): boolean {
  return points.length >= 2
}

// ---------------------------------------------------------------------------
// R16: Has at least one logged session?
// ---------------------------------------------------------------------------

/**
 * Returns true when the log array is non-empty, indicating the exercise has
 * at least one historical session to display.
 */
export function hasLoggedSession(
  logs: Array<{ setLog: SetLogRow; session: SessionRow }>,
): boolean {
  return logs.length > 0
}

// ---------------------------------------------------------------------------
// R15: Weight-trend chart series
// ---------------------------------------------------------------------------

export type WeightTrendPoint = { date: Date; weight: number }

/**
 * Builds the weight-trend series from progression rows, then carries the
 * latest weight forward to the most recent completed session.
 *
 * Progressions only record weight *changes*, so a "Stay" session (no weight
 * change) creates no progression row and the raw series would end before the
 * most recent workout — making the chart look stale next to the history
 * journal. When the latest completed session is newer than the last
 * progression, we append a trailing point at that session's date holding the
 * last known weight (`stepAfter` then draws a flat segment to "now"). No-op
 * when the last session coincides with or predates the last progression.
 *
 * Expects `progressions` ordered oldest-first (as the data layer returns them).
 */
export function buildWeightTrendPoints(
  progressions: ProgressionRow[],
  logs: Array<{ session: SessionRow }>,
): WeightTrendPoint[] {
  const points: WeightTrendPoint[] = progressions.map(p => ({
    date: p.effectiveFrom,
    weight: p.startingWeight,
  }))
  if (points.length === 0) return points

  const last = points[points.length - 1]!

  let latest: Date | null = null
  for (const { session } of logs) {
    const at = session.completedAt
    if (at !== null && (latest === null || at.getTime() > latest.getTime())) {
      latest = at
    }
  }

  if (latest !== null && latest.getTime() > last.date.getTime()) {
    points.push({ date: latest, weight: last.weight })
  }

  return points
}

// ---------------------------------------------------------------------------
// U1: Epley e1RM + Recent-PRs counting
// ---------------------------------------------------------------------------

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Epley one-rep-max estimate: `weight × (1 + reps/30)`.
 * For reps ≤ 1 returns weight directly (identity — 1RM is the weight itself).
 */
export function estimatedOneRepMax(weight: number, reps: number): number {
  if (reps <= 1) return weight
  return weight * (1 + reps / 30)
}

type WeightedLogRow = { setLog: SetLogRow; session: SessionRow }

function isEligibleForPR(setLog: SetLogRow): boolean {
  return (
    setLog.action !== 'Failed' &&
    setLog.action !== 'Decrement' &&
    setLog.weight !== null &&
    setLog.actualReps !== null &&
    setLog.actualReps > 0
  )
}

function exerciseHasPR(rows: WeightedLogRow[], windowStartMs: number): boolean {
  const eligible = rows.filter(r => isEligibleForPR(r.setLog))
  if (eligible.length === 0) return false

  const preWindow = eligible.filter(
    r => (r.session.completedAt?.getTime() ?? 0) < windowStartMs,
  )
  const inWindow = eligible.filter(
    r => (r.session.completedAt?.getTime() ?? 0) >= windowStartMs,
  )

  if (inWindow.length === 0) return false

  let baseline: number | null = null

  if (preWindow.length > 0) {
    baseline = Math.max(
      ...preWindow.map(r =>
        estimatedOneRepMax(r.setLog.weight!, r.setLog.actualReps!),
      ),
    )
  } else if (inWindow.length >= 2) {
    // Young-exercise rule (review 2A): no pre-window history, ≥2 in-window
    // eligible sets → earliest in-window set is the baseline.
    const sorted = [...inWindow].sort((a, b) => {
      const at = a.session.completedAt?.getTime() ?? 0
      const bt = b.session.completedAt?.getTime() ?? 0
      if (at !== bt) return at - bt
      if (a.session.id !== b.session.id) return a.session.id - b.session.id
      return a.setLog.id - b.setLog.id
    })
    const earliest = sorted[0]!
    baseline = estimatedOneRepMax(
      earliest.setLog.weight!,
      earliest.setLog.actualReps!,
    )
  }

  if (baseline === null) return false

  const maxInWindow = Math.max(
    ...inWindow.map(r =>
      estimatedOneRepMax(r.setLog.weight!, r.setLog.actualReps!),
    ),
  )
  return maxInWindow > baseline
}

/**
 * Counts exercises that have a new best e1RM in the trailing 30-day window.
 * Eligible sets exclude Failed and Decrement actions, null weight, and
 * non-positive actualReps — matching the documented Failed-bug fix class.
 */
export function countExercisesWithRecentPR(
  weightedLogs: WeightedLogRow[],
  now: Date,
): number {
  if (weightedLogs.length === 0) return 0

  const windowStartMs = now.getTime() - THIRTY_DAYS_MS

  const byExercise = new Map<number, WeightedLogRow[]>()
  for (const row of weightedLogs) {
    const group = byExercise.get(row.setLog.exerciseId) ?? []
    group.push(row)
    byExercise.set(row.setLog.exerciseId, group)
  }

  let count = 0
  for (const rows of byExercise.values()) {
    if (exerciseHasPR(rows, windowStartMs)) count++
  }
  return count
}

// ---------------------------------------------------------------------------
// U2: Trend classification
// ---------------------------------------------------------------------------

const TWENTY_EIGHT_DAYS_MS = 28 * 24 * 60 * 60 * 1000

export type TrendDirection = 'up' | 'flat' | 'down'

/**
 * Classifies the direction of weight progression over the trailing 28-day
 * window. Baseline = startingWeight in effect at window start (latest
 * progression before the window, else earliest in-window/initial). Returns
 * 'flat' when there are no in-window progressions or insufficient data.
 *
 * Progressions must be ordered oldest-first (as the data layer returns them).
 */
export function classifyTrend(
  progressions: ProgressionRow[],
  now: Date,
): TrendDirection {
  if (progressions.length === 0) return 'flat'

  const windowStartMs = now.getTime() - TWENTY_EIGHT_DAYS_MS

  // Half-open window: effectiveFrom < windowStartMs → pre-window
  const preWindow = progressions.filter(
    p => p.effectiveFrom.getTime() < windowStartMs,
  )
  const inWindow = progressions.filter(
    p => p.effectiveFrom.getTime() >= windowStartMs,
  )

  if (inWindow.length === 0) return 'flat'

  let baseline: number
  if (preWindow.length > 0) {
    // Latest pre-window progression (list is oldest-first, so last is latest)
    baseline = preWindow[preWindow.length - 1]!.startingWeight
  } else {
    // No pre-window progressions → earliest in-window is the baseline
    baseline = inWindow[0]!.startingWeight
  }

  // Current = latest in-window progression
  const current = inWindow[inWindow.length - 1]!.startingWeight

  if (current > baseline) return 'up'
  if (current < baseline) return 'down'
  return 'flat'
}

// ---------------------------------------------------------------------------
// U3: Cadence, consistency, weekly-session, and scope-resolution helpers
// ---------------------------------------------------------------------------

const DAY_TO_INDEX: Record<DayCode, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000
const OVERDUE_INTERVAL_MULTIPLIER = 2

/**
 * Largest week-wrapped gap (in days) between consecutive scheduled weekdays.
 * A lone day returns 7 (the full weekly cycle). Empty returns 0.
 */
export function maxScheduledGap(days: readonly DayCode[]): number {
  if (days.length === 0) return 0

  const indices = [...new Set(days.map(d => DAY_TO_INDEX[d]))].sort(
    (a, b) => a - b,
  )

  if (indices.length === 1) return 7

  let max = 0
  for (let i = 0; i < indices.length; i++) {
    const curr = indices[i]!
    const next = i + 1 < indices.length ? indices[i + 1]! : indices[0]! + 7
    const gap = next - curr
    if (gap > max) max = gap
  }
  return max
}

/**
 * Expected sessions over `weeks` (default 4), age-clamped per routine so a
 * newly-created routine is not charged for weeks it did not exist.
 */
export function expectedSessions(
  routines: { days: readonly DayCode[]; createdAt: Date }[],
  now: Date,
  weeks = 4,
): number {
  return routines.reduce((sum, r) => {
    const weeksSince = (now.getTime() - r.createdAt.getTime()) / SEVEN_DAYS_MS
    return sum + r.days.length * Math.min(weeks, weeksSince)
  }, 0)
}

/**
 * Consistency percentage: `min(100, round(completed/expected × 100))`.
 * Returns null (→ "—") when expected is 0 to avoid divide-by-zero.
 */
export function consistencyPct(
  completed: number,
  expected: number,
): number | null {
  if (expected === 0) return null
  return Math.min(100, Math.round((completed / expected) * 100))
}

/**
 * Sessions completed in the trailing 7-day window and the signed delta vs the
 * prior 7-day window. A prior-week count of 0 produces a positive delta equal
 * to the current count.
 */
export function sessionsThisWeek(
  sessions: SessionRow[],
  now: Date,
): { count: number; delta: number } {
  const nowMs = now.getTime()
  const weekAgoMs = nowMs - SEVEN_DAYS_MS
  const twoWeeksAgoMs = nowMs - 2 * SEVEN_DAYS_MS

  let count = 0
  let prior = 0
  for (const s of sessions) {
    const t = s.completedAt?.getTime()
    if (t === undefined || t === null) continue
    if (t > weekAgoMs && t <= nowMs) count++
    else if (t > twoWeeksAgoMs && t <= weekAgoMs) prior++
  }
  return { count, delta: count - prior }
}

/**
 * Overdue score for a single exercise: `daysSince / maxScheduledGap(days)`.
 * Returns null when the exercise has never been performed or has no schedule.
 */
export function overdueScore(
  lastPerformedAt: Date | null,
  days: readonly DayCode[],
  now: Date,
): number | null {
  if (lastPerformedAt === null || days.length === 0) return null
  const daysSince =
    (now.getTime() - lastPerformedAt.getTime()) / (24 * 60 * 60 * 1000)
  return daysSince / maxScheduledGap(days)
}

type NeedsAttentionItem = {
  id: number
  name: string
  days: readonly DayCode[]
  lastPerformedAt: Date | null
}

/**
 * Selects the top ≤3 overdue exercises (score > 2, sorted by score desc then
 * id asc) and all never-started exercises from the given list.
 */
export function selectNeedsAttention(
  items: NeedsAttentionItem[],
  now: Date,
): { overdue: NeedsAttentionItem[]; notStarted: NeedsAttentionItem[] } {
  const scored = items.map(item => ({
    item,
    score: overdueScore(item.lastPerformedAt, item.days, now),
  }))

  const overdue = scored
    .filter(s => s.score !== null && s.score > OVERDUE_INTERVAL_MULTIPLIER)
    .sort((a, b) => b.score! - a.score! || a.item.id - b.item.id)
    .slice(0, 3)
    .map(s => s.item)

  const notStarted = items.filter(item => item.lastPerformedAt === null)

  return { overdue, notStarted }
}

// ---------------------------------------------------------------------------
// U3: Scope resolution
// ---------------------------------------------------------------------------

export type StatsScope =
  | { kind: 'all' }
  | { kind: 'active'; id: number }
  | { kind: 'archived'; id: number }

type RoutineForScope = {
  id: number
  archivedAt: Date | null
  hasHistory: boolean
}

/**
 * Resolves the raw `?routine=` query param to a typed scope.
 * Non-integer, ≤0, nonexistent, or archived-without-history params fall back
 * to 'all'. `notFound()` is never thrown — the page is always intentional.
 */
export function resolveStatsScope(
  rawParam: string | undefined,
  routines: RoutineForScope[],
): StatsScope {
  if (!rawParam) return { kind: 'all' }

  const id = parseInt(rawParam, 10)
  if (!Number.isFinite(id) || id <= 0) return { kind: 'all' }

  const routine = routines.find(r => r.id === id)
  if (!routine) return { kind: 'all' }

  if (routine.archivedAt === null) return { kind: 'active', id }
  if (routine.hasHistory) return { kind: 'archived', id }

  return { kind: 'all' }
}

// ---------------------------------------------------------------------------

/**
 * Computes a padded [min, max] Y-axis domain framing the actual weights, so
 * the trend line sits in the body of the chart instead of being pinned to the
 * top of a 0-based axis.
 *
 * Lifting weights are large numbers (135–200 lb) with small relative changes
 * (5–10 lb), so recharts' default `[0, niceMax]` domain collapses every point
 * into the top ~5% of the chart and the progression reads as a flat line.
 * Pads by 30% of the data span (or a fixed window when the line is flat), then
 * rounds outward to the nearest 5 for clean ticks.
 */
export function weightTrendDomain(weights: number[]): [number, number] {
  if (weights.length === 0) return [0, 5]

  const min = Math.min(...weights)
  const max = Math.max(...weights)
  const span = max - min
  const pad = span === 0 ? Math.max(Math.round(min * 0.1), 5) : span * 0.3

  const lo = Math.max(0, Math.floor((min - pad) / 5) * 5)
  const hi = Math.ceil((max + pad) / 5) * 5

  // Guard against a zero-height domain (e.g. all weights 0).
  return lo === hi ? [lo, lo + 5] : [lo, hi]
}

// ---------------------------------------------------------------------------
// Shared trend display constants
// ---------------------------------------------------------------------------

export const TREND_GLYPH: Record<TrendDirection, string> = {
  up: '▲',
  flat: '▬',
  down: '▼',
}

export const TREND_LABEL: Record<TrendDirection, string> = {
  up: 'trending up',
  flat: 'trending flat',
  down: 'trending down',
}

// ---------------------------------------------------------------------------
// Scope selector: chip rail model, recency helpers, render gate
// ---------------------------------------------------------------------------

export type ScopeChip = {
  key: string
  routineId: number | null
  label: string
  kind: 'all' | 'active' | 'archived'
  selected: boolean
  href: string
}

export const ARCHIVED_RECENT_CAP = 10

/**
 * Returns true when the selector should render: ≥2 active routines, or ≥1
 * archived-with-history routine (R12 / AE4).
 */
export function shouldRenderScopeSelector(
  activeCount: number,
  archivedWithHistoryCount: number,
): boolean {
  return activeCount >= 2 || archivedWithHistoryCount >= 1
}

/**
 * Builds the chip rail: All first, active in input order (alphabetical from
 * the data layer), then a single archived chip spliced at the end only when
 * scope.kind === 'archived'. Exactly one chip is selected across all scope
 * kinds (R1, R10, R11, R12, R13, R14).
 */
export function buildScopeChips(
  active: { id: number; name: string }[],
  archivedWithHistory: { id: number; name: string }[],
  scope: StatsScope,
): ScopeChip[] {
  const chips: ScopeChip[] = [
    {
      key: 'all',
      routineId: null,
      label: 'All',
      kind: 'all',
      selected: scope.kind === 'all',
      href: '/stats',
    },
  ]

  for (const r of active) {
    chips.push({
      key: String(r.id),
      routineId: r.id,
      label: r.name,
      kind: 'active',
      selected: scope.kind === 'active' && scope.id === r.id,
      href: `/stats?routine=${r.id}`,
    })
  }

  if (scope.kind === 'archived') {
    const r = archivedWithHistory.find(r => r.id === scope.id)
    if (r) {
      chips.push({
        key: String(r.id),
        routineId: r.id,
        label: r.name,
        kind: 'archived',
        selected: true,
        href: `/stats?routine=${r.id}`,
      })
    }
  }

  return chips
}

/**
 * Sorts archived routines newest-first by last trained date. Tie-break by
 * name ascending. Routines missing from the map sort last.
 */
export function orderArchivedByRecency(
  archived: RoutineRow[],
  lastTrained: Map<number, Date>,
): RoutineRow[] {
  return [...archived].sort((a, b) => {
    const aMs = lastTrained.get(a.id)?.getTime() ?? -Infinity
    const bMs = lastTrained.get(b.id)?.getTime() ?? -Infinity
    if (bMs !== aMs) return bMs - aMs
    return a.name.localeCompare(b.name)
  })
}

/**
 * Returns the visible slice of archived routines for the picker. Empty / whitespace
 * query → first `cap` by recency. Non-empty query → case-insensitive substring
 * match over the full set, uncapped (R6).
 */
export function selectVisibleArchived(
  orderedArchived: RoutineRow[],
  query: string,
  cap: number,
): RoutineRow[] {
  const q = query.trim().toLowerCase()
  if (q === '') return orderedArchived.slice(0, cap)
  return orderedArchived.filter(r => r.name.toLowerCase().includes(q))
}
