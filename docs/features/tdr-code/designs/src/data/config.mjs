// Copy and sample data for config.pug. The global config applies to every
// session the bot starts; each field says how far a change reaches. Labels
// keep the app's own words; errors say what valid looks like (voice.md).

const prompt = `You are working in the lilnas monorepo on the user's behalf.
Prefer small commits and say what you changed in one line.
Never touch files under /storage without being asked.`

export const values = {
  cwd: '/home/jeremy/lilnas',
  claudeCommand: 'claude',
  claudeArgs: '["--model","opus","--permission-mode","acceptEdits"]',
  idleTimeoutSec: '900',
  maxConcurrentSessions: '4',
  customSystemPrompt: prompt,
  autoPostDiffs: true,
}

export const fields = {
  cwd: { label: 'Working directory (cwd)', effect: 'new sessions only' },
  claudeCommand: { label: 'Claude command', effect: 'new sessions only' },
  claudeArgs: {
    label: 'Claude args (JSON array)',
    effect: 'new sessions only',
  },
  idleTimeoutSec: {
    label: 'Idle timeout (seconds)',
    effect: 'next idle-timer reset',
  },
  maxConcurrentSessions: {
    label: 'Max concurrent sessions',
    effect: 'next create (no eviction)',
  },
  customSystemPrompt: {
    label: 'Custom system prompt',
    effect: 'new sessions only',
  },
  autoPostDiffs: {
    label: 'Auto-post tool diffs to Discord',
    effect: 'next tool call',
    check: 'Post a diff message after each completed Edit/Read tool call',
  },
}

export const copy = {
  max: 20000,
  offline: {
    lead: 'Bot is offline.',
    detail: 'Changes are saved now and apply at the next bot start.',
  },
  argsNotJson: 'That isn\'t JSON. Use an array of strings, like ["--flag"].',
  argsNotArray: 'Must be a JSON array of strings, like ["--flag"].',
  nearCap: {
    lead: 'Close to the limit.',
    detail: 'The prompt can be at most 20,000 characters.',
  },
  saveError: {
    lead: "Couldn't save the config.",
    detail: "The server didn't answer. Your changes are still in the form.",
    code: 'PUT /api/config 502',
  },
  loading: 'Fetching config…',
  error: {
    lead: "Couldn't load the config.",
    detail: "The server didn't answer. Try again in a minute.",
    code: 'GET /api/config 502',
  },
}

export const states = [
  { label: 'Default', caption: 'loaded, nothing changed', save: 'idle' },
  {
    label: 'Saving',
    caption: 'Save disabled while the request runs',
    save: 'saving',
  },
  {
    label: 'Saved',
    caption: 'the word shows for 2.5s',
    save: 'saved',
  },
  {
    label: 'Bot offline',
    caption: 'saves still work; the note says when they apply',
    save: 'idle',
    offline: true,
  },
  {
    label: 'Args, not JSON',
    caption: 'inline error on the textarea; nothing is sent',
    save: 'idle',
    argsError: copy.argsNotJson,
    args: '["--model", opus]',
  },
  {
    label: 'Args, not an array',
    caption: 'valid JSON but not a list of strings',
    save: 'idle',
    argsError: copy.argsNotArray,
    args: '{"model":"opus"}',
  },
  {
    label: 'Prompt near the limit',
    caption: 'the count turns amber from 90%; a note says the cap',
    save: 'idle',
    promptCount: 18450,
  },
  {
    label: 'Save failed',
    caption: 'the server rejected or never answered',
    save: 'error',
  },
  { label: 'Loading', caption: 'first fetch', body: 'loading' },
  { label: 'Error', caption: "the config didn't load", body: 'error' },
]
