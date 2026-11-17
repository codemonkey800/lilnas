// Copy and sample data for browser.pug. One entry per state of BrowserControl:
// `missing` / `stopped` / `starting` / `running` come from getBrowserStatus();
// `working` is the transition while a server action is pending (the status is
// still the old one); `error` is a failed action.

export const idleTimeout = '30m'
export const maxUptime = '4h'

export const failure = {
  lead: "Couldn't turn it on.",
  detail: "Docker didn't answer. Try again in a minute.",
  code: 'ENOENT /var/run/docker.sock',
}

export const missing = {
  hint: "The browser container doesn't exist yet. Create it once on the server:",
  command: 'docker compose up -d browser',
}

export const states = [
  {
    key: 'missing',
    label: 'Not installed',
    caption: 'No container yet: no action, just the one-time command',
    status: { tone: 'bad', word: 'Not installed' },
    missing: true,
  },
  {
    key: 'stopped',
    label: 'Stopped',
    caption: 'Off. Turn on is the one accent button',
    status: { tone: 'idle', word: 'Stopped' },
    action: { label: 'Turn on', variant: 'accent' },
  },
  {
    key: 'working',
    label: 'Working',
    caption:
      'Turn on pressed, waiting on Docker. The button loads; the status has not moved yet',
    status: { tone: 'idle', word: 'Stopped' },
    action: { label: 'Turning on', variant: 'accent', loading: true },
  },
  {
    key: 'starting',
    label: 'Starting',
    caption: 'Container is up, the browser is not answering yet',
    status: { tone: 'warn', word: 'Starting…' },
    progress: 'Waiting for the browser to answer. Usually under a minute.',
    action: { label: 'Turn off', variant: 'outline' },
  },
  {
    key: 'running',
    label: 'Running',
    caption:
      'Open browser is the accent button; the countdown comes from autoStopAt',
    status: {
      tone: 'ok',
      pulse: true,
      word: 'Running',
      detail: 'stops in 12m',
    },
    open: true,
    action: { label: 'Turn off', variant: 'outline' },
  },
  {
    key: 'error',
    label: 'Error',
    caption: 'An action failed; the status stays what it was',
    status: { tone: 'idle', word: 'Stopped' },
    action: { label: 'Turn on', variant: 'accent' },
    error: true,
  },
]
