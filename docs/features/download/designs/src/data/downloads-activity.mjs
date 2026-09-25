/*
 * Sample feed for downloads-activity.pug. Fictional titles, wired to the fixed
 * title -> asset mapping the other mockups share (see assets/README.md), so
 * "Salt & Ceremony" is the same artwork here as on movie-detail.
 *
 * `who: null` is a deliberately masked requester — attribution is hidden from
 * everyone but an admin, and the row still has to read as a real row.
 */

export default {
  ROWS: [
    {
      title: 'Sourdough starter, day one to seven',
      short: 'Sourdough starter…',
      kind: 'video',
      icon: 'play',
      art: 'assets/video/video-3.jpg',
      v: 2,
      who: ['JA', 'Jeremy'],
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
      who: null,
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
      state: 'failed',
      tone: 'bad',
      started: '5m ago',
    },
  ],
}
