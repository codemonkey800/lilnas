import { peopleCols, people as adminPeople, serviceList } from './admin.mjs'
import { services as s } from './shared.mjs'

// Copy and sample data for invited.pug: how the admin dashboard shows people
// who were added with "Add a person" and haven't signed in yet. Invented
// people and the real services (shared.mjs); the existing admin rows come from
// admin.mjs so the two pages draw the same table.

export { peopleCols, serviceList }

const edit = { label: 'Edit access', variant: 'outline' }

// An invited row: the email only (no name is known before sign-in), an
// "Invited" badge, the pending services as the same badges a granted person
// gets, one action and no Block. `invited` tells the Discord cell to draw a
// dash instead of "Not linked".
//
// The tone is `accent`: of the five tones Badge has, ok says "has access",
// warn says "needs you" (it is the Pending tile's colour) and mute is "No
// access" and the service badges, so accent is the one left that reads as
// "in progress". It shares a hue with Admin, but the label and the missing
// Discord chip tell them apart.
const invitedBadge = { tone: 'accent', label: 'Invited' }

export const erlyne = {
  person: { email: 'erlyne@example.com', note: 'Invited Nov 23' },
  status: invitedBadge,
  services: [s.emby.name, s.immich.name],
  discord: null,
  invited: true,
  actions: [edit],
}

export const tomas = {
  person: { email: 'tomas.vega@example.com', note: 'Invited Nov 19' },
  status: invitedBadge,
  services: [
    s.files.name,
    s.radarr.name,
    s.sonarr.name,
    s.emby.name,
    s.immich.name,
    s.download.name,
    { rule: '*.dev.lilnas.io' },
  ],
  discord: null,
  invited: true,
  actions: [edit],
}

const [admin, jane, , priya] = adminPeople

// Admin, Granted, No access, then the two invited, as the brief orders them.
export const existing = [admin, jane, priya]
export const invitedPeople = [erlyne, tomas]
export const people = [...existing, ...invitedPeople]

// Default counts: People includes invited people, Granted does not. Pending
// is the request queue, empty here to keep the frames on People.
export const stats = [
  { value: people.length, label: 'People' },
  { value: 2, label: 'Granted' },
  { value: 0, label: 'Pending' },
]

// Edit access for erlyne: Emby and Immich pending, no rules.
export const editInvite = {
  email: erlyne.person.email,
  invitedLine: 'Invited Nov 23 · hasn’t signed in yet',
  services: [s.emby.host, s.immich.host],
  rules: [],
}

export const dialogData = { serviceList }

export const cancelInvite = {
  title: 'Cancel erlyne@example.com’s invite?',
  body: 'They won’t get these 2 services when they sign in. You can add them again any time.',
  confirm: 'Cancel invite',
  cancel: 'Keep invite',
}

// Frame 05: Add person with the email filled in and nothing picked.
export const addNone = {
  email: 'erlyne@example.com',
  serviceError: 'Pick at least one service or rule.',
}

export const toasts = [
  { tone: 'ok', title: 'Invited erlyne@example.com' },
  { tone: 'ok', title: 'Access granted to jane.doe@example.com' },
  { tone: 'ok', title: 'Invite updated' },
  { tone: 'ok', title: 'Invite cancelled' },
  {
    tone: 'warn',
    title: 'erlyne@example.com has signed in.',
    detail: 'Edit their access from their row.',
  },
]

// One entry per Nexus review frame, in order. `key` is the anchor id.
export const frames = [
  {
    key: 'list',
    label: 'People with invited rows',
    caption:
      'Invited people are rows in People, under the same columns. An invited row shows the email only (no name is known before sign-in), an Invited badge, the services waiting for them as the same grey badges a granted person has, “Invited Nov 23” under the email, a dash where the Discord chip would be, and one action, Edit access. There is no Block: they have no session to cut off. The badge is accent, the one tone left that reads as “in progress” (ok means has access, warn is the Pending tile’s “needs you”, mute is No access). People counts invited people (5); Granted does not (2).',
  },
  {
    key: 'search',
    label: 'Search matches an invited person',
    caption:
      'Search matches the email of invited rows as it does everyone else’s. “erlyne” leaves that one row and the section count reads 1.',
  },
  {
    key: 'edit',
    label: 'Edit access for an invited person',
    caption:
      'The email, a line saying when they were invited and that they haven’t signed in, their pending services checked, and the access rules. No Discord field, no Sign out everywhere, no Remove access. Cancel invite sits where Remove access sits for a normal person. The dialog now holds both “Cancel” and “Cancel invite”, which sit one scroll apart and read alike. Proposal: name the destructive one “Remove invite” (it mirrors “Remove access”), with “Keep invite” in its confirm and “Invite removed” as the toast; the footer keeps “Cancel”.',
  },
  {
    key: 'cancel-confirm',
    label: 'Cancel invite · confirm',
    caption:
      'The destructive confirm names the person and what they lose: the filled red button confirms, “Keep invite” backs out. Nothing is saved from the Edit access dialog behind it. If the copy changes to “Remove invite” in frame 03, this title, the button and the toast change with it.',
  },
  {
    key: 'add-none',
    label: 'Add person · nothing selected',
    caption:
      'Add person with an email and no service or rule: the error sits under the service grid and the dialog stays open. A rule alone is enough, so the message names both.',
  },
  {
    key: 'toasts',
    label: 'Toasts',
    caption:
      'One of each: invited (the email had no account), access granted (it had one, so there is nothing to wait for), invite updated, invite cancelled, and the warning when the person signed in before the change was saved. The warning is the only one that means nothing was changed; it points at their row, which is now a normal person.',
  },
]
