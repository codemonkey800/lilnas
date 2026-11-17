/*
 * Sample data for show-detail.pug. The same media-state and job-status
 * vocabularies as movie-detail, applied at three levels: the series, a season
 * and an episode. "Harbor Watch" is assets/emby/show-1.jpg wherever it
 * appears (see assets/README.md).
 */

const SHOW = {
  title: 'Harbor Watch',
  art: 'assets/emby/show-1.jpg',
  v: 3,
  meta: '2022– · 4 seasons · 15 · 8.1/10 · Drama',
  synopsis:
    'A harbormaster and her deputies keep a fading fishing town running — one permit dispute, one rescue, one grudge at a time.',
}

const CANCEL = { label: 'Cancel', variant: 'bad', icon: 'x' }

const QUALITY_TIERS = [
  ['up_to_4k', 'Up to 4K'],
  ['hd', 'HD (up to 1080p)'],
  ['up_to_720p', 'Up to 720p'],
]

// Sonarr keeps one profile per series, so the pick covers every season and
// episode — the Download beside a season or an episode uses it too.
const TIER_HINT = 'Applies to the whole show.'

// A season tab's count is its roll-up: a percentage while it downloads.
const SEASONS = [
  { label: 'Season 1' },
  { label: 'Season 2', selected: true },
  { label: 'Season 3', count: '58%' },
  { label: 'Season 4' },
]

const EPISODES = [
  {
    n: 1,
    title: 'The Long Tide',
    air: 'Sep 3, 2025',
    runtime: '42m',
    state: 'available',
    action: 'Manage',
  },
  {
    n: 2,
    title: 'Quota',
    air: 'Sep 10, 2025',
    runtime: '39m',
    state: 'needs_attention',
    action: 'Manage',
  },
  {
    n: 3,
    title: 'Harbor Rules',
    air: 'Sep 17, 2025',
    runtime: '45m',
    state: 'downloading',
    pct: 31,
    action: 'Manage',
  },
  {
    n: 4,
    title: 'Low Tide',
    air: 'Sep 24, 2025',
    runtime: '44m',
    state: 'importing',
    action: 'Manage',
  },
  {
    n: 5,
    title: 'The Permit',
    air: 'Oct 1, 2025',
    runtime: '38m',
    state: 'wanted',
    action: 'Manage',
  },
  {
    n: 6,
    title: 'Salvage',
    air: 'Oct 8, 2025',
    runtime: '41m',
    state: 'absent',
    action: 'Manage',
  },
  {
    n: 7,
    title: 'Open Water',
    air: 'Oct 15, 2025',
    runtime: '52m',
    state: 'absent',
    finale: 'Finale',
    action: 'Manage',
  },
]

export default {
  SHOW,
  QUALITY_TIERS,
  TIER_HINT,
  SEASONS,
  EPISODES,
  OPEN_EPISODE: 0,

  FACTS: [
    ['First aired', 'Sep 3, 2022'],
    ['Status', 'Continuing'],
    ['Network', 'Coastal One'],
    ['Seasons', '4'],
    ['Episodes', '29 (18 downloaded)'],
    ['Quality', 'HD (up to 1080p)'],
    ['Size', '9.4 GB'],
    ['Path', '/shows/Harbor Watch', true],
  ],

  CAST: [
    ['IK', 'Ida Kowalczyk'],
    ['DP', 'Dax Petrov'],
    ['MT', 'Mira Tan'],
    ['OB', 'Oskar Bergman'],
    ['CL', 'Chidi Lawal'],
    ['RN', 'Rosa Nery'],
  ],
  CAST_MORE: '+2 more',

  ADDED: { who: ['SR', 'Sam'], when: '3h ago' },

  ATTEMPTS_DEFAULT: [
    {
      job: 'completed',
      scope: 'Season 3',
      who: ['SR', 'Sam'],
      when: '3h ago',
    },
    {
      job: 'cancelled',
      scope: 'Season 3, episode 4',
      who: ['JA', 'Jeremy'],
      when: '5h ago',
      note: 'Part of a season download that is still running — this episode may still import.',
    },
    {
      job: 'failed',
      scope: 'Season 2',
      who: ['JA', 'Jeremy'],
      when: '1d ago',
      error: 'Indexer timed out after 3 retries.',
    },
  ],

  STATES: {
    wanted: {
      attempts: [
        {
          job: 'not_found',
          scope: 'Season 4',
          who: ['SR', 'Sam'],
          when: '6m ago',
          note: 'No usable release for this season yet.',
          retry: true,
        },
      ],
    },
    downloading: {
      attempts: [
        {
          inFlight: true,
          state: 'downloading',
          scope: 'Season 3, episode 7',
          pct: 35,
          line: '610 MB / 1.7 GB · 4.4 MB/s · ~4 min left',
          actions: [CANCEL],
        },
      ],
    },
    importing: {
      attempts: [
        {
          inFlight: true,
          state: 'importing',
          scope: 'Season 3, episode 6',
          settling: true,
          line: 'All 1.7 GB are down. Sonarr is matching the file to the episode.',
          actions: [CANCEL],
        },
      ],
    },
    paused: {
      attempts: [
        {
          inFlight: true,
          state: 'paused',
          scope: 'Season 3, episode 7',
          pct: 35,
          tone: 'warn',
          line: '610 MB / 1.7 GB',
          note: 'Paused in SABnzbd.',
          actions: [CANCEL],
        },
      ],
    },
    needs_attention: {
      attempts: [
        {
          inFlight: true,
          state: 'needs_attention',
          scope: 'Season 3, episode 6',
          note: 'The bytes are already down — Sonarr just couldn’t match the file to the episode. Pick what to import, or discard.',
          actions: [
            { label: 'Import', variant: 'accent', icon: 'check' },
            { label: 'Discard', variant: 'bad', icon: 'trash' },
          ],
        },
      ],
    },
  },

  // Cancelling one episode whose file is inside a season pack: the pack keeps
  // running, so the episode's own attempt ends cancelled with a note.
  PACK_CANCEL: [
    {
      inFlight: true,
      state: 'downloading',
      scope: 'Season 3',
      pct: 64,
      line: '2.9 GB / 4.5 GB · 11.2 MB/s',
      actions: [CANCEL],
    },
    {
      job: 'cancelled',
      scope: 'Season 3, episode 4',
      who: ['JA', 'Jeremy'],
      when: '1m ago',
      note: 'Part of a season download that is still running — this episode may still import.',
    },
  ],

  // Radarr’s sibling: Sonarr upgrading an episode already on disk.
  EXTERNAL: {
    inFlight: true,
    state: 'downloading',
    scope: 'Season 3, episode 7',
    pct: 35,
    line: '610 MB / 1.7 GB · 4.4 MB/s',
    note: 'Sonarr is upgrading the file already on disk — it can’t be cancelled here.',
  },

  // The delete confirms: an episode whose file also holds the next one, the
  // last downloaded episode of a season, the last of the series, and the series.
  DELETE: {
    shared: {
      title: 'Delete S01E01 of “Harbor Watch”?',
      body: 'Removes this episode’s file from the library and frees 1.4 GB. This file also holds S01E02 — it will be removed too. The rest of the season is left alone.',
    },
    lastOfSeason: {
      title: 'Delete S02E07 of “Harbor Watch”?',
      body: 'Removes the file for this one episode from the library and frees 1.2 GB. It’s the last downloaded episode of the season, so the season is unmonitored too.',
    },
    lastOfSeries: {
      title: 'Delete S01E01 of “Harbor Watch”?',
      body: 'Removes the file for this one episode from the library and frees 1.4 GB. It’s the last downloaded episode of the series, so the series is removed from Sonarr.',
    },
    season: {
      title: 'Delete season 2 of “Harbor Watch”?',
      body: 'Removes the file for every episode in season 2 from the library and frees 6.8 GB. Other seasons are left alone.',
    },
    series: {
      title: 'Delete “Harbor Watch”?',
      body: 'Removes every episode of every season from the library and frees 9.4 GB, and removes the series from Sonarr. It can be requested again later.',
    },
  },

  REASONS: ['Wrong audio or subtitles', 'Video won’t play', 'Wrong episode'],
}
