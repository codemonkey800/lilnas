// Copy and sample data for dashboard.pug. Terse and factual (voice.md,
// tdr-code): the bot's state, then what to do about it. Times are machine
// facts (`12s ago`), not prose.

// The six words the BotStatusWidget can say, as StatusDot tones. Only an
// online bot pulses; a problem never does.
export const bot = {
  online: { tone: 'ok', pulse: true, label: 'Online' },
  starting: { tone: 'warn', label: 'Starting…' },
  offline: { tone: 'bad', label: 'Offline', seen: '4h ago' },
  failed: { tone: 'bad', label: 'Supervisor gave up', seen: '4h ago' },
  never: { tone: 'idle', label: 'Never seen' },
  unknown: { tone: 'idle', label: "Can't reach server" },
  loading: { tone: 'idle', label: 'Checking…' },
}

// LiveChannelItemDto['state'] as a Badge. Idle isn't a warning (it's the
// normal resting state) so it's the accent; a stale session is the one that
// needs a look.
const channelState = {
  working: { tone: 'ok', label: 'Working', live: true },
  idle: { tone: 'accent', label: 'Idle' },
  stale: { tone: 'bad', label: 'Stale' },
  'last-known': { tone: 'mute', label: 'Last known' },
}

const base = [
  ['#ops-agent', 'Jeremy', 'working', 2, '12s ago'],
  ['#homelab', 'Sam', 'idle', 0, '4m ago'],
  ['#design-review', 'Alex', 'stale', 1, '38m ago'],
  ['#scratch', 'Jeremy', 'idle', 0, '2h ago'],
]

function rows(list, patch = {}) {
  return list.map(([channel, user, state, queue, last], i) => ({
    channel,
    user,
    state: channelState[state],
    queue,
    last,
    ...(patch[i] || {}),
  }))
}

export const columns = [
  { key: 'channel', label: 'Channel', type: 'link', title: true },
  { key: 'user', label: 'User' },
  { key: 'state', label: 'State', type: 'badge' },
  { key: 'queue', label: 'Queue', align: 'right' },
  { key: 'last', label: 'Last activity', muted: true },
  {
    key: 'actions',
    label: 'Actions',
    align: 'right',
    type: 'render',
    render: 'teardownCell',
    actions: true,
  },
]

export const copy = {
  teardownPrompt: 'Kill active session?',
  restartPrompt: 'Restarts all channels',
  restartError: "Couldn't restart the bot. The supervisor didn't answer.",
  restartErrorCode: 'POST /api/restart 502',
  teardownError: "Couldn't tear down #design-review. The bot didn't answer.",
  teardownErrorCode: 'POST /api/live/teardown 502',
  loading: 'Fetching active sessions…',
  error: {
    lead: "Couldn't load active sessions.",
    detail: "The server didn't answer. Try again in a minute.",
    code: 'GET /api/live 502',
  },
  offline: { lead: 'Bot is offline.', detail: 'Showing the last-known state.' },
  never: {
    title: 'Bot has never run',
    body: 'Once it starts, its sessions show up here.',
  },
  empty: {
    title: 'No active sessions',
    body: "Start one from Discord and it'll appear here.",
  },
  offlineEmpty: {
    title: 'No last-known activity',
    body: 'The bot is offline and has nothing on record.',
  },
}

// One entry per captioned row. `body` picks what sits under "Active sessions".
export const states = [
  {
    label: 'Online',
    caption: 'bot up, four channels',
    bot: bot.online,
    body: 'rows',
    rows: rows(base),
  },
  {
    label: 'Tear down',
    caption: 'inline confirm on one row',
    bot: bot.online,
    body: 'rows',
    rows: rows(base, { 2: { confirm: true } }),
  },
  {
    label: 'Tear down failed',
    caption: 'row error under the row',
    bot: bot.online,
    body: 'rows',
    rows: rows(base, {
      2: {
        error:
          "Couldn't tear down #design-review. The bot didn't answer. POST /api/live/teardown 502",
      },
    }),
  },
  {
    label: 'Restart bot',
    caption: 'inline confirm',
    bot: bot.online,
    restart: 'confirm',
    body: 'rows',
    rows: rows(base),
  },
  {
    label: 'Restart failed',
    caption: 'error under the button',
    bot: bot.online,
    restart: 'error',
    body: 'rows',
    rows: rows(base),
  },
  {
    label: 'Starting',
    caption: 'bot coming up',
    bot: bot.starting,
    body: 'empty',
  },
  {
    label: 'Offline',
    caption: 'last-known state, with the note',
    bot: bot.offline,
    offline: true,
    body: 'rows',
    rows: rows(
      base.map(r => [r[0], r[1], 'last-known', r[3], r[4]]).slice(0, 3),
    ),
  },
  {
    label: 'Supervisor gave up',
    caption: 'offline and not coming back by itself',
    bot: bot.failed,
    offline: true,
    body: 'offline-empty',
  },
  {
    label: 'Never run',
    caption: 'no activity recorded',
    bot: bot.never,
    body: 'never',
  },
  {
    label: 'No sessions',
    caption: 'bot up, nothing running',
    bot: bot.online,
    body: 'empty',
  },
  {
    label: 'Loading',
    caption: 'first fetch',
    bot: bot.loading,
    body: 'loading',
  },
  {
    label: 'Error',
    caption: "the live list didn't load",
    bot: bot.unknown,
    body: 'error',
  },
]
