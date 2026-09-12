/*
 * Sample data for profile.pug, mirroring `ProfileResponse`
 * (packages/utils/src/download/types.ts): `user.email`,
 * `firstDownloadAt`/`lastDownloadAt` (all-time, nullable), sparse
 * `totalsByType`/`totalsByStatus` (a row that never occurred is absent, not
 * zero), a `jobsPerDay` trend windowed by `windowDays`, and no `totalJobs` —
 * this file sums `totalsByType` into `total` itself, same as a consumer
 * would.
 *
 * Three states, matching the access model in spec.md §12: your own profile
 * (self, with a deliberately sparse trend), an admin viewing someone else's
 * (true attribution, denser trend, still shows a job hidden from everyone
 * but the admin), and an empty profile — a user with zero jobs renders as an
 * empty state, never a 404, because there's no `users` table row to be
 * missing.
 *
 * History rows reuse titles/art already attributed to the same person on
 * other mockups (downloads-activity.mjs, admin-dashboard.mjs, gallery.mjs)
 * where the pairing already exists, per assets/README.md's fixed
 * title -> asset mapping; new rows use unused art from the same asset set.
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

const SELF_TOTALS_BY_TYPE = [
  { name: 'video', count: 41 },
  { name: 'movie', count: 9 },
  { name: 'show', count: 2 },
]
const SELF_TOTALS_BY_STATUS = [
  { name: 'completed', count: 46, tone: 'ok' },
  { name: 'downloading', count: 1, tone: 'ok' },
  { name: 'queued', count: 1, tone: 'mute' },
  { name: 'paused', count: 1, tone: 'mute' },
  { name: 'failed', count: 2, tone: 'bad' },
  { name: 'cancelled', count: 1, tone: 'mute' },
]

const ADMIN_TOTALS_BY_TYPE = [
  { name: 'video', count: 12 },
  { name: 'movie', count: 15 },
  { name: 'show', count: 4 },
]
const ADMIN_TOTALS_BY_STATUS = [
  { name: 'completed', count: 26, tone: 'ok' },
  { name: 'queued', count: 1, tone: 'mute' },
  { name: 'paused', count: 1, tone: 'mute' },
  { name: 'failed', count: 2, tone: 'bad' },
  { name: 'cancelled', count: 1, tone: 'mute' },
]

export default {
  PROFILES: [
    {
      label: 'Self view — you, viewing your own profile',
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
      history: [
        {
          title: 'Sourdough starter, day one to seven',
          kind: 'video',
          icon: 'play',
          art: 'assets/video/video-3.jpg',
          v: 2,
          state: 'downloading',
          tone: 'ok',
          live: true,
          progress: 64,
          started: '2m ago',
        },
        {
          title: 'Kitchen prep, mise en place',
          kind: 'video',
          icon: 'play',
          art: 'assets/video/video-4.jpg',
          v: 1,
          state: 'completed',
          tone: 'ok',
          hiddenFromOthers: true,
          started: '1h ago',
        },
        {
          title: 'Late Kitchen',
          kind: 'show',
          icon: 'tv',
          art: 'assets/emby/show-2.jpg',
          v: 5,
          state: 'completed',
          tone: 'ok',
          started: '6h ago',
        },
        {
          title: 'Paper Weather',
          kind: 'movie',
          icon: 'film',
          art: 'assets/emby/movie-3.jpg',
          v: 1,
          state: 'failed',
          tone: 'bad',
          started: '5m ago',
        },
      ],
    },
    {
      label: "Admin view — Jeremy (admin) viewing Sam's profile",
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
          title: 'Salt & Ceremony',
          kind: 'movie',
          icon: 'film',
          art: 'assets/emby/movie-1.jpg',
          v: 1,
          state: 'queued',
          tone: 'mute',
          started: '12s ago',
        },
        {
          title: 'the only kettlebell move you need',
          kind: 'video',
          icon: 'play',
          art: 'assets/video/video-1.jpg',
          v: 4,
          state: 'paused',
          tone: 'mute',
          progress: 18,
          quietProgress: true,
          hiddenFromOthers: true,
          started: '3m ago',
        },
        {
          title: 'Municipal',
          kind: 'show',
          icon: 'tv',
          art: 'assets/emby/show-3.jpg',
          v: 2,
          state: 'completed',
          tone: 'ok',
          started: '8h ago',
        },
      ],
    },
    {
      label: 'Empty profile — an email with no downloads yet',
      you: false,
      admin: true,
      empty: true,
      initials: '–',
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
