import { services, you } from './shared.mjs'

export const identity = you
export const target = services.radarr

export const states = [
  {
    id: 'waiting',
    label: 'Waiting',
    kind: 'waiting',
    heading: 'Waiting for approval',
    body: 'You’re in the queue. You’ll be sent on as soon as Jeremy approves it.',
    requested: 'Requested 4 minutes ago',
    note: {
      tone: 'accent',
      lead: 'This page updates on its own.',
      body: 'No need to keep refreshing — you’ll be sent to radarr.lilnas.io the moment you’re approved.',
    },
    primary: { label: 'Check again', icon: 'refresh' },
  },
  {
    id: 'checking',
    label: 'Checking',
    kind: 'waiting',
    heading: 'Waiting for approval',
    body: 'You’re in the queue. You’ll be sent on as soon as Jeremy approves it.',
    requested: 'Requested 4 minutes ago',
    note: {
      tone: 'accent',
      lead: 'This page updates on its own.',
      body: 'No need to keep refreshing — you’ll be sent to radarr.lilnas.io the moment you’re approved.',
    },
    primary: { label: 'Check again', icon: 'refresh', spin: true },
  },
  {
    id: 'declined',
    label: 'Declined',
    kind: 'declined',
    heading: 'Access declined',
    body: 'Jeremy declined your request for radarr.lilnas.io. You can ask again.',
    note: {
      tone: 'accent',
      lead: 'Asking again notifies an admin.',
      body: 'You’ll be sent to radarr.lilnas.io the moment you’re approved.',
    },
    primary: { label: 'Request access again', accent: true },
  },
]
