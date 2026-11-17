/*
 * Sample data for admin.pug.
 *
 * HISTORY is the full download history — every status, including the terminal
 * ones the activity feed never shows — with attribution unmasked. Its first
 * five rows are the activity feed's, so the in-flight items still match 1:1;
 * a completed and a cancelled row only exist here. Row 4 is the one hidden
 * from regular users: there it shows a dashed avatar and "Hidden", here it
 * shows Sam and says it is hidden from others.
 *
 * `status` is a badge's options ({ tone, label, live }), which is what the
 * kit's dataList takes for a `type: 'badge'` column.
 */

const DOWNLOADING = { tone: 'accent', label: 'Downloading', live: true }
const QUEUED = { tone: 'warn', label: 'Queued' }
const PAUSED = { tone: 'warn', label: 'Paused' }
const FAILED = { tone: 'bad', label: 'Failed' }
const COMPLETED = { tone: 'ok', label: 'Completed' }
const CANCELLED = { tone: 'mute', label: 'Cancelled' }

export default {
  STATS: [
    { label: 'Total downloads', value: '1,842', foot: 'All time' },
    { label: 'Active users', value: '9', foot: 'Past 7 days' },
    {
      label: 'Storage used',
      value: '412',
      unit: 'GB',
      meter: 41,
      foot: 'of 1 TB',
    },
    {
      label: 'Running now',
      value: '2',
      live: true,
      foot: 'Downloads in progress',
    },
  ],

  HISTORY_COLS: [
    { key: 'item', label: 'Item' },
    { key: 'type', label: 'Type' },
    { key: 'requester', label: 'Requested by' },
    { key: 'status', label: 'Status', type: 'badge' },
    { key: 'started', label: 'Started', align: 'right' },
  ],

  HISTORY: [
    {
      item: 'Sourdough starter, day one to seven',
      type: 'Video',
      requester: 'Jeremy',
      status: DOWNLOADING,
      started: '2m ago',
    },
    {
      item: 'Salt & Ceremony',
      type: 'Movie',
      requester: 'Sam',
      status: QUEUED,
      started: '12s ago',
    },
    {
      item: 'Harbor Watch — S2E3',
      type: 'Show',
      requester: 'Alex',
      status: DOWNLOADING,
      started: '45s ago',
    },
    {
      item: 'the only kettlebell move you need',
      type: 'Video',
      requester: 'Sam (hidden from others)',
      status: PAUSED,
      started: '3m ago',
    },
    {
      item: 'Paper Weather',
      type: 'Movie',
      requester: 'Jeremy',
      status: FAILED,
      started: '5m ago',
    },
    {
      item: 'The Long Corridor',
      type: 'Movie',
      requester: 'Priya',
      status: COMPLETED,
      started: '1h ago',
    },
    {
      item: 'Late Kitchen',
      type: 'Show',
      requester: 'Theo',
      status: CANCELLED,
      started: '3h ago',
    },
  ],

  // The filters in play on the "filtered" row.
  CHIPS: [
    ['Sam', 'Remove requester filter'],
    ['Movies', 'Remove type filter'],
    ['Last 30 days', 'Remove date filter'],
  ],

  LEADERBOARD: [
    { initials: 'JA', name: 'Jeremy', count: 42, you: true },
    { initials: 'SR', name: 'Sam', count: 31 },
    { initials: 'AC', name: 'Alex', count: 24 },
    { initials: 'PN', name: 'Priya', count: 15 },
    { initials: 'TK', name: 'Theo', count: 9 },
  ],

  AUDIT_COLS: [
    { key: 'at', label: 'Time', mono: true },
    { key: 'action', label: 'Action', type: 'badge' },
    { key: 'what', label: 'What' },
  ],

  // Action tones carry the meaning: ok for a delivered download, accent for the
  // one action that records a person exercising privilege, warn for changes,
  // bad for a deletion, mute for the machine talking.
  AUDIT: [
    {
      at: '15:42:08',
      action: { tone: 'ok', label: 'Download' },
      what: 'jeremy → “Sourdough starter, day one to seven” (video)',
    },
    {
      at: '15:38:51',
      action: { tone: 'ok', label: 'Download' },
      what: 'sam → “Salt & Ceremony” (movie)',
    },
    {
      at: '15:31:20',
      action: { tone: 'accent', label: 'Admin' },
      what: 'jeremy viewed hidden attribution on “the only kettlebell move you need”',
    },
    {
      at: '15:24:47',
      action: { tone: 'warn', label: 'Flag' },
      what: 'alex flagged release bad — Harbor.Watch.S2E3.1080p.mkv',
    },
    {
      at: '15:19:03',
      action: { tone: 'warn', label: 'Replace' },
      what: 'alex replaced release for Harbor Watch S2E3',
    },
    {
      at: '15:02:56',
      action: { tone: 'bad', label: 'Delete' },
      what: 'sam deleted “Old Draft — unpublished.mp4”',
    },
    {
      at: '14:47:12',
      action: { tone: 'mute', label: 'API' },
      what: 'sonarr-webhook re-indexed Harbor Watch S2E3',
    },
    {
      at: '14:30:44',
      action: { tone: 'mute', label: 'Auth' },
      what: 'alex signed in',
    },
  ],
}
