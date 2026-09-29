/*
 * Copy and sample data for movie-detail.pug, exposed to the template as
 * locals. See the note on loadData() in build.mjs for why this isn't just a
 * `- const` at the top of the page.
 *
 * The title is fictional and recurs across gallery.html, search.html and
 * downloads-activity.html; "Salt & Ceremony" is always assets/emby/movie-1.jpg
 * wherever it appears. See assets/README.md.
 */

const LEAD_CAST = [
  ['ML', 'Mara Lin'],
  ['TA', 'Theo Aduba'],
  ['RO', 'Ren Osei'],
]

// The seven-value media-state vocabulary (plan 021), one enum shared by
// movies, shows and videos — label and tone differ per call site, not per
// type. `paused` is omitted here: it's video-only today (yt-dlp), so it has
// no row on this page's legend.
const MEDIA_STATE = {
  absent: { label: 'not downloaded', tone: 'mute' },
  wanted: { label: 'wanted', tone: 'mute' },
  downloading: { label: 'downloading', tone: 'uv', live: true },
  importing: { label: 'importing…', tone: 'uv', live: true },
  needs_attention: { label: 'needs your decision', tone: 'warn' },
  available: { label: 'in library', tone: 'ok' },
}

// Newest first. One in-flight attempt (its own actions, no relative time —
// it hasn't ended yet) plus terminal ones as StateLines.
const ATTEMPTS = [
  {
    inFlight: true,
    state: 'downloading',
    progress: 47,
    throughput: '1.2 GB / 2.6 GB  ·  8.4 MB/s',
    actions: [
      { label: 'Pause', variant: 'outline', icon: 'pause' },
      { label: 'Cancel', variant: 'bad', icon: 'x' },
    ],
  },
  {
    label: 'failed',
    tone: 'bad',
    when: '2h ago',
    who: ['JA', 'Jeremy'],
    error: 'Connection reset by peer',
  },
  {
    label: 'cancelled',
    tone: 'mute',
    when: '1d ago',
    who: ['SR', 'Sam'],
  },
]

// Cancel pressed and acknowledged: the job reads `cancelling` until Radarr
// lets go. The queue row is already gone, so there's no bar and no
// throughput — just the job-status chip and the Cancel that stays, inert.
// Pause is not offered on a job that's winding down.
const CANCELLING_ATTEMPT = {
  inFlight: true,
  cancelling: true,
}

// Straight after a cancel: the movie is back to `absent`, and the cancelled
// attempt is the newest one overall — the only row that may carry Retry
// (AttemptList's `sorted[0]` rule). On the primary frame above, the same
// cancelled row sits under an in-flight attempt, so it never offers Retry.
const ATTEMPTS_AFTER_CANCEL = [
  {
    label: 'cancelled',
    tone: 'mute',
    when: '2m ago',
    who: ['JA', 'Jeremy'],
    retry: true,
  },
  {
    label: 'failed',
    tone: 'bad',
    when: '2h ago',
    who: ['JA', 'Jeremy'],
    error: 'Connection reset by peer',
  },
]

// A download started in Radarr's own UI, adopted as an ordinary attempt —
// attributed to Radarr rather than a person. Cancel, but no Pause.
const ADOPTED_ATTEMPT = {
  inFlight: true,
  state: 'downloading',
  progress: 72,
  throughput: '1.9 GB / 2.6 GB  ·  6.1 MB/s',
  actions: [{ label: 'Cancel', variant: 'bad', icon: 'x' }],
}

// Plan 024 · the three app-managed quality tiers, best first. They're caps,
// not exact matches: "Up to 4K" falls back to 1080p when no 4K exists. The
// picker preselects the title's own tier when its Radarr profile is one of
// these, and the default (`hd`) otherwise.
const QUALITY_TIERS = [
  ['up_to_4k', 'Up to 4K'],
  ['hd', 'HD (up to 1080p)'],
  ['up_to_720p', 'Up to 720p'],
]

// Plan 024 · a search that finished without grabbing anything ends
// `not_found` — terminal, but not an error: warn, not bad, and no red error
// text. The movie stays monitored (so the page reads `wanted`), which is why
// the newest row offers Retry. The older row carries the flagged-release
// path's message as a neutral status note rather than as a red error.
const ATTEMPTS_NOT_FOUND = [
  {
    label: 'no release found',
    tone: 'warn',
    when: '4m ago',
    who: ['JA', 'Jeremy'],
    retry: true,
  },
  {
    label: 'no release found',
    tone: 'warn',
    when: '2d ago',
    who: ['SR', 'Sam'],
    statusNote: 'No usable release — every result is flagged or rejected',
  },
]

// Plan 024 · `searching` with a status note — the small secondary line under
// the status chip that says why a search is still a search. No bar (nothing
// is queued yet) and no Pause (nothing to pause); Cancel only.
const SEARCHING = { label: 'searching', tone: 'uv', live: true }
const SEARCH_CANCEL = [{ label: 'Cancel', variant: 'bad', icon: 'x' }]
const SEARCHING_WITH_NOTE = [
  {
    inFlight: true,
    status: SEARCHING,
    statusNote:
      'Last download failed: Aborted, cannot be completed. Radarr is trying another release.',
    actions: SEARCH_CANCEL,
  },
  {
    inFlight: true,
    status: SEARCHING,
    statusNote: 'Waiting for Radarr to finish adding the movie',
    actions: SEARCH_CANCEL,
  },
  {
    inFlight: true,
    status: SEARCHING,
    statusNote: 'Delayed by Radarr until 21:40',
    actions: SEARCH_CANCEL,
  },
]

// Plan 024 · 1·D1 · what the download folder held, as Radarr's manual import
// lists it. A movie takes exactly one file, so these are radios: the largest
// file without a "Sample" rejection starts chosen, and the sample is drawn
// but left unchosen — still pickable, since rejections are informational.
const IMPORT_FILES = [
  {
    name: 'Salt.Ceremony.2024.1080p.BluRay.x265.mkv',
    size: '2.1 GB',
    quality: 'Bluray-1080p',
    language: 'English',
    checked: true,
  },
  {
    name: 'Featurettes/Making.Of.1080p.mkv',
    size: '412 MB',
    quality: 'Bluray-1080p',
    language: 'English',
  },
  {
    name: 'Sample/salt.ceremony-sample.mkv',
    size: '48 MB',
    quality: 'Bluray-1080p',
    language: 'English',
  },
]

// Upstream's rejections, each distinct one once — the dialog's note, not a
// per-row badge. Shaped after the real Radarr sentences, renamed onto this
// page's fictional title.
const IMPORT_REJECTIONS = [
  'Movie [Salt & Ceremony (2024)][tmdb:558212] was not found in the grabbed release: ' +
    'Salt.Ceremony.2024.1080p.BluRay.x265',
  'Sample',
]

// Plan 025 · what reading SABnzbd directly adds to the in-flight card. Radarr's
// queue alone gives a movie a bare `~hh:mm:ss left`; SABnzbd's own queue adds
// the bytes and the live speed, so a movie's line reads the way a video's
// already does. A paused attempt has no speed and no estimate to give — the
// line keeps the bytes and drops the rest.
const PAUSE_CANCEL = [
  { label: 'Pause', variant: 'outline', icon: 'pause' },
  { label: 'Cancel', variant: 'bad', icon: 'x' },
]
const RESUME_CANCEL = [
  { label: 'Resume', variant: 'uv' },
  { label: 'Cancel', variant: 'bad', icon: 'x' },
]
const CANCEL_ONLY = [{ label: 'Cancel', variant: 'bad', icon: 'x' }]
const PAUSED = { label: 'paused', tone: 'warn' }

const SAB_THROUGHPUT = [
  {
    caption: 'Downloading',
    inFlight: true,
    state: 'downloading',
    progress: 47,
    throughput: '1.2 GB / 2.6 GB  ·  8.4 MB/s  ·  ~3 min left',
    actions: PAUSE_CANCEL,
  },
  {
    caption: 'Paused from here — no speed, no estimate',
    inFlight: true,
    status: PAUSED,
    progress: 47,
    throughput: '1.2 GB / 2.6 GB',
    actions: RESUME_CANCEL,
  },
]

// Plan 025 · every byte down, SABnzbd still post-processing. With SABnzbd read
// directly the chip names its stage and the line quotes its own progress
// text; without it (SABnzbd not configured) the card keeps plan 024's
// `finishing up` chip, with a line that no longer claims the import is next.
const UNPACKING = { label: 'unpacking', tone: 'uv', live: true }
const FINISHING = { label: 'finishing up', tone: 'uv', live: true }
const SAB_POST_PROCESSING = [
  {
    caption: 'SABnzbd read directly',
    inFlight: true,
    status: UNPACKING,
    progress: 100,
    throughput:
      'SABnzbd is unpacking it · Repairing: 45%. Radarr imports it after.',
    actions: CANCEL_ONLY,
  },
  {
    caption: 'SABnzbd not configured — the fallback',
    inFlight: true,
    status: FINISHING,
    progress: 100,
    throughput:
      'All downloaded. SABnzbd is checking and unpacking it; Radarr imports it after.',
    actions: CANCEL_ONLY,
  },
]

// Plan 025 · a disk-full failure, read as one. SABnzbd's own fail message is
// kept in brackets after the plain sentence, so the cause stays checkable.
const SAB_DISK_FULL_FAILED = [
  {
    label: 'failed',
    tone: 'bad',
    when: '6m ago',
    who: ['JA', 'Jeremy'],
    error:
      'The NAS ran out of disk space while SABnzbd was unpacking it. ' +
      '(Unpacking failed, write error or disk is full?)',
    retry: true,
  },
]

// …and the same failure while Radarr is still retrying: its status note says
// the next release will hit the same wall.
const SAB_DISK_FULL_SEARCHING = {
  inFlight: true,
  status: SEARCHING,
  statusNote:
    'Last download failed: the NAS ran out of disk space. Radarr is trying another release, ' +
    'which will fail the same way until space is freed.',
  actions: SEARCH_CANCEL,
}

// Plan 025 · SABnzbd's whole queue is paused — disk full, a quota, or paused
// in SABnzbd's own UI. Not a pause this app made, so there's no Resume here.
// Under 5 GB free, the line says why it probably stopped.
const SAB_PAUSED = [
  {
    caption: "SABnzbd's queue is paused",
    inFlight: true,
    status: PAUSED,
    statusNote: 'Paused in SABnzbd',
    progress: 47,
    throughput: '1.2 GB / 2.6 GB',
    actions: CANCEL_ONLY,
  },
  {
    caption: 'Paused, with under 5 GB free',
    inFlight: true,
    status: PAUSED,
    statusNote: 'Paused in SABnzbd — the download disk is almost full',
    progress: 47,
    throughput: '1.2 GB / 2.6 GB',
    actions: CANCEL_ONLY,
  },
]

// Radarr upgrading a file that's already on disk. Not adopted: it stays a
// queue snapshot with a bar and a note, and nothing here can cancel it.
const EXTERNAL_QUEUE = {
  progress: 72,
  throughput: '1.9 GB / 2.6 GB  ·  6.1 MB/s',
}

export default {
  TITLE: 'Salt & Ceremony',
  META: '2024 · 2h 04m · Drama, Thriller',
  SYNOPSIS:
    "A quiet coastal town's annual ceremony turns into a reckoning when the tide brings back what it took " +
    'ten years ago.',
  DELETE_WARNING:
    "Removes the file from Emby and frees 2.1 GB. This can't be undone.",

  // Plain language, not error codes — the user is telling us what they saw.
  REASONS: ['Wrong audio or subtitles', "Video won't play", 'Not this movie'],

  MEDIA_STATE,
  ATTEMPTS,
  CANCELLING_ATTEMPT,
  ATTEMPTS_AFTER_CANCEL,
  ADOPTED_ATTEMPT,
  EXTERNAL_QUEUE,
  QUALITY_TIERS,
  DEFAULT_QUALITY_TIER: 'hd',
  ATTEMPTS_NOT_FOUND,
  SEARCHING_WITH_NOTE,
  IMPORT_FILES,
  IMPORT_REJECTIONS,
  SAB_THROUGHPUT,
  SAB_POST_PROCESSING,
  SAB_DISK_FULL_FAILED,
  SAB_DISK_FULL_SEARCHING,
  SAB_PAUSED,

  LEAD_CAST,
  FULL_CAST: [
    ...LEAD_CAST,
    ['KB', 'Kofi Boadi'],
    ['PN', 'Priya Nair'],
    ['WO', 'Wes Okafor'],
  ],
  // The six names the "+6" bubble stands in for, shown on hover.
  OVERFLOW_CAST:
    'Priya Nair, Wes Okafor, Lena Marsh, Iyad Haddad, Colm Reilly, Ana Duarte',

  JUMP: [
    ['Primary', 'primary'],
    ['States & flows', 'states'],
    ['Not downloaded', 'not-downloaded'],
    ['Started from Radarr', 'started-from-radarr'],
    ['Radarr upgrade', 'radarr-upgrade'],
    ['Plan 024', 'plan-024'],
    ['Plan 025', 'plan-025'],
    ['Import dialog', 'import-modal'],
    ['Loading', 'loading'],
  ],
  SKELETON_RELEASES: [
    ['60%', '40%'],
    ['55%', '35%'],
  ],
  VIEWS: ['desktop', 'mobile'],
}
