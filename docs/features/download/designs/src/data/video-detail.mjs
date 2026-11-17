/*
 * Sample data for video-detail.pug. "How to kettlebell swing (in 3 minutes)"
 * is assets/video/video-1.jpg wherever it appears (see assets/README.md).
 *
 * A video has no library to be "in" and nothing imports it, so its media
 * badge reads Downloaded (not In library) and its importing state is
 * yt-dlp's convert/upload/clean — mediaBadge(state, 'video') owns that.
 */

const CANCEL = { label: 'Cancel', variant: 'bad', icon: 'x' }

const VIDEO = {
  title: 'How to kettlebell swing (in 3 minutes)',
  art: 'assets/video/video-1.jpg',
  v: 2,
  meta: 'Hardstyle Hannah · 2:58 · 1080p',
}

export default {
  VIDEO,

  ADDED: { who: ['SR', 'Sam'], when: '9h ago' },

  DETAILS: [
    ['Channel', 'Hardstyle Hannah'],
    ['Published', 'Sep 29, 2026'],
    ['Stats', '48K views · 2.1K likes · 96 comments'],
    ['Clip', '2:58'],
  ],
  TAGS: ['kettlebell', 'strength', 'beginner'],
  FILE: [
    ['Video', '1920×1080 · h264 · 30 fps'],
    ['Size', '86 MB'],
    ['Parts', '1'],
    ['Source', 'youtube.com/watch?v=kb3swing01', true],
  ],

  // Where the player is: waiting on a press, or playing.
  PLAYER: {
    idle: { pct: 0, time: '0:00 / 2:58' },
    playing: { pct: 34, time: '1:00 / 2:58', playing: true },
  },

  STATES: {
    absent: {
      note: 'Ready to grab whenever.',
    },
    downloading: {
      attempts: [
        {
          inFlight: true,
          state: 'downloading',
          type: 'video',
          pct: 64,
          line: 'fragment 4 of 9 · 412 MB / 640 MB · 3.1 MB/s · ~2m left',
          actions: [
            { label: 'Pause', variant: 'outline', icon: 'pause' },
            CANCEL,
          ],
        },
      ],
    },
    importing: {
      attempts: [
        {
          inFlight: true,
          state: 'importing',
          type: 'video',
          job: 'converting',
          settling: true,
          line: 'Downloaded. yt-dlp is converting it to mp4.',
          actions: [CANCEL],
        },
      ],
    },
    paused: {
      attempts: [
        {
          inFlight: true,
          state: 'paused',
          type: 'video',
          pct: 18,
          tone: 'warn',
          line: 'fragment 2 of 9 · 115 MB / 640 MB',
          actions: [
            { label: 'Resume', variant: 'accent', icon: 'play' },
            CANCEL,
          ],
        },
      ],
    },
    failed: {
      attempts: [
        {
          job: 'failed',
          who: ['SR', 'Sam'],
          when: '5m ago',
          error: 'The source stopped answering after 3 retries.',
          retry: true,
        },
      ],
    },
    cancelled: {
      attempts: [
        {
          job: 'cancelled',
          who: ['SR', 'Sam'],
          when: '2m ago',
          retry: true,
        },
      ],
    },
  },

  UNRECOGNISED: {
    lead: 'That link isn’t one yt-dlp recognises.',
    body: 'Paste a different link in the search field at the top of the page. Nothing was downloaded, and asking for this one again would fail the same way.',
  },

  ATTEMPTS_DEFAULT: [
    {
      job: 'completed',
      who: ['SR', 'Sam'],
      when: '9h ago',
    },
  ],

  DELETE_BODY:
    'Removes this video’s downloaded file and frees 86 MB. The source link stays on this page, so it can be downloaded again.',
}
