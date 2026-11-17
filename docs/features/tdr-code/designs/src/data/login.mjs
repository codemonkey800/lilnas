// Copy and sample data for login.pug. The ?error= codes are the three the app
// can produce (login/page.tsx); each is its own note so none is mistaken for
// another. Voice: what happened, then what to do, no apology.

export const copy = {
  title: 'Sign in',
  body: 'tdr-code is for members of the Discord server.',
  button: 'Sign in with Discord',
  redirecting: 'Redirecting…',
}

export const errors = {
  not_guild_member: {
    tone: 'bad',
    lead: "That account isn't in the server.",
    detail:
      'tdr-code is limited to members of the configured Discord server. Sign in with a different account, or ask to be added.',
  },
  session_expired: {
    tone: 'accent',
    lead: 'Your session expired.',
    detail: 'Sign in again to pick up where you were.',
  },
  oauth_failed: {
    tone: 'warn',
    lead: "Sign-in didn't finish.",
    detail: "Discord didn't complete it. Try again.",
  },
}

export const states = [
  { key: 'default', label: 'Default', caption: 'a bare /login' },
  {
    key: 'not_guild_member',
    label: 'Not a member',
    caption: '?error=not_guild_member',
  },
  {
    key: 'session_expired',
    label: 'Session expired',
    caption: '?error=session_expired',
  },
  {
    key: 'oauth_failed',
    label: 'Sign-in failed',
    caption: '?error=oauth_failed',
  },
  {
    key: 'redirecting',
    label: 'Redirecting',
    caption: 'button disabled after the click',
  },
]
