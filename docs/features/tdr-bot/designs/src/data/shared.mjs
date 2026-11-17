// Sample data shared by the tdr-bot pages. Not a page, so the builder never
// loads it on its own; the page data files import what they need. Names, ids and
// costs are invented; the model ids, nav links and emoji names are the app's.

export const navLinks = [
  'Settings',
  'Transcript',
  'Reminders',
  'Emojis',
  'Playground',
]

// The custom-emoji dictionary the bot knows. The image is Discord's CDN, which
// is where the real app loads it from. `fallback` marks an id that isn't a live
// emoji any more, so the mockup draws the pepe mark instead of a broken image.
const cdn = (id, animated) =>
  `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}`

export const dict = {
  HYPERS: { id: '564310072822333480', animated: false },
  residentsleeper: { id: '564330871851712553', animated: false },
  peepoWine: { id: '1266528661318926369', animated: true },
  Loading: { id: '1275667821757464687', animated: true, fallback: true },
}

export const emojiUrl = e => cdn(e.id, e.animated)

// Chat, reasoning and image models, with the per-1M pricing the select shows.
// `temp` marks a chat model that accepts temperature; the others take a
// reasoning effort instead.
export const models = {
  chat: [
    {
      id: 'gpt-4.1',
      desc: 'Flagship non-reasoning model. Fast, strong tool use.',
      inp: 2.0,
      out: 8.0,
      temp: true,
    },
    {
      id: 'gpt-4.1-mini',
      desc: 'Cheaper everyday chat. Good default.',
      inp: 0.4,
      out: 1.6,
      temp: true,
    },
    {
      id: 'gpt-5-mini',
      desc: 'Reasoning model. Slower, better on hard questions.',
      inp: 0.25,
      out: 2.0,
      temp: false,
    },
  ],
  reasoning: [
    {
      id: 'gpt-5',
      desc: 'Best reasoning, used for math and planning.',
      inp: 1.25,
      out: 10.0,
    },
    {
      id: 'gpt-5-mini',
      desc: 'Light reasoning at a low price.',
      inp: 0.25,
      out: 2.0,
    },
    {
      id: 'o4-mini',
      desc: 'Compact o-series reasoning model.',
      inp: 1.1,
      out: 4.4,
    },
  ],
  image: [
    {
      id: 'gpt-image-1',
      desc: 'Image generation and edits.',
      inp: 5.0,
      out: 40.0,
    },
    { id: 'dall-e-3', desc: 'Legacy image generation.', inp: 0, out: 0 },
  ],
}

export const savedPrompt =
  'You are tdr-bot, a helpful assistant in a private Discord server. Keep replies short and friendly. Use tools when they help; never invent links.'
