// Copy and sample data for backup.pug: everything a signed-in person sees from
// then on. Sample values only. The temporary password is a made-up phrase and
// the email is on example.com.

export const email = 'sam@example.com'

export const queued = {
  badge: { tone: 'warn', label: 'Queued' },
  title: 'Your backup is in line',
  lede: 'Two backups run at a time. Yours starts as soon as one finishes.',
  hint: 'You can close this tab. Your place in line is kept.',
}

export const preparing = {
  badge: { tone: 'warn', label: 'Waiting for Apple' },
  title: 'Apple is still preparing your library',
  lede: 'Trying again in 2 minutes.',
  attempt: 'Attempt 2 of 6',
  attemptPct: 33,
  hint: 'Big libraries can take a while. You can close this tab.',
}

export const downloading = {
  badge: { tone: 'accent', label: 'Downloading', live: true },
  title: '1,204 of 18,532 photos and videos',
  pct: 6,
  size: '12.4 GB',
  sizeLabel: 'so far',
  file: 'IMG_4821.HEIC',
  hint: 'You can close this tab. Your backup keeps going.',
  stop: 'Stop',
}

export const reconnecting = {
  lead: 'Lost the live connection.',
  detail: 'Reconnecting. Your backup keeps going in the meantime.',
}

export const finishing = {
  badge: { tone: 'accent', label: 'Finishing', live: true },
  title: 'Setting up your photos',
  lede: 'Creating your Immich account and library. This takes a moment.',
  steps: [
    { tone: 'ok', label: 'Photos and videos downloaded' },
    { tone: 'accent', pulse: true, label: 'Creating your Immich account' },
    { tone: 'idle', label: 'Creating your library' },
  ],
}

export const done = {
  badge: { tone: 'ok', label: 'Up to date' },
  title: 'Your photos are backed up',
  facts: [
    { label: 'Last backup', value: '2h ago' },
    { label: 'Photos and videos', value: '18,532' },
    { label: 'Size', value: '142 GB' },
  ],
  sync: 'Sync now',
  open: 'Open my photos',
  openHref: 'https://immich.lilnas.io',
  immich: {
    title: 'Your Immich sign-in',
    email,
    newHint:
      "You haven't set a password for Immich yet. Make a temporary one, then change it when you sign in.",
    create: 'Create a temporary password',
    revealedHint: 'Use this password the first time you sign in to Immich.',
    password: 'quiet-maple-1042-river',
    copy: 'Copy',
    revealedWarn: "Shown once. You'll be asked to change it.",
    existingHint:
      'You already had an Immich account, so we linked your photos to it. Sign in with the password you already use.',
  },
}

export const reauth = {
  badge: { tone: 'warn', label: 'Needs sign-in' },
  title: 'Apple wants you to sign in again',
  lede: 'Apple ended the sign-in your backup was using. The photos already saved are safe.',
  action: 'Sign in again',
  href: 'start.html',
}

export const paused = {
  badge: { tone: 'warn', label: 'Paused' },
  title: 'The server is low on space',
  lede: 'Your backup is paused so nothing gets cut off. It picks up by itself once there is room.',
  todo: {
    lead: 'What to do:',
    detail: "nothing here. Tell Jeremy the server is full and he'll make room.",
  },
  progress: '1,204 of 18,532 photos and videos saved so far',
  pct: 6,
}

export const failed = {
  badge: { tone: 'bad', label: 'Failed' },
  title: "Your backup didn't finish",
  reasons: {
    refused: {
      lead: 'Apple refused access.',
      detail: 'Check the two settings',
      detailEnd: ' and try again.',
      href: 'start.html#preflight',
      action: 'Check my settings',
      actionIcon: 'shield',
    },
    timeout: {
      lead: 'Sign-in timed out.',
      detail: "Apple didn't get the code in time. Sign in again to start over.",
      href: 'start.html',
      action: 'Sign in again',
      actionIcon: 'arrow',
    },
    generic: {
      lead: 'Something went wrong.',
      detail:
        'The backup stopped. Try again, and if it keeps happening tell Jeremy.',
      code: 'icloudpd stopped: exit 1',
      action: 'Try again',
      actionIcon: 'refresh',
    },
  },
}

export const states = [
  {
    key: 'queued',
    label: 'Queued',
    caption: 'Waiting for one of the two download slots',
  },
  {
    key: 'preparing',
    label: 'Apple preparing',
    caption:
      'Apple is still building the library. Attempt 2 of 6, retry in 2 minutes',
  },
  {
    key: 'downloading',
    label: 'Downloading',
    caption: 'Count, bar, size so far, current file in mono, live dot, Stop',
  },
  {
    key: 'reconnecting',
    label: 'Reconnecting',
    caption: 'The same screen with a banner when the live connection drops',
  },
  {
    key: 'finishing',
    label: 'Finishing',
    caption: 'Creating the Immich account and library',
  },
  {
    key: 'done-new',
    label: 'Done · New Immich account',
    caption:
      'Open my photos is the one accent button; the password button is outline',
  },
  {
    key: 'done-revealed',
    label: 'Done · Password shown',
    caption: 'After Create a temporary password: shown once, with Copy',
  },
  {
    key: 'done-existing',
    label: 'Done · Had an Immich account',
    caption:
      'Linked to the account that was already there, so no password button',
  },
  {
    key: 'reauth',
    label: 'Sign in again',
    caption: 'Apple ended the session',
  },
  {
    key: 'paused',
    label: 'Paused',
    caption: 'Under 200 GB free; nothing for the person to do',
  },
  {
    key: 'failed-refused',
    label: 'Failed · Apple refused',
    caption: 'The reason slot holds a link back to the pre-flight page',
    reason: 'refused',
  },
  {
    key: 'failed-timeout',
    label: 'Failed · Sign-in timed out',
    caption: 'The same screen, a different reason',
    reason: 'timeout',
  },
  {
    key: 'failed-generic',
    label: 'Failed · Something went wrong',
    caption:
      'The generic reason, with the machine string in mono and Try again',
    reason: 'generic',
  },
]
