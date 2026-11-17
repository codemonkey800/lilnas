// Copy and sample data for emojis.pug. The emojis are real Discord CDN ids (the
// images load from there); descriptions, models and dates are invented.

export { emojiUrl, navLinks } from './shared.mjs'

const longText =
  'Pepe with a wide, nervous grin and sweat beading on his forehead, used when something is about to go wrong or the speaker is anxious.'

export const rows = [
  {
    id: '564310072822333480',
    name: 'HYPERS',
    animated: false,
    desc: 'Pepe vibrating with excitement, eyes wide, used for hype.',
    source: 'manual',
    model: null,
    at: 'Oct 23, 9:02 AM',
  },
  {
    id: '564330871851712553',
    name: 'residentsleeper',
    animated: false,
    desc: 'A sleeping Resident Sleeper face with closed eyes and a droopy head, used when something is boring.',
    source: 'ai',
    model: 'gpt-5-mini',
    at: 'Oct 23, 9:02 AM',
  },
  {
    id: '1266528661318926369',
    name: 'peepoWine',
    animated: true,
    desc: 'Peepo frog sipping a glass of red wine, swirling it slowly.',
    source: 'ai',
    model: 'gpt-5-mini',
    at: 'Oct 23, 9:03 AM',
  },
  {
    id: '1275667821757464687',
    name: 'Loading',
    fallback: true,
    animated: true,
    desc: null,
    source: null,
    model: null,
    at: null,
  },
  {
    id: '564310072822333481',
    name: 'Sadge',
    fallback: true,
    animated: false,
    desc: longText,
    source: 'ai',
    model: 'gpt-5-mini',
    at: 'Oct 22, 4:41 PM',
  },
  {
    id: '564310072822333482',
    name: 'monkaS',
    fallback: true,
    animated: false,
    desc: 'Pepe sweating nervously with a tense, worried expression.',
    source: 'manual',
    model: null,
    at: 'Oct 21, 11:15 AM',
  },
  {
    id: '564310072822333483',
    name: 'PepeLaugh',
    fallback: true,
    animated: false,
    desc: 'Pepe laughing smugly with a hand over his mouth.',
    source: 'ai',
    model: 'gpt-5-mini',
    at: 'Oct 22, 4:41 PM',
  },
  {
    id: '564310072822333484',
    name: 'catJAM',
    fallback: true,
    animated: true,
    desc: 'A cat bobbing its head to the beat of music.',
    source: 'ai',
    model: 'gpt-5-mini',
    at: 'Oct 22, 4:42 PM',
  },
  {
    id: '564310072822333485',
    name: 'Clap',
    fallback: true,
    animated: true,
    desc: null,
    source: null,
    model: null,
    at: null,
  },
  {
    id: '564310072822333486',
    name: 'widepeepoHappy',
    fallback: true,
    animated: false,
    desc: 'A stretched-wide Peepo frog with a calm, content smile.',
    source: 'manual',
    model: null,
    at: 'Oct 19, 8:30 PM',
  },
  {
    id: '564310072822333487',
    name: 'FeelsBadMan',
    fallback: true,
    animated: false,
    desc: 'Sad Pepe with a single tear, used for disappointment.',
    source: 'ai',
    model: 'gpt-5-mini',
    at: 'Oct 18, 2:12 PM',
  },
  {
    id: '564310072822333488',
    name: 'OldHype',
    fallback: true,
    animated: false,
    desc: 'An older hype emote of a cheering figure.',
    source: 'ai',
    model: 'gpt-5-mini',
    at: 'Sep 20, 7:05 PM',
    deleted: 'Oct 2',
  },
]

export const emojiCounts = {
  All: 12,
  'Needs description': 2,
  AI: 7,
  Manual: 3,
  Deleted: 1,
}

export const copy = {
  redescribe: {
    title: 'Re-describe :HYPERS:?',
    lede: 'Replace this hand-written description with an AI one? The old text isn’t kept.',
    confirm: 'Re-describe',
    cancel: 'Keep it',
  },
  redescribeAll: {
    title: 'Re-describe all 12 emojis?',
    lede: 'Every emoji gets a new AI description, written in batches so similar emojis stay distinct. This runs in the background.',
    warn: '3 manual descriptions',
    warnBody: 'will be replaced. The old text isn’t kept.',
    confirm: 'Re-describe all',
    cancel: 'Cancel',
  },
  empty: {
    title: 'No emojis synced yet',
    body: 'Run a reconcile and the server’s custom emojis will show up here.',
    action: 'Run reconcile',
  },
  filtered: {
    title: 'No matching emojis',
    body: 'Nothing matches “zzz”. Check the spelling, or search by what the emoji looks like.',
  },
  reconcileError: {
    lead: 'Couldn’t start a reconcile.',
    body: 'The bot didn’t answer. It may be restarting — try again in a minute.',
  },
  loadError: {
    lead: 'Couldn’t load the emojis.',
    body: 'The API didn’t answer. Reload the page to try again.',
  },
}

export const jump = [
  ['Populated', 'default'],
  ['Editing a description', 'edit'],
  ['Reconcile running', 'running'],
  ['Re-describe · confirm', 'redescribe'],
  ['Re-describe all · confirm', 'redescribe-all'],
  ['Nothing synced', 'empty'],
  ['Search finds nothing', 'filtered'],
  ['Loading', 'loading'],
  ['Errors', 'errors'],
]
