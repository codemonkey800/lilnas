import { services } from './shared.mjs'

export const states = [
  {
    id: 'no-target',
    label: 'No target',
    heading: 'Sign in to lilnas.io',
  },
  {
    id: 'target',
    label: 'With a target',
    heading: 'Sign in to continue',
    target: services.radarr,
  },
  {
    id: 'error',
    label: 'Sign-in failed',
    heading: 'Sign in to lilnas.io',
    error: {
      lead: 'Google didn’t sign you in.',
      body: 'It sent back an error. Try again.',
      code: 'access_denied',
    },
  },
  {
    id: 'redirecting',
    label: 'Redirecting',
    heading: 'Sign in to continue',
    target: services.radarr,
    redirecting: true,
    toast: 'Redirecting…',
  },
]

export const copy = {
  button: 'Continue with Google',
  buttonBusy: 'Redirecting…',
}
