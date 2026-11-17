import { services } from './shared.mjs'

const s = services

// ── People ───────────────────────────────────────────────────────────────
// One column definition drives the table (1280) and the card list (390).
// `type` picks the cell: person, badge, services, discord, actions.
export const peopleCols = [
  { key: 'person', label: 'Person', type: 'person' },
  { key: 'status', label: 'Status', type: 'badge' },
  { key: 'services', label: 'Access', type: 'services' },
  { key: 'discord', label: 'Discord', type: 'discord' },
  { key: 'actions', label: 'Actions', type: 'actions' },
]

const edit = { label: 'Edit access', variant: 'outline' }
const block = { label: 'Block', variant: 'bad' }

export const people = [
  {
    person: { name: 'Jeremy Asuncion', email: 'jeremy@example.com' },
    status: { tone: 'accent', label: 'Admin' },
    services: [
      s.files.name,
      s.radarr.name,
      s.emby.name,
      { rule: '*.dev.lilnas.io' },
    ],
    discord: 'jeremy',
    actions: [block],
  },
  {
    person: { name: 'Jane Doe', email: 'jane.doe@example.com' },
    status: { tone: 'ok', label: 'Granted' },
    services: [s.radarr.name, s.sonarr.name, s.emby.name],
    discord: 'janedoe',
    actions: [edit, block],
  },
  {
    person: { name: 'Sam Rivera', email: 'sam.rivera@example.com' },
    status: { tone: 'ok', label: 'Granted' },
    services: [
      s.files.name,
      s.immich.name,
      s.emby.name,
      s.download.name,
      s.sabnzbd.name,
      s.grafana.name,
    ],
    discord: null,
    actions: [edit, block],
  },
  {
    person: { name: 'Priya Nair', email: 'priya.nair@example.com' },
    status: { tone: 'mute', label: 'No access' },
    services: [],
    discord: null,
    actions: [edit, block],
  },
]

export const blocked = [
  {
    person: { name: 'Marcus Lee', email: 'marcus.lee@example.com' },
    status: { tone: 'bad', label: 'Blocked' },
    services: [s.radarr.name],
    discord: null,
    actions: [
      { label: 'Unblock', variant: 'ghost' },
      { label: 'Edit access', variant: 'outline' },
    ],
  },
]

// ── Pending requests ─────────────────────────────────────────────────────
export const requests = [
  {
    email: 'priya.nair@example.com',
    initials: 'PN',
    host: s.radarr.host,
    ago: '4m ago',
  },
  {
    email: 'dana.ortiz@example.com',
    initials: 'DO',
    host: s.emby.host,
    ago: '22m ago',
    prior: 'declined 1x before',
  },
  {
    email: 'leo.park@example.com',
    initials: 'LP',
    host: s.files.host,
    ago: '3h ago',
  },
]

// Pending is flagged `warn` whenever it is above zero.
export const stats = [
  { value: 5, label: 'People' },
  { value: 4, label: 'Granted' },
  { value: 3, label: 'Pending' },
]
export const statsQuiet = [
  { value: 5, label: 'People' },
  { value: 4, label: 'Granted' },
  { value: 0, label: 'Pending' },
]

// ── Discord links ────────────────────────────────────────────────────────
export const discordPeople = [
  { name: 'Sam Rivera', email: 'sam.rivera@example.com' },
  { name: 'Priya Nair', email: 'priya.nair@example.com' },
  { name: 'Dana Ortiz', email: 'dana.ortiz@example.com' },
]
export const discordAccounts = [
  { username: 'samr', displayName: 'Sam R.', seen: '2m ago' },
  { username: 'priya_n', displayName: 'Priya', seen: '1h ago' },
  { username: 'dana.o', displayName: null, seen: '2d ago' },
]
export const linksCols = [
  { key: 'person', label: 'Person', type: 'person' },
  { key: 'discord', label: 'Discord', type: 'discord' },
  { key: 'linked', label: 'Linked', type: 'text' },
  { key: 'actions', label: 'Actions', type: 'actions' },
]
export const links = [
  {
    person: { name: 'Jeremy Asuncion', email: 'jeremy@example.com' },
    discord: 'jeremy',
    linked: 'Mar 14, 2026',
    actions: [{ label: 'Unlink', variant: 'bad' }],
  },
  {
    person: { name: 'Jane Doe', email: 'jane.doe@example.com' },
    discord: 'janedoe',
    linked: 'Apr 2, 2026',
    actions: [{ label: 'Unlink', variant: 'bad' }],
  },
]

// ── Dialogs ──────────────────────────────────────────────────────────────
export const serviceList = [
  s.files,
  s.radarr,
  s.sonarr,
  s.sabnzbd,
  s.emby,
  s.immich,
  s.grafana,
  s.download,
  s.dev,
  s.tdrCode,
]

export const confirms = {
  block: {
    title: 'Block Jane Doe?',
    body: 'They lose every service until you unblock them.',
    confirm: 'Block',
    cancel: 'Keep access',
  },
  blockAdmin: {
    title: 'Block Jeremy Asuncion?',
    body: 'They lose every service until you unblock them. They keep this dashboard, because they’re an admin.',
    confirm: 'Block',
    cancel: 'Keep access',
  },
  remove: {
    title: 'Remove Jane Doe’s access?',
    body: 'They lose all 3 services. They can ask again from the sign-in page.',
    confirm: 'Remove access',
    cancel: 'Keep access',
  },
  signOut: {
    title: 'Sign Jane Doe out everywhere?',
    body: 'Their sessions end now. They can sign straight back in — this doesn’t change what they can open.',
    confirm: 'Sign out',
    cancel: 'Keep signed in',
  },
  unlink: {
    title: 'Unlink Jane Doe from @janedoe?',
    body: 'Their Discord downloads stop being attributed to them until you link them again.',
    confirm: 'Unlink',
    cancel: 'Keep link',
  },
}

export const toasts = [
  { tone: 'ok', title: 'Approved priya.nair@example.com' },
  { tone: 'ok', title: 'Declined dana.ortiz@example.com' },
  { tone: 'ok', title: 'Dismissed 2 requests' },
  { tone: 'ok', title: 'Blocked Jane Doe' },
  { tone: 'ok', title: 'Unblocked Marcus Lee' },
  { tone: 'ok', title: 'Added sam.rivera@example.com' },
  { tone: 'ok', title: 'Access saved' },
  { tone: 'ok', title: 'Removed Jane Doe’s access' },
  { tone: 'ok', title: 'Signed Jane Doe out of 2 sessions' },
  { tone: 'ok', title: 'Linked sam.rivera@example.com ↔ @samr' },
  { tone: 'ok', title: 'Unlinked @janedoe' },
]

export const errorBoundary = {
  heading: 'Couldn’t load access control',
  lead: 'The auth service didn’t answer.',
  body: 'It may be restarting — try again in a minute.',
  code: 'ECONNREFUSED localhost:8081',
  action: 'Try again',
}

export const actionError = {
  lead: 'Couldn’t block Jane Doe.',
  body: 'The auth service didn’t answer. Nothing changed — try again.',
}

export const jump = [
  ['Default', 'default'],
  ['Nothing pending', 'quiet'],
  ['Selected', 'selected'],
  ['Filtered', 'filtered'],
  ['Failed', 'failed'],
  ['Discord empty', 'discord-empty'],
  ['Blocked empty', 'blocked-empty'],
  ['Add person', 'add'],
  ['Bad email', 'add-error'],
  ['Edit access', 'edit'],
  ['Block confirm', 'block'],
  ['Other confirms', 'confirms'],
  ['Error', 'error'],
  ['Toasts', 'toasts'],
]

// Bundles the mixins take as one argument.
export const blockedCols = peopleCols.filter(c => c.key !== 'discord')
export const discordData = {
  people: discordPeople,
  accounts: discordAccounts,
  links,
  linksCols,
}
export const dialogData = { serviceList }
