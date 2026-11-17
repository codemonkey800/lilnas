import { services, you } from './shared.mjs'

export const identity = you
export const target = services.radarr

export const copy = {
  heading: 'Access blocked',
  body: 'An admin blocked your account. If you think that’s a mistake, reach out to them directly.',
}

export const states = [
  { id: 'blocked', label: 'Blocked' },
  {
    id: 'still-blocked',
    label: 'Checked again',
    toast: { tone: 'bad', title: 'Still blocked' },
  },
]
