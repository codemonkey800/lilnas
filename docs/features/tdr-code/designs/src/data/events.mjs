// Copy and sample data for events.pug. The feed of what the bot did: one row
// per event, newest first. Types are the DB's slugs, so they stay mono.

export const columns = [
  { key: 'time', label: 'Time', muted: true },
  { key: 'level', label: 'Level', type: 'badge' },
  { key: 'type', label: 'Type', mono: true, title: true },
  { key: 'channel', label: 'Channel' },
  { key: 'session', label: 'Session', type: 'link', mono: true },
]

const level = {
  info: { tone: 'mute', label: 'Info' },
  warn: { tone: 'warn', label: 'Warn' },
  error: { tone: 'bad', label: 'Error' },
}

const all = [
  ['12s ago', 'info', 'turn_started', '#ops-agent', '#4826'],
  ['4m ago', 'info', 'turn_completed', '#homelab', '#4825'],
  ['9m ago', 'error', 'turn_errored', '#design-review', '#4824'],
  ['38m ago', 'warn', 'git_push_blocked', '#design-review', '#4824'],
  ['1h ago', 'info', 'session_created', '#homelab', '#4825'],
  ['4h ago', 'info', 'bot_restart', '', ''],
  ['4h ago', 'warn', 'command_anomaly', '', ''],
  ['1d ago', 'info', 'session_evicted', '#scratch', '#4822'],
]

const toRow = ([time, lv, type, channel, session]) => ({
  time,
  level: level[lv],
  type,
  channel,
  session,
})

export const rows = all.map(toRow)
export const filteredRows = all.filter(r => r[1] === 'warn').map(toRow)

export const copy = {
  typeOptions: [
    'session_created',
    'session_evicted',
    'turn_started',
    'turn_completed',
    'turn_cancelled',
    'turn_errored',
    'turn_interrupted',
    'bot_restart',
    'command_anomaly',
    'transcript_write_failed',
    'git_push_blocked',
    'git_key_decrypt_failed',
    'gh_blocked',
    'github_token_decrypt_failed',
  ],
  channelPlaceholder: 'Channel ID',
  loading: 'Fetching events…',
  error: {
    lead: "Couldn't load events.",
    detail: "The server didn't answer. Try again in a minute.",
    code: 'GET /api/events 502',
  },
  empty: {
    title: 'No events yet',
    body: 'The bot writes one for every session, turn and restart.',
  },
  filteredEmpty: {
    title: 'No events match',
    body: 'Nothing was logged for those filters.',
    action: 'Clear filters',
  },
}

export const states = [
  { label: 'Default', caption: 'newest first, 50 per page', body: 'rows' },
  {
    label: 'Type menu',
    caption: 'the type select, open',
    body: 'rows',
    openType: true,
  },
  {
    label: 'Filtered',
    caption: 'level and channel set, Clear filters shown',
    body: 'filtered',
    level: 'Warn',
    channel: '1184726493302157312',
  },
  {
    label: 'Filtered, nothing',
    caption: 'a filter hid everything',
    body: 'filtered-empty',
    type: 'transcript_write_failed',
    level: 'Error',
  },
  { label: 'Empty', caption: 'no event has been logged', body: 'empty' },
  { label: 'Loading', caption: 'first fetch', body: 'loading' },
  { label: 'Error', caption: "the feed didn't load", body: 'error' },
]
