// Copy and sample data for transcript.pug. The channel list, totals and the
// LLM calls under each reply are invented; the columns are the app's.

export { dict, emojiUrl, navLinks } from './shared.mjs'

export const channels = [
  { name: 'general', last: '2 min ago', calls: '1,284' },
  { name: 'media-requests', last: '1 h ago', calls: '412' },
  { name: 'dev', last: 'Yesterday', calls: '96' },
  { name: 'bot-testing', last: '29 Sep', calls: '37' },
]

export const totals = [
  { label: 'Total cost', value: '$4.8213' },
  { label: 'Input tokens', value: '2.41M' },
  { label: 'Output tokens', value: '188K' },
]

// One column definition draws the table (1280) and the cards (390).
export const callCols = [
  { key: 'operation', label: 'Operation' },
  { key: 'model', label: 'Model', mono: true },
  { key: 'inp', label: 'In', align: 'right', mono: true },
  { key: 'out', label: 'Out', align: 'right', mono: true },
  { key: 'cached', label: 'Cached', align: 'right', mono: true },
  { key: 'cost', label: 'Cost (USD)', align: 'right', mono: true },
  { key: 'duration', label: 'Duration', align: 'right', mono: true },
  { key: 'retries', label: 'Retries', align: 'right', mono: true },
  { key: 'finish', label: 'Finish', type: 'badge' },
]

export const callRows = [
  {
    operation: 'chat',
    model: 'gpt-4.1-mini',
    inp: '1,842',
    out: '96',
    cached: '1,536',
    cost: '$0.00088',
    costValue: 0.00088,
    duration: '1.12s',
    retries: '0',
    finish: { tone: 'accent', label: 'tool_calls' },
  },
  {
    operation: 'chat',
    model: 'gpt-4.1-mini',
    inp: '2,011',
    out: '212',
    cached: '1,792',
    cost: '$0.00131',
    costValue: 0.00131,
    duration: '2.34s',
    retries: '1',
    finish: { tone: 'ok', label: 'stop' },
  },
]

// The emoji conversation, as message parts: a string, { emoji } for a dictionary
// emoji, { fake } for a `<:name:id>` the model made up.
export const emojiTurns = [
  {
    who: 'user',
    name: 'Mika',
    time: '21:02',
    parts: ['raid tonight? ', { emoji: 'HYPERS' }],
  },
  {
    who: 'bot',
    time: '21:02',
    calls: 1,
    parts: [
      'Extremely ',
      { emoji: 'HYPERS' },
      ' ',
      { emoji: 'HYPERS' },
      ' — pulling up the loot tables now.',
    ],
  },
  {
    who: 'user',
    name: 'Sam',
    time: '21:04',
    parts: [
      'last time half the group fell asleep ',
      { emoji: 'residentsleeper' },
    ],
  },
  {
    who: 'bot',
    time: '21:04',
    calls: 2,
    open: true,
    parts: [
      'I’ll bring the wine ',
      { emoji: 'peepoWine' },
      ' and hype ',
      { fake: '<:PogU:564310072822333499>' },
      '. Plan is still loading ',
      { emoji: 'Loading' },
    ],
  },
]

export const jump = [
  ['Conversation', 'default'],
  ['Custom emojis', 'emojis'],
  ['Loading older', 'older'],
  ['No messages yet', 'empty'],
  ['Loading', 'loading'],
  ['Error', 'error'],
]
