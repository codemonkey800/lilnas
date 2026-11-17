// Copy and sample data for reminders.pug. Reminders, people and dates are
// invented (the page is drawn as of Sat 24 Oct 2026); the columns, statuses
// and dialog fields are the app's.

export { navLinks } from './shared.mjs'

export const reminderCounts = {
  active: 5,
  completed: 2,
  cancelled: 2,
  missed: 1,
  all: 10,
}

export const rows = [
  {
    what: 'Stand-up notes in #dev',
    status: 'active',
    who: 'jeremy',
    type: 'text',
    channel: '#dev',
    human: 'every weekday at 9:00 AM',
    cron: '0 9 * * 1-5',
    next: { rel: 'in 1 d', at: 'Mon Oct 26, 9:00 AM' },
    last: 'Fri Oct 23, 9:00 AM',
    runs: 48,
  },
  {
    what: 'Take out the trash',
    status: 'active',
    who: 'jeremy → @sam',
    type: 'text',
    channel: 'default',
    human: 'every Tuesday at 10:00 AM',
    cron: '0 10 * * 2',
    next: { rel: 'in 3 d', at: 'Tue Oct 27, 10:00 AM' },
    last: 'Tue Oct 20, 10:00 AM',
    runs: 12,
  },
  {
    what: 'Check the weather in Lisbon',
    status: 'active',
    who: 'mika',
    type: 'search',
    channel: '#general',
    human: 'every day at 7:30 AM',
    cron: '30 7 * * *',
    ends: 'Oct 31, 2026',
    next: { rel: 'in 21 h', at: 'Sun Oct 25, 7:30 AM' },
    last: 'Sat Oct 24, 7:30 AM',
    runs: 31,
  },
  {
    what: 'Pay rent',
    status: 'active',
    who: 'admin',
    type: 'text',
    channel: 'default',
    human: 'once',
    next: { rel: 'in 8 d', at: 'Sun Nov 1, 8:00 AM' },
    runs: 0,
  },
  {
    what: 'What is 15% of the grocery total, $212.40?',
    status: 'active',
    who: 'sam',
    type: 'math',
    channel: '#general',
    human: 'once',
    next: { rel: 'in 38 min', at: 'Sat Oct 24, 4:30 PM' },
    runs: 0,
  },
  {
    what: 'Renew the domain',
    status: 'completed',
    who: 'jeremy',
    type: 'text',
    channel: 'default',
    human: 'once',
    last: 'Sat Oct 3, 9:00 AM',
    runs: 1,
  },
  {
    what: 'Weekly standings for the fantasy league',
    status: 'completed',
    who: 'sam → @jeremy',
    type: 'search',
    channel: '#general',
    human: 'every Monday at 9:00 AM',
    cron: '0 9 * * 1',
    ends: 'Sep 30, 2026',
    last: 'Mon Sep 28, 9:00 AM',
    runs: 8,
  },
  {
    what: 'Happy birthday, Mika!',
    status: 'missed',
    who: 'jeremy → @mika',
    type: 'text',
    channel: '#general',
    human: 'once',
    runs: 0,
  },
  {
    what: 'Drink water',
    status: 'cancelled',
    who: 'sam',
    type: 'text',
    channel: 'default',
    human: 'every hour',
    cron: '0 * * * *',
    last: 'Fri Oct 2, 3:00 PM',
    runs: 112,
  },
  {
    what: 'Square root of 1764',
    status: 'cancelled',
    who: 'mika',
    type: 'math',
    channel: '#dev',
    human: 'once',
    runs: 0,
  },
]

export const presets = [
  'Every day 9 AM',
  'Weekdays 9 AM',
  'Every Monday 9 AM',
  'Every hour',
  'Custom',
]

// The member combobox's open panel, filtered by "sa".
export const members = [
  {
    name: 'Members',
    dot: 'bg-accent',
    items: [
      { label: 'sam · Sam R.', highlighted: true },
      { label: 'sasha · Sasha K.' },
      { label: 'rosa · Rosa M.' },
    ],
  },
]

export const dialogs = {
  pick: {
    title: 'New reminder',
    save: 'Create reminder',
    forOpen: true,
    forValue: '',
    what: '',
    kind: 'One-time',
    at: 'Oct 27, 2026, 8:00 AM',
  },
  recurring: {
    title: 'New reminder',
    save: 'Create reminder',
    forValue: 'jeremy · Jeremy A.',
    what: 'Stand-up notes in #dev',
    kind: 'Recurring',
    preset: 'Weekdays 9 AM',
    cron: '0 9 * * 1-5',
    ends: 'Oct 31, 2026',
    next: ['Mon Oct 26, 9:00 AM', 'Tue Oct 27, 9:00 AM', 'Wed Oct 28, 9:00 AM'],
  },
  invalid: {
    title: 'New reminder',
    save: 'Create reminder',
    forValue: 'sam · Sam R.',
    what: 'Drink water',
    kind: 'Recurring',
    preset: 'Custom',
    cron: '0 9 * *',
    cronError:
      'That isn’t a cron expression. It needs 5 fields: minute, hour, day, month and weekday.',
  },
  edit: {
    title: 'Edit reminder',
    save: 'Save reminder',
    forValue: 'sam · Sam R.',
    remind: 'jeremy · Jeremy A.',
    what: 'Take out the trash',
    kind: 'Recurring',
    preset: 'Custom',
    cron: '0 10 * * 2',
    next: [
      'Tue Oct 27, 10:00 AM',
      'Tue Nov 3, 10:00 AM',
      'Tue Nov 10, 10:00 AM',
    ],
  },
}

export const copy = {
  cancel: {
    title: 'Cancel “Take out the trash”?',
    body: 'It repeats every Tuesday at 10:00 AM, and cancelling stops every future run.',
    confirm: 'Cancel reminder',
    cancel: 'Keep it',
  },
  test: {
    title: 'Send a test',
    reminder: 'Check the weather in Lisbon',
    lede: 'DMs @mika the message this reminder would send at the chosen time. Its schedule isn’t touched.',
    field: 'Send as if it were',
    value: '2026-10-26',
    hint: 'Future dates up to when it ends (2026-10-31).',
    sent: 'Sent to @mika’s DMs as of Mon Oct 26, 7:30 AM.',
    exhausted: 'This reminder has no future dates left to test.',
    confirm: 'Send test',
    cancel: 'Close',
  },
  empty: {
    title: 'No active reminders',
    body: 'Create one here, or ask tdr-bot in Discord.',
    action: 'New reminder',
  },
  filtered: {
    title: 'No matching reminders',
    body: 'Nothing matches “zed”. Check the spelling, or search by what it says.',
  },
  loadError: {
    lead: 'Couldn’t load reminders.',
    body: 'The API didn’t answer. Reload the page to try again.',
  },
}

export const jump = [
  ['Active', 'default'],
  ['All statuses', 'all'],
  ['Nothing active', 'empty'],
  ['Search finds nothing', 'filtered'],
  ['Loading', 'loading'],
  ['Load error', 'load-error'],
  ['New · member picker', 'pick'],
  ['New · recurring', 'recurring'],
  ['New · bad cron', 'invalid'],
  ['Edit', 'edit'],
  ['Cancel · confirm', 'cancel'],
  ['Send a test', 'test'],
]
