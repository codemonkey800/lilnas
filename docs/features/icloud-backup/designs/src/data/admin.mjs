// Copy and sample data for admin.pug: the read-only backups table, then the
// "Existing libraries" presets and the form that adds one. Sample values only;
// every address is on example.com or example.invalid.

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

export const libraries = {
  title: 'Existing libraries',
  lede: 'Link someone to a folder and Immich library that were set up before this app. Their first sync asks before it downloads anything.',
  cols: { email: 'Email', folder: 'Folder', library: 'Immich library' },
  remove: 'Remove',
  empty: {
    title: 'No existing libraries',
    body: "Add one below and it'll be linked the first time that person signs in.",
  },
  presets: [
    { email: 'sam@example.com', folder: 'sam', library: 'iCloud — Sam' },
    { email: 'maya@example.com', folder: 'maya', library: 'iCloud — Maya' },
  ],
}

export const form = {
  title: 'Add an existing library',
  email: {
    label: 'Email',
    hint: 'The email they sign in to lilnas with',
    placeholder: 'name@example.com',
    value: 'lee@example.com',
    error: 'Enter the email they sign in to lilnas with, like name@example.com',
    errorValue: 'lee',
  },
  folder: {
    label: 'Folder name',
    hint: '/storage/photos/icloud-users/<folder>',
    placeholder: 'lee',
    value: 'lee',
    error: 'Use letters, numbers and dashes only',
    errorValue: 'Lee Photos',
  },
  library: {
    label: 'Immich library',
    hint: 'Only external libraries that no one is linked to yet',
    placeholder: 'Choose a library',
    value: 'iCloud — Lee',
    error: 'Choose an Immich library',
    items: ['iCloud — Lee', 'Family videos', 'Old phone'],
  },
  action: 'Add library',
  taken: {
    lead: 'sam@example.com already has a library.',
    detail: 'Remove it first to link a different one.',
  },
}

// Frames on the page, in order. `top` is the table state; `libs` is what the
// libraries section shows; `formState` is the add form.
export const frames = [
  {
    key: 'rows',
    label: 'Rows',
    caption:
      'Six people, one badge for each state. The full page, libraries below',
    top: 'rows',
    libs: 'list',
    formState: 'empty',
    full: true,
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
  {
    key: 'libs-empty',
    label: 'Libraries · No presets',
    caption: 'The list is empty; the form is the way forward',
    libs: 'empty',
    formState: 'empty',
  },
  {
    key: 'form-errors',
    label: 'Form · Validation errors',
    caption: 'Each error replaces its hint, on the field it belongs to',
    libs: 'list',
    formState: 'errors',
  },
  {
    key: 'form-taken',
    label: 'Form · Already linked',
    caption:
      'A rule only the server can check, so it is a note above the button',
    libs: 'list',
    formState: 'taken',
  },
  {
    key: 'form-select',
    label: 'Form · Choosing a library',
    caption: 'The select open, with the first library highlighted',
    libs: 'list',
    formState: 'select',
  },
]
