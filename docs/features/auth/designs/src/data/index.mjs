// Copy for index.pug: the list of screens.

export const pages = [
  {
    href: 'login.html',
    icon: 'lock',
    title: 'Login',
    desc: 'The front door: one Google button on a centred card. No target, with a target, a failed sign-in and the redirect.',
  },
  {
    href: 'home.html',
    icon: 'home',
    title: 'Home',
    desc: 'Your account: who you are, your status, session details and the services you can open. Admin, member, pending, blocked and no access.',
  },
  {
    href: 'pending.html',
    icon: 'clock',
    title: 'Pending',
    desc: 'Where someone waits for an admin to approve them, and where they land when the answer is no.',
  },
  {
    href: 'blocked.html',
    icon: 'shield',
    title: 'Blocked',
    desc: 'The dead end for a blocked account, with a way to check again and the toast when nothing changed.',
  },
  {
    href: 'admin.html',
    icon: 'users',
    title: 'Admin',
    desc: 'Access control: pending requests, people, Discord links, blocked accounts, both dialogs, the confirms and the error boundary.',
  },
  {
    href: 'invited.html',
    icon: 'mail',
    title: 'Invited people',
    desc: 'People added with Add a person who haven’t signed in yet: invited rows, search, Edit access and Cancel invite, the empty-service error and the toasts.',
  },
]
