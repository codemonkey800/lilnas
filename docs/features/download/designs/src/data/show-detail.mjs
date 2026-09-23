/*
 * Copy and sample data for show-detail.pug, exposed to the template as
 * locals. See the note on loadData() in build.mjs for why this isn't just a
 * `- const` at the top of the page.
 */

const LEAD_CAST = [
  ['IK', 'Ida Kowalczyk'],
  ['DP', 'Dax Petrov'],
]

// The seven-value media-state vocabulary (plan 021), shared with the movie
// and video pages — same labels and tones, reused at series, season and
// episode level. `paused` is omitted: it's video-only today, so it has no
// row on this page.
const MEDIA_STATE = {
  absent: { label: 'not downloaded', tone: 'mute' },
  wanted: { label: 'wanted', tone: 'mute' },
  downloading: { label: 'downloading', tone: 'uv', live: true },
  importing: { label: 'importing…', tone: 'uv', live: true },
  needs_attention: { label: 'needs your decision', tone: 'warn' },
  available: { label: 'in library', tone: 'ok' },
}

// Newest first, at series level. One in-flight attempt plus terminal ones as
// StateLines — same shape as the movie page's Attempts list.
const ATTEMPTS = [
  {
    inFlight: true,
    state: 'importing',
    who: ['SR', 'Sam'],
    note: 'Season 3, episode 6 — bytes are down, Sonarr is still matching the file.',
    actions: [{ label: 'Cancel', variant: 'bad', icon: 'x' }],
  },
  {
    label: 'completed',
    tone: 'ok',
    when: '3h ago',
    who: ['SR', 'Sam'],
  },
  {
    label: 'failed',
    tone: 'bad',
    when: '1d ago',
    who: ['JA', 'Jeremy'],
    error: 'Indexer timed out after 3 retries',
  },
]

// A queue item Sonarr is running that this app never started a job for —
// grabbed from Sonarr's own UI. Same progress shape as an in-flight attempt,
// but with nowhere to hang an attempt row.
const EXTERNAL_QUEUE = {
  progress: 35,
  throughput: 'S3E7 · 610 MB / 1.7 GB  ·  4.4 MB/s',
}

// The season strip: which season is open, and which are mid-grab or stuck —
// the season-rollup dot generalises across every non-`available` state, not
// just "downloading".
const SEASONS = [
  { label: 'Season 1', short: 'S1' },
  { label: 'Season 2', short: 'S2', selected: true },
  { label: 'Season 3', short: 'S3', dot: 'live', pct: 58 },
  { label: 'Season 4', short: 'S4', dot: 'warn' },
]

export default {
  TITLE: 'Harbor Watch',
  META: '2022– · 3 seasons · Drama',
  SYNOPSIS:
    'A harbormaster and her deputies keep a fading fishing town running — one permit dispute, one rescue, ' +
    'one grudge at a time.',
  DELETE_WARNING:
    "Removes all 3 seasons from Emby and frees 9.4 GB. This can't be undone.",

  // Plain language, not error codes — the user is telling us what they saw.
  REASONS: ['Wrong audio or subtitles', "Video won't play", 'Wrong episode'],

  MEDIA_STATE,
  ATTEMPTS,
  EXTERNAL_QUEUE,
  SEASONS,

  LEAD_CAST,
  FULL_CAST: [
    ...LEAD_CAST,
    ['MT', 'Mira Tan'],
    ['OB', 'Oskar Bergman'],
    ['CL', 'Chidi Lawal'],
    ['RN', 'Rosa Nery'],
  ],
  // The two names the "+2" bubble stands in for, shown on hover.
  OVERFLOW_CAST: 'Chidi Lawal, Rosa Nery',

  JUMP: [
    ['Primary', 'primary'],
    ['States & flows', 'states'],
    ['Started from Sonarr', 'started-from-sonarr'],
    ['Loading', 'loading'],
  ],
  EPISODES: [
    {
      num: 'E1',
      title: 'The Long Tide',
      runtime: '42m',
      state: 'in library',
      tone: 'ok',
      action: 'Watch',
      actionVariant: 'ghost',
      actionIcon: 'eye',
    },
    {
      num: 'E2',
      title: 'Quota',
      runtime: '39m',
      state: 'needs your decision',
      tone: 'warn',
      action: 'Import',
      actionIcon: 'check',
    },
    {
      num: 'E3',
      title: 'Harbor Rules',
      runtime: '45m',
      state: 'downloading',
      tone: 'uv',
      live: true,
      progress: 31,
      action: 'Cancel',
      actionIcon: 'x',
    },
    {
      num: 'E4',
      title: 'Low Tide',
      runtime: '44m',
      state: 'importing…',
      tone: 'uv',
      live: true,
    },
    {
      num: 'E5',
      title: 'The Permit',
      runtime: '38m',
      state: 'wanted',
      tone: 'mute',
    },
    {
      num: 'E6',
      title: 'Salvage',
      runtime: '41m',
      state: 'not downloaded',
      tone: 'mute',
      action: 'Download',
      actionIcon: 'download',
    },
  ],
  SKELETON_EPISODES: [
    ['60%', '40%'],
    ['55%', '35%'],
    ['50%', '30%'],
  ],
  VIEWS: ['desktop', 'mobile'],
}
