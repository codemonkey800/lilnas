// Copy and sample data for admin.pug: the read-only backups table. Sample
// values only; every address is on example.com or example.invalid.

export const copy = {
  title: 'Backups',
  lede: 'Everyone who has signed in. This page is read-only.',
  links: [{ label: 'My backup' }, { label: 'Backups', active: true }],
  empty: {
    title: 'No backups yet',
    body: 'When someone signs in, their backup shows up here.',
    action: 'Go to my backup',
  },
  loading: 'Fetching backups…',
  error: {
    lead: "Couldn't load the backups.",
    detail: 'The backend may be restarting. Try again in a minute.',
    code: 'GET /api/admin/backups 502',
    action: 'Try again',
  },
}

export const cols = [
  { key: 'person', label: 'Person' },
  { key: 'appleId', label: 'Apple ID', mono: true },
  { key: 'state', label: 'State', type: 'badge' },
  { key: 'last', label: 'Last backup' },
  { key: 'items', label: 'Items', align: 'right' },
  { key: 'size', label: 'Size on disk', align: 'right' },
  { key: 'immich', label: 'Immich account', type: 'badge' },
]

const linked = { tone: 'ok', label: 'Linked' }
const none = { tone: 'mute', label: 'None' }

export const rows = [
  {
    person: 'sam@example.com',
    appleId: 'sam@example.invalid',
    state: { tone: 'ok', label: 'Up to date' },
    last: '2h ago',
    items: '18,532',
    size: '142 GB',
    immich: linked,
  },
  {
    person: 'maya@example.com',
    appleId: 'maya@example.invalid',
    state: { tone: 'accent', label: 'Downloading', live: true },
    last: '—',
    items: '1,204',
    size: '12.4 GB',
    immich: none,
  },
  {
    person: 'lee@example.com',
    appleId: 'lee@example.invalid',
    state: { tone: 'warn', label: 'Queued' },
    last: '—',
    items: '0',
    size: '0 GB',
    immich: none,
  },
  {
    person: 'alex@example.com',
    appleId: 'alex@example.invalid',
    state: { tone: 'warn', label: 'Needs sign-in' },
    last: '9d ago',
    items: '6,310',
    size: '58 GB',
    immich: linked,
  },
  {
    person: 'jo@example.com',
    appleId: 'jo@example.invalid',
    state: { tone: 'warn', label: 'Paused' },
    last: '1d ago',
    items: '2,087',
    size: '19 GB',
    immich: linked,
  },
  {
    person: 'kai@example.com',
    appleId: 'kai@example.invalid',
    state: { tone: 'bad', label: 'Failed' },
    last: '3d ago',
    items: '412',
    size: '3.1 GB',
    immich: none,
  },
]

// Frames on the page, in order. `top` is the table state.
export const frames = [
  {
    key: 'rows',
    label: 'Rows',
    caption: 'Six people, one badge for each state',
    top: 'rows',
  },
  {
    key: 'empty',
    label: 'Table · Empty',
    caption: 'Nobody has signed in yet. One thing to press',
    top: 'empty',
  },
  {
    key: 'loading',
    label: 'Table · Loading',
    caption: 'Skeleton rows in the shape of the table',
    top: 'loading',
  },
  {
    key: 'error',
    label: 'Table · Error',
    caption: 'A note with the machine string in mono, and Try again',
    top: 'error',
  },
]
