/*
 * Sample feed for activity.pug. Fictional titles, wired to the fixed
 * title -> asset mapping the other mockups share (see assets/README.md), so
 * "Salt & Ceremony" is the same artwork here as on movie-detail.
 *
 * `status` is a job status key (see jobBadge in mixins/download.pug).
 * `who: null` is a deliberately masked requester — attribution is hidden from
 * everyone but an admin, and the row still has to read as a real row.
 * `settling` is a full bar whose work isn't done: every byte is down, the
 * import isn't.
 */

export default {
  TABS: ['All', 'Videos', 'Movies', 'Shows'],

  ROWS: [
    {
      title: 'Sourdough starter, day one to seven',
      kind: 'Video',
      icon: 'play',
      art: 'assets/video/video-3.jpg',
      v: 2,
      who: ['JA', 'Jeremy'],
      status: 'downloading',
      progress: 64,
      started: '2m ago',
    },
    {
      title: 'Salt & Ceremony',
      kind: 'Movie',
      icon: 'film',
      art: 'assets/emby/movie-1.jpg',
      v: 1,
      who: ['SR', 'Sam'],
      status: 'pending',
      started: '12s ago',
    },
    {
      title: 'Harbor Watch — S2E3',
      kind: 'Show',
      icon: 'tv',
      art: 'assets/emby/show-1.jpg',
      v: 3,
      who: ['AC', 'Alex'],
      status: 'importing',
      progress: 100,
      settling: true,
      started: '45s ago',
    },
    {
      title: 'the only kettlebell move you need',
      kind: 'Video',
      icon: 'play',
      art: 'assets/video/video-1.jpg',
      v: 4,
      who: null,
      status: 'paused',
      progress: 18,
      started: '3m ago',
    },
    {
      title: 'Paper Weather',
      kind: 'Movie',
      icon: 'film',
      art: 'assets/emby/movie-3.jpg',
      v: 1,
      who: ['JA', 'Jeremy'],
      status: 'failed',
      started: '5m ago',
    },
  ],

  // The sixteen job statuses, in lifecycle order (job-state.ts).
  STATUSES: [
    'requested',
    'pending',
    'searching',
    'downloading',
    'pausing',
    'paused',
    'converting',
    'uploading',
    'importing',
    'cleaning',
    'completed',
    'needs_attention',
    'not_found',
    'failed',
    'cancelling',
    'cancelled',
  ],
}
