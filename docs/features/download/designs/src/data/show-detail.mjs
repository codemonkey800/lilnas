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
    label: 'cancelled',
    tone: 'mute',
    when: '5h ago',
    who: ['JA', 'Jeremy'],
  },
  {
    label: 'failed',
    tone: 'bad',
    when: '1d ago',
    who: ['JA', 'Jeremy'],
    error: 'Indexer timed out after 3 retries',
  },
]

// Cancel pressed and acknowledged: the job reads `cancelling` until Sonarr
// lets go. The queue row is already gone, so there's no bar and no
// throughput — the chip, which part of the show it was for, and the Cancel
// that stays, inert.
const CANCELLING_ATTEMPT = {
  inFlight: true,
  cancelling: true,
  note: 'Season 3, episode 6',
}

// Straight after a cancel, with the series back to `wanted`: the cancelled
// attempt is the newest one overall — the only row that may carry Retry
// (AttemptList's `sorted[0]` rule). On the primary frame above, the same
// kind of row sits under an in-flight attempt, so it never offers Retry.
const ATTEMPTS_AFTER_CANCEL = [
  {
    label: 'cancelled',
    tone: 'mute',
    when: '2m ago',
    who: ['SR', 'Sam'],
    retry: true,
  },
  {
    label: 'failed',
    tone: 'bad',
    when: '1d ago',
    who: ['JA', 'Jeremy'],
    error: 'Indexer timed out after 3 retries',
  },
]

// A download started in Sonarr's own UI, adopted as an ordinary attempt —
// attributed to Sonarr rather than a person. Cancel, but no Pause.
const ADOPTED_ATTEMPT = {
  inFlight: true,
  state: 'downloading',
  progress: 35,
  note: 'Season 3, episode 7',
  throughput: '610 MB / 1.7 GB  ·  4.4 MB/s',
  actions: [{ label: 'Cancel', variant: 'bad', icon: 'x' }],
}

// Sonarr upgrading an episode that's already on disk. Not adopted: it stays a
// queue snapshot with a bar and a note, and nothing here can cancel it.
const EXTERNAL_QUEUE = {
  progress: 35,
  throughput: 'S3E7 · 610 MB / 1.7 GB  ·  4.4 MB/s',
}

// Plan 024 · the three app-managed quality tiers, best first — the same caps
// the movie page offers. Sonarr keeps one profile per series, so on a show
// the pick applies to the whole series, whichever Download it sits beside.
const QUALITY_TIERS = [
  ['up_to_4k', 'Up to 4K'],
  ['hd', 'HD (up to 1080p)'],
  ['up_to_720p', 'Up to 720p'],
]

// Plan 024 · a search that finished without grabbing anything ends
// `not_found` — terminal, but not an error: warn, not bad. The series stays
// monitored (so it reads `wanted`), which is why the newest row offers Retry.
const ATTEMPTS_NOT_FOUND = [
  {
    label: 'no release found',
    tone: 'warn',
    when: '6m ago',
    who: ['SR', 'Sam'],
    scope: 'Season 4',
    retry: true,
  },
  {
    label: 'completed',
    tone: 'ok',
    when: '3h ago',
    who: ['SR', 'Sam'],
    scope: 'Season 3',
  },
]

// Plan 024 · `searching` with a status note — the small secondary line under
// the status chip that says why a search is still a search. No bar (nothing
// is queued yet) and no Pause; Cancel only.
const SEARCHING = { label: 'searching', tone: 'uv', live: true }
const SEARCH_CANCEL = [{ label: 'Cancel', variant: 'bad', icon: 'x' }]
const SEARCHING_WITH_NOTE = [
  {
    inFlight: true,
    status: SEARCHING,
    statusNote:
      'Last download failed: Aborted, cannot be completed. Sonarr is trying another release.',
    note: 'Season 4',
    actions: SEARCH_CANCEL,
  },
  {
    inFlight: true,
    status: SEARCHING,
    statusNote: 'Waiting for Sonarr to finish adding the show',
    actions: SEARCH_CANCEL,
  },
  {
    inFlight: true,
    status: SEARCHING,
    statusNote: 'Delayed by Sonarr until 21:40',
    note: 'Season 4, episode 2',
    actions: SEARCH_CANCEL,
  },
]

// Plan 024 · cancelling one episode whose file is coming down inside a season
// pack. Removing the queue row would kill the whole pack, so the pack keeps
// running: the episode's own attempt ends `cancelled` with a note saying it
// may still land. No Retry — the series is still downloading.
const ATTEMPTS_PACK_CANCEL = [
  {
    inFlight: true,
    state: 'downloading',
    progress: 64,
    note: 'Season 3',
    throughput: '2.9 GB / 4.5 GB  ·  11.2 MB/s',
    actions: [{ label: 'Cancel', variant: 'bad', icon: 'x' }],
  },
  {
    label: 'cancelled',
    tone: 'mute',
    when: '1m ago',
    who: ['JA', 'Jeremy'],
    scope: 'Season 3, episode 4',
    statusNote:
      'Part of a season download that is still running — this episode may still import',
  },
]

// Plan 025 · the same SABnzbd reads as the movie page, on a show's card: the
// scope note stays between the bar and the line, and Sonarr is the importer.
// A show's card has no Pause today, so the paused-from-here case is the
// movie page's to draw.
const CANCEL_ONLY = [{ label: 'Cancel', variant: 'bad', icon: 'x' }]
const PAUSED = { label: 'paused', tone: 'warn' }

const SAB_THROUGHPUT = [
  {
    caption: 'Downloading',
    inFlight: true,
    state: 'downloading',
    progress: 35,
    note: 'Season 3, episode 7',
    throughput: '610 MB / 1.7 GB  ·  4.4 MB/s  ·  ~4 min left',
    actions: CANCEL_ONLY,
  },
]

const UNPACKING = { label: 'unpacking', tone: 'uv', live: true }
const FINISHING = { label: 'finishing up', tone: 'uv', live: true }
const SAB_POST_PROCESSING = [
  {
    caption: 'SABnzbd read directly',
    inFlight: true,
    status: UNPACKING,
    progress: 100,
    note: 'Season 3',
    throughput:
      'SABnzbd is unpacking it · Repairing: 45%. Sonarr imports it after.',
    actions: CANCEL_ONLY,
  },
  {
    caption: 'SABnzbd not configured — the fallback',
    inFlight: true,
    status: FINISHING,
    progress: 100,
    note: 'Season 3',
    throughput:
      'All downloaded. SABnzbd is checking and unpacking it; Sonarr imports it after.',
    actions: CANCEL_ONLY,
  },
]

const SAB_DISK_FULL_FAILED = [
  {
    label: 'failed',
    tone: 'bad',
    when: '6m ago',
    who: ['SR', 'Sam'],
    scope: 'Season 3',
    error:
      'The NAS ran out of disk space while SABnzbd was unpacking it. ' +
      '(Unpacking failed, write error or disk is full?)',
    retry: true,
  },
]

const SAB_DISK_FULL_SEARCHING = {
  inFlight: true,
  status: SEARCHING,
  statusNote:
    'Last download failed: the NAS ran out of disk space. Sonarr is trying another release, ' +
    'which will fail the same way until space is freed.',
  note: 'Season 3',
  actions: SEARCH_CANCEL,
}

const SAB_PAUSED = [
  {
    caption: "SABnzbd's queue is paused",
    inFlight: true,
    status: PAUSED,
    statusNote: 'Paused in SABnzbd',
    progress: 35,
    note: 'Season 3, episode 7',
    throughput: '610 MB / 1.7 GB',
    actions: CANCEL_ONLY,
  },
  {
    caption: 'Paused, with under 5 GB free',
    inFlight: true,
    status: PAUSED,
    statusNote: 'Paused in SABnzbd — the download disk is almost full',
    progress: 35,
    note: 'Season 3, episode 7',
    throughput: '610 MB / 1.7 GB',
    actions: CANCEL_ONLY,
  },
]

// The season strip: which season is open, and which are mid-grab or stuck —
// the season-rollup dot generalises across every non-`available` state, not
// just "downloading".
const SEASONS = [
  { label: 'Season 1', short: 'S1' },
  { label: 'Season 2', short: 'S2', selected: true },
  { label: 'Season 3', short: 'S3', dot: 'live', pct: 58 },
  { label: 'Season 4', short: 'S4', dot: 'warn' },
]

const TITLE = 'Harbor Watch'

// Plan 024 · the episode delete confirm when the file holds more than one
// episode (an `S01E01E02.mkv`): the dialog names the sibling, because
// deleting "this one episode" takes both. Same sentences as the app's
// `deleteConfirmCopy` for an episode scope with `sharesFileWith`.
const EPISODE_DELETE = {
  title: `Delete S01E01 of "${TITLE}"?`,
  body:
    "Removes this episode's file from the library and frees 1.4 GB. " +
    'This file also holds S01E02 — it will be removed too. ' +
    "The rest of the season is left alone. This can't be undone.",
}

export default {
  TITLE,
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
  CANCELLING_ATTEMPT,
  ATTEMPTS_AFTER_CANCEL,
  ADOPTED_ATTEMPT,
  EXTERNAL_QUEUE,
  SEASONS,
  QUALITY_TIERS,
  DEFAULT_QUALITY_TIER: 'hd',
  ATTEMPTS_NOT_FOUND,
  SEARCHING_WITH_NOTE,
  ATTEMPTS_PACK_CANCEL,
  EPISODE_DELETE,
  SAB_THROUGHPUT,
  SAB_POST_PROCESSING,
  SAB_DISK_FULL_FAILED,
  SAB_DISK_FULL_SEARCHING,
  SAB_PAUSED,

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
    ['Sonarr upgrade', 'sonarr-upgrade'],
    ['Plan 024', 'plan-024'],
    ['Plan 025', 'plan-025'],
    ['Delete episode', 'delete-episode'],
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
      actionVariant: 'bad',
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
