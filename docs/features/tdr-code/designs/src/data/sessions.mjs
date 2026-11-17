// Copy and sample data for sessions.pug. A session is one Claude Code process
// the bot ran for a channel; ids are the DB's autoincrement, so they're mono.

export const columns = [
  { key: 'id', label: 'ID', type: 'link', mono: true, title: true },
  { key: 'channel', label: 'Channel' },
  { key: 'user', label: 'User' },
  { key: 'created', label: 'Created', muted: true },
  { key: 'ended', label: 'Ended', type: 'ended', corner: true },
  { key: 'reason', label: 'Reason', mono: true, muted: true },
]

const all = [
  ['#4826', '#ops-agent', 'Jeremy', '12m ago', { active: true }, ''],
  ['#4825', '#homelab', 'Sam', '1h ago', { ago: '38m ago' }, 'idle-timeout'],
  ['#4824', '#design-review', 'Alex', '3h ago', { ago: '2h ago' }, 'teardown'],
  ['#4823', '#ops-agent', 'Jeremy', '5h ago', { ago: '4h ago' }, 'bot-restart'],
  ['#4822', '#scratch', 'Jeremy', '1d ago', { ago: '1d ago' }, 'evicted'],
  ['#4821', '#homelab', 'Sam', '1d ago', { ago: '1d ago' }, 'idle-timeout'],
]

const toRow = ([id, channel, user, created, ended, reason]) => ({
  id,
  channel,
  user,
  created,
  ended,
  reason,
})

export const rows = all.map(toRow)
export const filteredRows = all.filter(r => r[1] === '#homelab').map(toRow)

export const copy = {
  placeholder: 'Filter by channel ID (17–20 digits)',
  channelId: '1184726493302157312',
  loading: 'Fetching sessions…',
  error: {
    lead: "Couldn't load sessions.",
    detail: "The server didn't answer. Try again in a minute.",
    code: 'GET /api/sessions 502',
  },
  empty: {
    title: 'No sessions yet',
    body: "Start one from Discord and it'll appear here.",
  },
  filteredEmpty: {
    title: 'No sessions in that channel',
    body: "Nothing has run there, or the ID isn't one the bot knows.",
    action: 'Clear filter',
  },
}

export const states = [
  { label: 'Default', caption: 'newest first, 25 per page', body: 'rows' },
  {
    label: 'Load more',
    caption: 'fetching the next page',
    body: 'rows',
    loadingMore: true,
  },
  {
    label: 'Filtered',
    caption: 'one channel, Clear shown',
    body: 'filtered',
    filter: copy.channelId,
  },
  {
    label: 'Filtered, nothing',
    caption: 'a filter hid everything',
    body: 'filtered-empty',
    filter: '1184726493302157399',
  },
  { label: 'Empty', caption: 'no session has ever run', body: 'empty' },
  { label: 'Loading', caption: 'first fetch', body: 'loading' },
  { label: 'Error', caption: "the list didn't load", body: 'error' },
]
