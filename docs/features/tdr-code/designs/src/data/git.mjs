// Copy and sample data for git.pug. Three panels: link GitHub (so the bot
// can push and open PRs as you), an SSH identity (non-GitHub remotes and
// commit signing) and the roster (every Discord member's state, clearable).

export const chip = {
  linked: { tone: 'ok', label: 'Linked' },
  configured: { tone: 'ok', label: 'Configured' },
  'not-linked': { tone: 'mute', label: 'Not linked' },
  'not-configured': { tone: 'mute', label: 'Not configured' },
  'decrypt-failed': { tone: 'bad', label: 'Decrypt failed' },
}

export const github = {
  title: 'GitHub',
  body: 'Connect your account so tdr-code can push commits, open pull requests and create repositories as you. Your GitHub name and email become your commit identity.',
  linkedAs: 'Jeremy Asuncion',
  linkedEmail: '1042881+jeremy@users.noreply.github.com',
  failed:
    "Your linked token can't be decrypted, so gh and pushes are blocked. Relink GitHub to fix it.",
  linkHint:
    'Lets tdr-code open PRs, create repos and push as your GitHub account',
  unlinkError: {
    lead: "Couldn't unlink GitHub.",
    detail: "The server didn't answer. You're still linked.",
    code: 'DELETE /api/github 502',
  },
}

export const ssh = {
  title: 'SSH key',
  body: 'For pushing to non-GitHub remotes over SSH, such as a self-hosted Git server. It also signs your commits. Name and email are used for commit identity only when GitHub is not linked.',
  identity: {
    name: 'Jeremy Asuncion',
    email: 'jeremy@lilnas.io',
    fingerprint: 'SHA256:q3Zp0m1vXk8e2nBd9WfLr7aTcYh5uJsGo4iNxE6bVwA',
  },
  githubNote: {
    lead: 'Name and email come from your linked GitHub account.',
    detail:
      "Commits use GitHub's noreply address, which GitHub resolves to your real email in commit attribution.",
  },
  keyLabel: 'SSH private key',
  keyHint: "Write-only. It isn't shown again after you save.",
  keyPlaceholder: '-----BEGIN OPENSSH PRIVATE KEY-----\n…',
  failed:
    "The key can't be decrypted, so pushes are blocked. Upload a key again to restore access.",
  clearPrompt: 'Remove your SSH key?',
  saveError: {
    lead: "Couldn't save the key.",
    detail: "The server didn't answer. Nothing was changed.",
    code: 'PUT /api/git/identity 502',
  },
}

export const roster = {
  title: 'Roster',
  caption: 'Every member of the Discord server',
  empty: {
    title: 'No guild members found',
    body: 'Members of the Discord server show up here.',
  },
}

const people = [
  ['Jeremy', 'linked', 'configured'],
  ['Sam', 'linked', 'not-configured'],
  ['Alex', 'not-linked', 'configured'],
  ['Riley', 'decrypt-failed', 'decrypt-failed'],
  ['Morgan', 'not-linked', 'not-configured'],
]

export function rosterRows(patch = {}) {
  return people.map(([name, gh, key], i) => ({
    name,
    github: { status: gh, ...(patch[i] && patch[i].github) },
    ssh: { status: key, ...(patch[i] && patch[i].ssh) },
  }))
}

export const rosterColumns = [
  { key: 'name', label: 'Discord user', title: true },
  {
    key: 'github',
    label: 'GitHub',
    type: 'render',
    render: 'rosterGithub',
    wide: true,
  },
  { key: 'ssh', label: 'SSH', type: 'render', render: 'rosterSsh', wide: true },
]

const common = {
  loading: what => `Fetching ${what}…`,
}

export const copy = {
  loading: {
    github: common.loading('GitHub status'),
    ssh: common.loading('your SSH identity'),
    roster: common.loading('the roster'),
  },
  error: {
    github: {
      lead: "Couldn't load GitHub status.",
      detail: "The server didn't answer. Try again in a minute.",
      code: 'GET /api/github/status 502',
    },
    ssh: {
      lead: "Couldn't load your SSH identity.",
      detail: "The server didn't answer. Try again in a minute.",
      code: 'GET /api/git/identity 502',
    },
    roster: {
      lead: "Couldn't load the roster.",
      detail: "The server didn't answer. Try again in a minute.",
      code: 'GET /api/git/roster 502',
    },
  },
}

export const githubStates = [
  {
    label: 'Not linked',
    caption: 'Link GitHub is the one action',
    status: 'not-linked',
  },
  { label: 'Linked', caption: 'who it is, and Unlink', status: 'linked' },
  {
    label: 'Decrypt failed',
    caption: 'the stored token is unreadable: Relink GitHub',
    status: 'decrypt-failed',
  },
  {
    label: 'Unlinking',
    caption: 'the button disables and relabels',
    status: 'linked',
    unlinking: true,
  },
  {
    label: 'Unlink failed',
    caption: 'still linked, with the reason',
    status: 'linked',
    unlinkError: true,
  },
  {
    label: 'Session pending',
    caption: 'Link GitHub disabled until the session resolves',
    status: 'not-linked',
    pending: true,
  },
  { label: 'Loading', caption: 'first fetch', body: 'loading' },
  { label: 'Error', caption: "the status didn't load", body: 'error' },
]

export const sshStates = [
  {
    label: 'Not configured',
    caption: 'name and email are yours to fill in',
    status: 'not-configured',
  },
  {
    label: 'Configured',
    caption: 'identity line with the fingerprint; Replace key and Clear',
    status: 'configured',
  },
  {
    label: 'GitHub linked',
    caption: 'name and email come from GitHub and are read-only',
    status: 'configured',
    githubLinked: true,
  },
  {
    label: 'Clear',
    caption: 'inline confirm',
    status: 'configured',
    confirmClear: true,
  },
  {
    label: 'Decrypt failed',
    caption: 'pushes are blocked until a key is uploaded',
    status: 'decrypt-failed',
  },
  {
    label: 'Saving',
    caption: 'Replace key disabled while it uploads',
    status: 'configured',
    saving: true,
  },
  {
    label: 'Saved',
    caption: 'the key field empties',
    status: 'configured',
    saved: true,
  },
  {
    label: 'Save failed',
    caption: 'the reason, and nothing changed',
    status: 'configured',
    saveError: true,
  },
  {
    label: 'No Discord identity yet',
    caption: 'form disabled until the status resolves',
    status: 'not-configured',
    disabled: true,
  },
  { label: 'Loading', caption: 'first fetch', body: 'loading' },
  { label: 'Error', caption: "the identity didn't load", body: 'error' },
]

export const rosterStates = [
  { label: 'Default', caption: 'five members, each state', rows: rosterRows() },
  {
    label: 'Clear GitHub',
    caption: 'inline confirm names the person and what goes',
    rows: rosterRows({ 1: { github: { clear: 'confirm' } } }),
  },
  {
    label: 'Clear SSH',
    caption: 'inline confirm on the key',
    rows: rosterRows({ 0: { ssh: { clear: 'confirm' } } }),
  },
  {
    label: 'Clearing',
    caption: 'the row is working; every other Clear is disabled',
    rows: rosterRows({ 3: { ssh: { clear: 'pending' } } }),
    others: true,
  },
  { label: 'Empty', caption: 'nobody in the roster', rows: [], body: 'empty' },
  { label: 'Loading', caption: 'first fetch', body: 'loading' },
  { label: 'Error', caption: "the roster didn't load", body: 'error' },
]
