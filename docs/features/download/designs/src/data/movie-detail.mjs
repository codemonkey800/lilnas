/*
 * Sample data for movie-detail.pug. The title is fictional and recurs across
 * home, gallery, search and activity; "Salt & Ceremony" is always
 * assets/emby/movie-1.jpg wherever it appears (see assets/README.md).
 *
 * `job` is a job status key and `state` a media state key; the badge for each
 * is drawn by jobBadge / mediaBadge in mixins/download.pug, which own the
 * labels and tones. An attempt with `inFlight` is the card with a bar; the
 * rest are finished rows.
 */

const MOVIE = {
  title: 'Salt & Ceremony',
  art: 'assets/emby/movie-1.jpg',
  v: 1,
  meta: '2024 · 2h 04m · 15 · 7.4/10 · Drama, Thriller',
  synopsis:
    'A quiet coastal town’s annual ceremony turns into a reckoning when the tide brings back what it took ten years ago.',
}

const CANCEL = { label: 'Cancel', variant: 'bad', icon: 'x' }

const QUALITY_TIERS = [
  ['up_to_4k', 'Up to 4K'],
  ['hd', 'HD (up to 1080p)'],
  ['up_to_720p', 'Up to 720p'],
]

// The three tiers are caps, not exact matches: "Up to 4K" falls back to
// 1080p when no 4K release exists.
const TIER_HINT = 'A cap, not a match — it falls back when nothing fits.'

const RELEASES = [
  {
    quality: 'Bluray-1080p',
    size: '2.1 GB',
    source: 'NZBgeek · Salt.Ceremony.2024.1080p.BluRay.x265-GRP',
    current: true,
  },
  {
    quality: 'WEBDL-2160p',
    size: '9.8 GB',
    source: 'NZBgeek · Salt.Ceremony.2024.2160p.WEB-DL.DDP5.1.HDR-GRP',
    action: { label: 'Replace with this' },
  },
  {
    quality: 'Bluray-1080p',
    size: '2.4 GB',
    source: 'DrunkenSlug · Salt.Ceremony.2024.1080p.BluRay.x264-OLD',
    flagged: true,
    reason: 'Reported as a bad file — this app won’t grab it.',
  },
  {
    quality: 'HDTV-720p',
    size: '1.1 GB',
    source: 'DrunkenSlug · Salt.Ceremony.2024.720p.HDTV.x264-LOW',
    rejected: true,
    reason: 'Rejected — it doesn’t meet this title’s quality profile.',
    action: { label: 'Replace with this', disabled: true },
  },
]

// What the picker offers when nothing is on disk yet: Download, not Replace.
const RELEASES_ABSENT = RELEASES.slice(1, 2)
  .concat(RELEASES.slice(3))
  .map(r =>
    Object.assign({}, r, {
      action: r.action && {
        label: 'Download this',
        disabled: r.action.disabled,
      },
    }),
  )

const ALL_REJECTED = RELEASES.slice(2).map(r =>
  Object.assign({}, r, { action: { label: 'Download this', disabled: true } }),
)

export default {
  MOVIE,
  QUALITY_TIERS,
  TIER_HINT,
  RELEASES,
  RELEASES_ABSENT,
  ALL_REJECTED,

  FACTS: [
    ['Released', 'Mar 14, 2024'],
    ['Runtime', '2h 04m'],
    ['Rating', '7.4/10 · 15'],
    ['Genres', 'Drama, Thriller'],
    ['Quality', 'Bluray-1080p'],
    ['Size', '2.1 GB'],
    ['Language', 'English'],
    ['Path', '/movies/Salt & Ceremony (2024)', true],
  ],

  CAST: [
    ['ML', 'Mara Lin'],
    ['TA', 'Theo Aduba'],
    ['RO', 'Ren Osei'],
    ['KB', 'Kofi Boadi'],
    ['PN', 'Priya Nair'],
    ['WO', 'Wes Okafor'],
  ],
  CAST_MORE: '+6 more',

  ADDED: { who: ['JA', 'Jeremy'], when: '2h ago' },

  // The attempts shown under the header in the default (in library) state.
  ATTEMPTS_DEFAULT: [
    { job: 'completed', who: ['JA', 'Jeremy'], when: '2h ago' },
    {
      job: 'failed',
      who: ['JA', 'Jeremy'],
      when: '1d ago',
      error: 'Connection reset by peer.',
    },
    { job: 'cancelled', who: ['SR', 'Sam'], when: '3d ago' },
  ],

  STATES: {
    wanted: {
      attempts: [
        {
          job: 'not_found',
          who: ['JA', 'Jeremy'],
          when: '4m ago',
          note: 'No usable release — every result is flagged or rejected.',
          retry: true,
        },
      ],
    },
    downloading: {
      attempts: [
        {
          inFlight: true,
          state: 'downloading',
          pct: 47,
          line: '1.2 GB / 2.6 GB · 8.4 MB/s · ~3 min left',
          actions: [
            { label: 'Pause', variant: 'outline', icon: 'pause' },
            CANCEL,
          ],
        },
        {
          job: 'failed',
          who: ['JA', 'Jeremy'],
          when: '2h ago',
          error: 'Connection reset by peer.',
        },
      ],
    },
    importing: {
      attempts: [
        {
          inFlight: true,
          state: 'importing',
          settling: true,
          line: 'All 2.6 GB are down. Radarr is matching the file to the title.',
          actions: [CANCEL],
        },
      ],
    },
    paused: {
      attempts: [
        {
          inFlight: true,
          state: 'paused',
          pct: 47,
          tone: 'warn',
          line: '1.2 GB / 2.6 GB',
          note: 'Paused in SABnzbd — the download disk is almost full.',
          actions: [CANCEL],
        },
      ],
    },
    needs_attention: {
      attempts: [
        {
          inFlight: true,
          state: 'needs_attention',
          note: 'The bytes are already down — Radarr just couldn’t match the file to the title. Pick what to import, or discard.',
          actions: [
            { label: 'Import', variant: 'accent', icon: 'check' },
            { label: 'Discard', variant: 'bad', icon: 'trash' },
          ],
        },
      ],
    },
  },

  // Radarr upgrading a file that is already on disk. Not ours to cancel.
  EXTERNAL: {
    inFlight: true,
    state: 'downloading',
    pct: 72,
    line: '1.9 GB / 2.6 GB · 6.1 MB/s',
    note: 'Radarr is upgrading the file already on disk — it can’t be cancelled here.',
  },

  // A download started in Radarr’s own UI: adopted, attributed to Radarr.
  ADOPTED: [
    {
      inFlight: true,
      state: 'downloading',
      pct: 31,
      line: '0.8 GB / 2.6 GB · 5.2 MB/s · ~6 min left',
      actions: [CANCEL],
    },
    { job: 'completed', who: 'Radarr', when: '1d ago' },
  ],

  // What the download folder held, as Radarr’s manual import lists it. A movie
  // takes one file, so these are radios; the sample is drawn but unchosen.
  IMPORT_FILES: [
    {
      name: 'Salt.Ceremony.2024.1080p.BluRay.x265.mkv',
      detail: '2.1 GB · Bluray-1080p · English',
      checked: true,
    },
    {
      name: 'Featurettes/Making.Of.1080p.mkv',
      detail: '412 MB · Bluray-1080p · English',
    },
    {
      name: 'Sample/salt.ceremony-sample.mkv',
      detail: '48 MB · Bluray-1080p · English',
      sample: true,
    },
  ],
  IMPORT_REJECTION:
    'Movie [Salt & Ceremony (2024)][tmdb:558212] was not found in the grabbed release.',

  REASONS: ['Wrong audio or subtitles', 'Video won’t play', 'Not this movie'],
}
