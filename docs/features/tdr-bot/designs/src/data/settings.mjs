// Copy and sample data for settings.pug. The models and the saved prompt are
// shared (shared.mjs); each state below is the same form with a few fields
// changed from `base`.

import { savedPrompt } from './shared.mjs'

export { models, navLinks } from './shared.mjs'

const base = {
  chat: 'gpt-4.1-mini',
  reasoning: 'gpt-5',
  image: 'gpt-image-1',
  temperature: 0.7,
  prompt: savedPrompt,
  status: 'clean',
  savedAt: '22 Oct 2026, 21:14',
}

const edited = `${savedPrompt} Answer in the language the user wrote in.`

export const states = {
  clean: base,
  open: { ...base, open: true },
  dirty: {
    ...base,
    chat: 'gpt-4.1',
    temperature: 1.1,
    prompt: edited,
    status: 'dirty',
  },
  saving: {
    ...base,
    chat: 'gpt-4.1',
    temperature: 1.1,
    prompt: edited,
    status: 'saving',
  },
  saved: {
    ...base,
    chat: 'gpt-4.1',
    temperature: 1.1,
    prompt: edited,
    status: 'saved',
    savedAt: '24 Oct 2026, 09:41',
  },
  errorModel: { ...base, status: 'error', errorModel: 'gpt-4.5-turbo' },
  errorPrompt: {
    ...base,
    status: 'error',
    prompt: edited,
    promptLength: 20312,
    errorPrompt: 'The prompt is 312 characters over the 20000 limit.',
  },
  reasoning: {
    ...base,
    chat: 'gpt-5-mini',
    effort: 'medium',
    status: 'dirty',
  },
}

// Radio groups need a name that's unique on the page; the state's key is it.
for (const [key, state] of Object.entries(states)) state.key = key

export const copy = {
  title: 'Settings',
  lede: 'Runtime LLM configuration.',
  reset: {
    title: 'Reset settings to the defaults?',
    body: 'The default models, temperature and system prompt replace yours. Your current ones are lost.',
    confirm: 'Reset settings',
    cancel: 'Keep my settings',
  },
  loadError: {
    lead: 'Couldn’t load settings.',
    body: 'The API didn’t answer. Reload the page to try again.',
  },
}

export const toasts = [
  { tone: 'ok', title: 'Settings saved' },
  { tone: 'ok', title: 'Settings reset to the defaults' },
]

export const jump = [
  ['Saved', 'default'],
  ['Select open', 'open'],
  ['Unsaved', 'dirty'],
  ['Saving', 'saving'],
  ['Saved now', 'saved'],
  ['Rejected model', 'error-model'],
  ['Prompt too long', 'error-prompt'],
  ['Reasoning model', 'reasoning'],
  ['Reset', 'reset'],
  ['Loading', 'loading'],
  ['Load error', 'load-error'],
  ['Phone menu', 'nav'],
]
