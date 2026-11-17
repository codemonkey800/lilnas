// Copy for index.pug: the list of screens.

export const pages = [
  {
    href: 'settings.html',
    icon: 'layers',
    title: 'Settings',
    desc: 'Models, generation and the system prompt: unsaved, saving, saved, a rejected field, the reasoning-model variant and the reset confirm.',
  },
  {
    href: 'transcript.html',
    icon: 'list',
    title: 'Transcript',
    desc: 'Channel conversations with each reply’s LLM calls and cost. Custom emojis inline, loading, empty and error.',
  },
  {
    href: 'reminders.html',
    icon: 'clock',
    title: 'Reminders',
    desc: 'Every reminder the bot holds: filter, create, edit, test-send and cancel.',
  },
  {
    href: 'emojis.html',
    icon: 'grid',
    title: 'Emojis',
    desc: 'The custom-emoji dictionary: search, edit descriptions, re-describe and reconcile.',
  },
  {
    href: 'playground.html',
    icon: 'terminal',
    title: 'Playground',
    desc: 'Chat with the bot’s model outside Discord to check it uses the dictionary, and run the emoji eval.',
  },
]
