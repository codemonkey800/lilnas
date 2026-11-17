// Copy and sample data for playground.pug. Messages are lists of parts: a plain
// string, { emoji } for a dictionary emoji (an inline image) or { fake } for a
// `<:name:id>` the model made up. Costs, latencies and ids are invented.

import { savedPrompt } from './shared.mjs'

export { dict, emojiUrl, navLinks } from './shared.mjs'

export const playgroundModels = [
  {
    id: 'gpt-4.1',
    desc: 'Flagship non-reasoning model. Fast, strong tool use.',
    inp: 2.0,
    out: 8.0,
  },
  {
    id: 'gpt-4.1-mini',
    desc: 'Cheaper everyday chat. Good default.',
    inp: 0.4,
    out: 1.6,
  },
  {
    id: 'gpt-5',
    desc: 'Best reasoning, used for math and planning.',
    inp: 1.25,
    out: 10.0,
  },
  {
    id: 'gpt-5-mini',
    desc: 'Reasoning model. Slower, better on hard questions.',
    inp: 0.25,
    out: 2.0,
  },
]

export const draftPrompt = `${savedPrompt} Use the server’s custom emojis whenever they fit.`

const score = (dictionary, hallucinated, unicode, repaired = 0) => ({
  dictionary,
  hallucinated,
  unicode,
  repaired,
})

export const turns = [
  { who: 'user', parts: ['yo tdr-bot, hyped for the raid tonight?'] },
  {
    who: 'bot',
    parts: [
      'Extremely ',
      { emoji: 'HYPERS' },
      ' ',
      { emoji: 'HYPERS' },
      ' — pulling up the loot tables now.',
    ],
    meta: 'gpt-5-mini · $0.0038 · 1.6 s',
    score: score(2, 0, 0),
  },
  { who: 'user', parts: ['lol last time half the group fell asleep'] },
  {
    who: 'bot',
    parts: [
      'Rude but fair ',
      { emoji: 'residentsleeper' },
      ' — I’ll bring the wine this time ',
      { emoji: 'peepoWine' },
      '. Still loading the plan ',
      { emoji: 'Loading' },
    ],
    meta: 'gpt-5-mini · $0.0041 · 1.9 s',
    score: score(3, 0, 0),
  },
  { who: 'user', parts: ['nice, can you hype everyone up with emotes?'] },
  {
    who: 'bot',
    parts: [
      'LET’S GO ',
      { emoji: 'HYPERS' },
      ' ',
      { fake: '<:PogU:564310072822333499>' },
      ' 🔥🔥 raid at 9, be there ',
      { emoji: 'peepoWine' },
    ],
    meta: 'gpt-5-mini · $0.0042 · 1.8 s',
    score: score(2, 1, 2, 1),
  },
]

export const pendingTurns = [
  { who: 'user', parts: ['what does residentsleeper mean anyway'] },
]

export const copy = {
  empty: {
    title: 'No messages yet',
    body: 'Ask the model something and see whether it reaches for the server’s emojis.',
  },
  failed:
    'gpt-5 didn’t answer within 90 seconds. It may be busy — try again, or pick another model.',
  evalError: {
    lead: 'The eval stopped.',
    body: 'gpt-5 returned 429 on 6 prompts. Results so far are below; run it again in a minute.',
  },
}

export const evalPrompts = [
  'Hype everyone up for tonight’s raid.',
  'Someone says the meeting was boring. React.',
  'Recommend a wine for movie night.',
  'Say good morning to the channel.',
  'Celebrate a friend’s birthday.',
  'Tell us the download is still running.',
  'React to a bad pun.',
  'Someone lost a ranked match. Console them.',
  'Announce pizza has arrived.',
  'Wish the channel good night.',
]

export const evalColumns = [
  'Model',
  'Reply rate',
  'Dictionary',
  'Repaired',
  'Hallucinated',
  'Unicode',
  'Cost',
  'Latency',
]

const reply = (i, parts, meta, s) => ({
  prompt: evalPrompts[i],
  parts,
  meta,
  score: s,
})

export const evalRows = [
  {
    model: 'gpt-4.1',
    ratePct: 60,
    rate: '60%',
    dictionary: 9,
    repaired: 0,
    hallucinated: 3,
    unicode: 7,
    cost: '$0.0031',
    latency: '1.1 s',
    replies: [
      reply(
        0,
        [
          'Raid night! ',
          { emoji: 'HYPERS' },
          ' ',
          { fake: '<:PogU:564310072822333499>' },
        ],
        'gpt-4.1 · $0.0030 · 1.0 s',
        score(1, 1, 0),
      ),
      reply(
        1,
        ['Tough crowd ', { emoji: 'residentsleeper' }, '.'],
        'gpt-4.1 · $0.0029 · 1.1 s',
        score(1, 0, 0),
      ),
      reply(
        2,
        ['A cold rosé for movie night 🍷'],
        'gpt-4.1 · $0.0033 · 1.2 s',
        score(0, 0, 1),
      ),
    ],
  },
  {
    model: 'gpt-4.1-mini',
    ratePct: 70,
    rate: '70%',
    dictionary: 11,
    repaired: 0,
    hallucinated: 2,
    unicode: 4,
    cost: '$0.0009',
    latency: '0.8 s',
    replies: [
      reply(
        0,
        ['Big raid energy ', { emoji: 'HYPERS' }, ' ', { emoji: 'HYPERS' }],
        'gpt-4.1-mini · $0.0008 · 0.8 s',
        score(2, 0, 0),
      ),
      reply(
        1,
        ['Fair, it ran long ', { emoji: 'residentsleeper' }],
        'gpt-4.1-mini · $0.0009 · 0.7 s',
        score(1, 0, 0),
      ),
      reply(
        2,
        ['Try a pinot ', { fake: '<:peepoSip:1266528661318926000>' }],
        'gpt-4.1-mini · $0.0010 · 0.9 s',
        score(0, 1, 0),
      ),
    ],
  },
  {
    model: 'gpt-5',
    ratePct: 80,
    rate: '80%',
    dictionary: 14,
    repaired: 0,
    hallucinated: 0,
    unicode: 2,
    cost: '$0.0124',
    latency: '4.3 s',
    failed: 2,
    replies: [
      reply(
        0,
        [
          'Tonight we feast ',
          { emoji: 'HYPERS' },
          ' ',
          { emoji: 'HYPERS' },
          ' ',
          { emoji: 'peepoWine' },
        ],
        'gpt-5 · $0.0131 · 4.4 s',
        score(3, 0, 0),
      ),
      {
        prompt: evalPrompts[1],
        error: 'rate limited (429)',
      },
      reply(
        2,
        ['A Rioja, for the long ones ', { emoji: 'peepoWine' }],
        'gpt-5 · $0.0118 · 4.1 s',
        score(1, 0, 0),
      ),
    ],
  },
  {
    model: 'gpt-5-mini',
    ratePct: 90,
    rate: '90%',
    dictionary: 16,
    repaired: 2,
    hallucinated: 1,
    unicode: 3,
    cost: '$0.0042',
    latency: '1.8 s',
    replies: [
      reply(
        0,
        [
          'Extremely ',
          { emoji: 'HYPERS' },
          ' ',
          { emoji: 'HYPERS' },
          ' — loot tables are up.',
        ],
        'gpt-5-mini · $0.0038 · 1.6 s',
        score(2, 0, 0),
      ),
      reply(
        1,
        ['Rude but fair ', { emoji: 'residentsleeper' }],
        'gpt-5-mini · $0.0041 · 1.9 s',
        score(1, 0, 0),
      ),
      reply(
        2,
        ['Bring the red ', { emoji: 'peepoWine' }, ' and a blanket.'],
        'gpt-5-mini · $0.0044 · 1.9 s',
        score(1, 0, 0, 1),
      ),
    ],
  },
]

export const jump = [
  ['Conversation', 'default'],
  ['Model select open', 'model'],
  ['Prompt draft modified', 'draft'],
  ['Prompt draft open', 'draft-open'],
  ['Reply pending', 'pending'],
  ['Reply failed', 'failed'],
  ['Empty thread', 'empty'],
  ['Eval · ready', 'eval'],
  ['Eval · running', 'eval-running'],
  ['Eval · results', 'eval-done'],
  ['Eval · error', 'eval-error'],
  ['Reset · confirm', 'reset'],
]
