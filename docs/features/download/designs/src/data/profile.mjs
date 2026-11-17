/*
 * Sample data for profile.pug, mirroring `ProfileResponse`
 * (packages/utils/src/download/types.ts): `user.email`,
 * `firstDownloadAt`/`lastDownloadAt` (all-time, nullable), sparse
 * `totalsByType`/`totalsByStatus` (a row that never occurred is absent, not
 * zero), a `jobsPerDay` trend windowed by `windowDays`, and no `totalJobs` —
 * this file sums `totalsByType` into `total` itself, same as a consumer
 * would.
 *
 * States, matching the access model in spec.md §12: your own profile (self,
 * with a deliberately sparse trend), an admin viewing someone else's (true
 * attribution, denser trend, still shows a job hidden from everyone but the
 * admin), and an empty profile — a user with zero jobs renders as an empty
 * state, never a 404, because there's no `users` table row to be missing.
 *
 * Plus, per §12's last four bullets / user stories 75–79 (plan 012's B5/F3,
 * added after the states above shipped): three more self-view frames
 * layered on the same SELF_HISTORY rows via `filterHistory()`, telling the
 * filter interaction as a sequence rather than jumping straight to the end
 * state — one chip clicked (single dimension), a second chip plus a status
 * added (multi-select within a group, AND across groups), and a
 * combination that matches zero rows, which reads as "no downloads match
 * these filters", not the zero-jobs-ever empty profile above.
 *
 * History rows reuse titles already attributed to the same person on the
 * other mockups (activity.mjs, admin.mjs, gallery.mjs). They are shaped for the
 * kit's dataList: `status` is a badge's options ({ tone, label, live }).
 */

const DAY_MS = 24 * 60 * 60 * 1000
// Fixed rather than `new Date()`, so the trend's date labels don't drift
// between builds.
const TODAY = new Date('2026-09-11T00:00:00Z')

/** `windowDays` entries ending today, oldest first — `jobsPerDay`'s shape,
    pre-filled with `count: 0` on the days the sparse wire payload would
    simply omit, so the trend can render every day's tick, gaps included. */
function trend(windowDays, countAt) {
  const days = []
  for (let i = windowDays - 1; i >= 0; i--) {
    const date = new Date(TODAY.getTime() - i * DAY_MS)
    days.push({
      day: date.toISOString().slice(0, 10),
      label: date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      }),
      count: countAt(windowDays - 1 - i),
    })
  }
  return days
}

function sum(items) {
  return items.reduce((total, item) => total + item.count, 0)
}

/** OR within a dimension, AND across dimensions — the same composition
    `JobListFilter` applies server-side (plan 012's B5/F3). Absent
    `types`/`statuses` means "no filter on that dimension", not "match
    nothing". */
function filterHistory(rows, { types, statuses } = {}) {
  return rows.filter(
    row =>
      (!types || types.includes(row.type)) &&
      (!statuses || statuses.includes(row.status.label)),
  )
}

// A handful of active days out of 30 — the point of this state is
// demonstrating that the trend reads correctly with real gaps in it.
const SELF_SPIKES = { 2: 3, 7: 2, 11: 1, 16: 4, 19: 1, 25: 2, 28: 1, 29: 2 }
// Denser, for contrast: an admin's own account (Jeremy, elsewhere) downloads
// often. Index 5, 13, 22 are still zero, so this isn't "every day has data"
// either.
const ADMIN_SPIKES = {
  0: 1,
  1: 2,
  2: 1,
  3: 3,
  4: 2,
  6: 1,
  7: 2,
  8: 3,
  9: 1,
  10: 2,
  11: 4,
  12: 1,
  14: 2,
  15: 3,
  16: 1,
  17: 2,
  18: 1,
  19: 3,
  20: 2,
  21: 1,
  23: 2,
  24: 3,
  25: 1,
  26: 2,
  27: 4,
  28: 2,
  29: 3,
}

// Totals are sparse: a type or status that never occurred has no entry.
// `tone` colours the status dot (accent in progress, ok completed, warn queued
// or paused, bad failed, idle cancelled).
const SELF_TOTALS_BY_TYPE = [
  { name: 'Video', count: 41 },
  { name: 'Movie', count: 9 },
  { name: 'Show', count: 2 },
]
const SELF_TOTALS_BY_STATUS = [
  { name: 'Completed', count: 46, tone: 'ok' },
  { name: 'Downloading', count: 1, tone: 'accent' },
  { name: 'Queued', count: 1, tone: 'warn' },
  { name: 'Paused', count: 1, tone: 'warn' },
  { name: 'Failed', count: 2, tone: 'bad' },
  { name: 'Cancelled', count: 1, tone: 'idle' },
]

const ADMIN_TOTALS_BY_TYPE = [
  { name: 'Video', count: 12 },
  { name: 'Movie', count: 15 },
  { name: 'Show', count: 4 },
]
const ADMIN_TOTALS_BY_STATUS = [
  { name: 'Completed', count: 26, tone: 'ok' },
  { name: 'Queued', count: 1, tone: 'warn' },
  { name: 'Paused', count: 1, tone: 'warn' },
  { name: 'Failed', count: 2, tone: 'bad' },
  { name: 'Cancelled', count: 1, tone: 'idle' },
]

const HISTORY_COLS = [
  { key: 'item', label: 'Item' },
  { key: 'type', label: 'Type' },
  { key: 'status', label: 'Status', type: 'badge' },
  { key: 'started', label: 'Started', align: 'right' },
]

const SELF_HISTORY = [
  {
    item: 'Sourdough starter, day one to seven',
    type: 'Video',
    status: { tone: 'accent', label: 'Downloading', live: true },
    started: '2m ago',
  },
  {
    item: 'Kitchen prep, mise en place (hidden from others)',
    type: 'Video',
    status: { tone: 'ok', label: 'Completed' },
    started: '1h ago',
  },
  {
    item: 'Late Kitchen',
    type: 'Show',
    status: { tone: 'ok', label: 'Completed' },
    started: '6h ago',
  },
  {
    item: 'Paper Weather',
    type: 'Movie',
    status: { tone: 'bad', label: 'Failed' },
    started: '5m ago',
  },
]

export default {
  HISTORY_COLS,
  PROFILES: [
    {
      label: 'Your profile · no filters',
      you: true,
      admin: false,
      initials: 'JA',
      email: 'jeremy@lilnas.io',
      firstDownloadAt: 'Jun 14, 2025',
      lastDownloadAt: '2m ago',
      totalsByType: SELF_TOTALS_BY_TYPE,
      totalsByStatus: SELF_TOTALS_BY_STATUS,
      total: sum(SELF_TOTALS_BY_TYPE),
      windowDays: 30,
      trend: trend(30, i => SELF_SPIKES[i] ?? 0),
      history: SELF_HISTORY,
    },
    {
      // The flow's first step: one click, one chip, one dimension. Real
      // filter chips are interactive (`chip`'s `interactive` opt) — this is
      // what the page looks like right after clicking "video · 41", before
      // any second chip narrows it further. Narrows SELF_HISTORY's four
      // rows to the two that are actually `video`.
      label: 'Your profile · one type chip applied',
      you: true,
      admin: false,
      initials: 'JA',
      email: 'jeremy@lilnas.io',
      firstDownloadAt: 'Jun 14, 2025',
      lastDownloadAt: '2m ago',
      totalsByType: SELF_TOTALS_BY_TYPE,
      totalsByStatus: SELF_TOTALS_BY_STATUS,
      total: sum(SELF_TOTALS_BY_TYPE),
      windowDays: 30,
      trend: trend(30, i => SELF_SPIKES[i] ?? 0),
      activeTypes: ['Video'],
      history: filterHistory(SELF_HISTORY, { types: ['Video'] }),
    },
    {
      // The flow's second step: a second type chip (`show`, multi-select —
      // OR within the group) plus a status chip (`completed`, AND across
      // groups) — spec §12's last four bullets / user stories 75–79.
      // Narrows SELF_HISTORY's four rows down to the two that satisfy both.
      // Chip counts stay SELF_TOTALS_BY_TYPE/STATUS's lifetime totals
      // unchanged; only the table below is scoped.
      label:
        'Your profile · two types and a status (OR within a group, AND across)',
      you: true,
      admin: false,
      initials: 'JA',
      email: 'jeremy@lilnas.io',
      firstDownloadAt: 'Jun 14, 2025',
      lastDownloadAt: '2m ago',
      totalsByType: SELF_TOTALS_BY_TYPE,
      totalsByStatus: SELF_TOTALS_BY_STATUS,
      total: sum(SELF_TOTALS_BY_TYPE),
      windowDays: 30,
      trend: trend(30, i => SELF_SPIKES[i] ?? 0),
      activeTypes: ['Video', 'Show'],
      activeStatuses: ['Completed'],
      history: filterHistory(SELF_HISTORY, {
        types: ['Video', 'Show'],
        statuses: ['Completed'],
      }),
    },
    {
      // A real combination that matches nothing: the only `movie` row is
      // `failed`, not `completed` — the "no downloads match these filters"
      // state (user story 79), distinct from the zero-jobs-ever empty
      // profile below.
      label: 'Your profile · filters that match nothing',
      you: true,
      admin: false,
      initials: 'JA',
      email: 'jeremy@lilnas.io',
      firstDownloadAt: 'Jun 14, 2025',
      lastDownloadAt: '2m ago',
      totalsByType: SELF_TOTALS_BY_TYPE,
      totalsByStatus: SELF_TOTALS_BY_STATUS,
      total: sum(SELF_TOTALS_BY_TYPE),
      windowDays: 30,
      trend: trend(30, i => SELF_SPIKES[i] ?? 0),
      activeTypes: ['Movie'],
      activeStatuses: ['Completed'],
      history: filterHistory(SELF_HISTORY, {
        types: ['Movie'],
        statuses: ['Completed'],
      }),
    },
    {
      label: 'Admin viewing Sam’s profile',
      you: false,
      admin: true,
      initials: 'SR',
      email: 'sam@lilnas.io',
      firstDownloadAt: 'Feb 3, 2025',
      lastDownloadAt: '12s ago',
      totalsByType: ADMIN_TOTALS_BY_TYPE,
      totalsByStatus: ADMIN_TOTALS_BY_STATUS,
      total: sum(ADMIN_TOTALS_BY_TYPE),
      windowDays: 30,
      trend: trend(30, i => ADMIN_SPIKES[i] ?? 0),
      history: [
        {
          item: 'Salt & Ceremony',
          type: 'Movie',
          status: { tone: 'warn', label: 'Queued' },
          started: '12s ago',
        },
        {
          item: 'the only kettlebell move you need (hidden from others)',
          type: 'Video',
          status: { tone: 'warn', label: 'Paused' },
          started: '3m ago',
        },
        {
          item: 'Municipal',
          type: 'Show',
          status: { tone: 'ok', label: 'Completed' },
          started: '8h ago',
        },
      ],
    },
    {
      label: 'Empty profile · no downloads yet',
      you: false,
      admin: true,
      empty: true,
      initials: 'NU',
      email: 'newuser@lilnas.io',
      firstDownloadAt: null,
      lastDownloadAt: null,
      totalsByType: [],
      totalsByStatus: [],
      total: 0,
      windowDays: 30,
      trend: [],
      history: [],
    },
  ],
}
