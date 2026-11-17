import { services, you } from './shared.mjs'

const s = services

export const states = [
  {
    id: 'admin',
    label: 'Admin',
    status: { tone: 'accent', label: 'Admin' },
    admin: true,
    profile: {
      name: 'Jeremy Asuncion',
      email: 'jeremy@example.com',
      initials: 'JA',
      memberSince: 'Jan 2, 2026',
      signIn: 'Google',
    },
    role: 'Admin',
    tiles: [
      { icon: 'globe', name: 'All dev sites', host: '*.dev.lilnas.io' },
      s.files,
      s.radarr,
      s.sonarr,
      s.emby,
      s.download,
      s.dev,
    ],
  },
  {
    id: 'granted',
    label: 'Member · granted',
    status: { tone: 'ok', label: 'Granted' },
    role: 'Member',
    tiles: [s.radarr, s.sonarr, s.emby],
  },
  {
    id: 'pending',
    label: 'Pending',
    status: { tone: 'warn', label: 'Pending' },
    role: 'Member',
    notice: {
      lead: 'Your request is waiting for approval.',
      body: 'You’ll be able to open services once an admin approves it.',
    },
    tiles: [],
  },
  {
    id: 'blocked',
    label: 'Blocked',
    status: { tone: 'bad', label: 'Blocked' },
    role: 'Member',
    tiles: [],
  },
  {
    id: 'none',
    label: 'No access',
    status: { tone: 'mute', label: 'No access' },
    role: 'Member',
    tiles: [],
  },
]

export const profile = {
  ...you,
  memberSince: 'Mar 14, 2026',
  signIn: 'Google',
}

export const copy = {
  title: 'Your account',
  lede: 'This is what’s tied to your session at lilnas.io.',
  sessionHeading: 'Session details',
  servicesHeading: 'Your services',
  empty: {
    title: 'No services granted yet.',
    body: 'Once an admin grants you access, your services show up here.',
    action: 'Check again',
  },
}

export const menuItems = [
  { label: 'Admin', icon: 'shield' },
  { label: 'Sign out', icon: 'logout' },
]
