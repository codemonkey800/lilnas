/*
 * Sample data for admin-dashboard.pug.
 *
 * HISTORY is deliberately NOT the same set as downloads-activity.js's ROWS:
 * this page's table is the full download history (every status, including
 * terminal ones downloads-activity.html never shows), with attribution
 * unmasked. It shares its first five rows with downloads-activity.js so the
 * in-progress items still match 1:1, then adds a completed and a cancelled
 * row that only exist here. Row 4 is the one hidden from regular users: there
 * it shows a dashed avatar and "hidden", here it shows Sam plus an eye-slash
 * marking that an admin is seeing something others can't.
 */

export default {
  STATS: [
    {
      label: 'total downloads',
      value: '1,842',
      foot: 'all time',
      footMobile: 'all time',
    },
    {
      label: 'active users',
      value: '9',
      foot: 'past 7 days',
      footMobile: 'past 7 days',
    },
    {
      label: 'storage used',
      value: '412',
      unit: 'GB',
      bar: 41,
      foot: 'of 1 TB capacity',
      footMobile: 'of 1 TB',
    },
    {
      label: 'currently running',
      labelMobile: 'running',
      value: '2',
      live: true,
      foot: 'downloads in progress',
      footMobile: 'in progress',
    },
  ],

  HISTORY: [
    {
      title: 'Sourdough starter, day one to seven',
      short: 'Sourdough starter…',
      kind: 'video',
      icon: 'play',
      art: 'assets/video/video-3.jpg',
      v: 2,
      who: ['JA', 'Jeremy'],
      you: true,
      state: 'downloading',
      tone: 'ok',
      live: true,
      progress: 64,
      started: '2m ago',
    },
    {
      title: 'Salt & Ceremony',
      kind: 'movie',
      icon: 'film',
      art: 'assets/emby/movie-1.jpg',
      v: 1,
      who: ['SR', 'Sam'],
      state: 'queued',
      tone: 'mute',
      started: '12s ago',
    },
    {
      title: 'Harbor Watch — S2E3',
      kind: 'show',
      icon: 'tv',
      art: 'assets/emby/show-1.jpg',
      v: 3,
      who: ['AC', 'Alex'],
      state: 'downloading',
      tone: 'ok',
      live: true,
      progress: 31,
      started: '45s ago',
    },
    {
      title: 'the only kettlebell move you need',
      short: 'the only kettlebell…',
      kind: 'video',
      icon: 'play',
      art: 'assets/video/video-1.jpg',
      v: 4,
      who: ['SR', 'Sam'],
      // masked from everyone else; an admin sees the name and this marker
      hiddenFromOthers: true,
      state: 'paused',
      tone: 'mute',
      progress: 18,
      quietProgress: true,
      mobileState: 'paused · 18%',
      started: '3m ago',
    },
    {
      title: 'Paper Weather',
      kind: 'movie',
      icon: 'film',
      art: 'assets/emby/movie-3.jpg',
      v: 1,
      who: ['JA', 'Jeremy'],
      you: true,
      state: 'failed',
      tone: 'bad',
      started: '5m ago',
    },
    // Terminal rows below: only ever visible here, never on the in-progress
    // downloads-activity feed. Title/asset pairing borrowed from gallery.mjs
    // so the fixed title -> asset mapping holds across mockups.
    {
      title: 'The Long Corridor',
      kind: 'movie',
      icon: 'film',
      art: 'assets/emby/movie-2.jpg',
      v: 4,
      who: ['PN', 'Priya'],
      state: 'completed',
      tone: 'ok',
      started: '1h ago',
    },
    {
      title: 'Late Kitchen',
      kind: 'show',
      icon: 'tv',
      art: 'assets/emby/show-2.jpg',
      v: 5,
      who: ['TK', 'Theo'],
      state: 'cancelled',
      tone: 'mute',
      started: '3h ago',
    },
  ],

  LEADERBOARD: [
    ['JA', 'Jeremy', 42, true],
    ['SR', 'Sam', 31],
    ['AC', 'Alex', 24],
    ['PN', 'Priya', 15],
    ['TK', 'Theo', 9],
  ],

  // Level colours carry the meaning; the text stays mono because this is the
  // machine talking. ADMIN is accent-coloured because it's the one level that
  // records a person exercising privilege.
  AUDIT: [
    {
      at: '15:42:08',
      level: 'DOWNLOAD',
      tone: 'text-ok',
      what: 'jeremy → "Sourdough starter, day one to seven" (video)',
      whatMobile: 'jeremy → "Sourdough starter…" (video)',
    },
    {
      at: '15:38:51',
      level: 'DOWNLOAD',
      tone: 'text-ok',
      what: 'sam → "Salt & Ceremony" (movie)',
    },
    {
      at: '15:31:20',
      level: 'ADMIN',
      tone: 'text-uv',
      what: 'jeremy viewed hidden attribution on "the only kettlebell move you need"',
      whatMobile: 'jeremy viewed hidden attribution on "the only kettlebell…"',
    },
    {
      at: '15:24:47',
      level: 'FLAG',
      tone: 'text-warn',
      what: 'alex flagged release bad — Harbor.Watch.S2E3.1080p.mkv',
    },
    {
      at: '15:19:03',
      level: 'REPLACE',
      tone: 'text-warn',
      what: 'alex replaced release for Harbor Watch S2E3',
    },
    {
      at: '15:02:56',
      level: 'DELETE',
      tone: 'text-bad',
      what: 'sam deleted "Old Draft — unpublished.mp4"',
    },
    {
      at: '14:47:12',
      level: 'API',
      tone: 'text-ink-4',
      what: 'sonarr-webhook re-indexed Harbor Watch S2E3',
    },
    {
      at: '14:30:44',
      level: 'AUTH',
      tone: 'text-ink-4',
      what: 'alex signed in',
    },
  ],
}
