// Copy and sample data for start.pug: pre-flight, sign-in, waiting, code, hand-over.
// Sample values only. The Apple ID is the reserved example.invalid address, and
// the code cells show bullets, never digits.

export const appleId = 'nobody@example.invalid'

export const preflight = {
  step: 'Check your settings',
  title: 'Before you start',
  lede: 'Two settings on your iPhone, and one thing to keep nearby. It takes a minute.',
  items: [
    {
      icon: 'shield',
      title: 'Advanced Data Protection must be off',
      where:
        'On your iPhone: Settings, tap your name, iCloud, Advanced Data Protection.',
    },
    {
      icon: 'globe',
      title: 'Access iCloud Data on the Web must be on',
      where:
        'On your iPhone: Settings, tap your name, iCloud, Access iCloud Data on the Web.',
    },
    {
      icon: 'device',
      title: 'You need an Apple device nearby for the 6-digit code',
      where:
        "Text-message codes and security keys don't work here. The code appears on an iPhone, iPad or Mac that's already signed in.",
    },
  ],
  action: 'Continue',
}

export const signIn = {
  step: 'Sign in',
  title: 'Sign in to iCloud',
  lede: 'Use the Apple ID your photos are stored under.',
  privacy: {
    lead: 'Your password goes to Apple.',
    detail: "It isn't saved on this server.",
  },
  idLabel: 'Apple ID',
  idHint: 'The email you use for iCloud',
  passwordLabel: 'Password',
  action: 'Sign in',
  submitting: 'Signing in',
  wrongPassword: "That password didn't work, try again",
  lowSpace: {
    lead: 'The server is low on space.',
    detail:
      "Backups can't start right now. Tell Jeremy, and try again once he has made room.",
  },
}

export const waiting = {
  step: 'Sign in',
  badge: { tone: 'warn', label: 'Waiting for a turn' },
  title: "You're next",
  lede: "Someone else is signing in. You're next, this page moves on by itself.",
  hint: 'You can keep this tab open. There is nothing to type.',
}

export const code = {
  step: 'Enter the code',
  title: 'Enter the code',
  lede: 'Enter the code shown on your Apple device.',
  hint: 'It pops up on an iPhone, iPad or Mac that is signed in to this Apple ID.',
  action: 'Check code',
  checking: 'Checking',
  wrong: "That code didn't work, try again",
}

export const handover = {
  title: "You're signed in",
  lede: 'Handing you over to your backup.',
}

// One entry per screen, in the order a person meets them. `group` is the row
// on the phone; `kind` picks the mixin branch in mixins/start.pug.
export const screens = [
  {
    key: 'preflight',
    group: 'Pre-flight',
    label: 'Pre-flight',
    caption: 'Three things to check, then Continue. No inputs',
    kind: 'preflight',
  },
  {
    key: 'signin-empty',
    group: 'Sign in',
    label: 'Sign in · Empty',
    caption: 'Apple ID focused, Sign in is the one accent button',
    kind: 'signin',
    state: 'empty',
  },
  {
    key: 'signin-submitting',
    group: 'Sign in',
    label: 'Sign in · Submitting',
    caption: 'Fields lock, the button loads',
    kind: 'signin',
    state: 'submitting',
  },
  {
    key: 'signin-wrong',
    group: 'Sign in',
    label: 'Sign in · Wrong password',
    caption: 'The error sits on the password field; the Apple ID stays',
    kind: 'signin',
    state: 'wrong',
  },
  {
    key: 'signin-space',
    group: 'Sign in',
    label: 'Sign in · Server low on space',
    caption: 'A warning note, and Sign in is disabled',
    kind: 'signin',
    state: 'space',
  },
  {
    key: 'waiting',
    group: 'Waiting for a turn',
    label: 'Waiting for a turn',
    caption: 'No input. The page moves on by itself',
    kind: 'waiting',
  },
  {
    key: 'code-empty',
    group: 'Code',
    label: 'Code · Empty',
    caption: 'Six cells, the first one focused',
    kind: 'code',
    state: 'empty',
  },
  {
    key: 'code-checking',
    group: 'Code',
    label: 'Code · Checking',
    caption: 'Cells lock, the button loads',
    kind: 'code',
    state: 'checking',
  },
  {
    key: 'code-wrong',
    group: 'Code',
    label: 'Code · Wrong code',
    caption: 'Cells go red with one line; typing again clears it',
    kind: 'code',
    state: 'wrong',
  },
  {
    key: 'handover',
    group: 'Signed in',
    label: 'Signed in',
    caption: 'A moment, then the backup page takes over',
    kind: 'handover',
  },
]
