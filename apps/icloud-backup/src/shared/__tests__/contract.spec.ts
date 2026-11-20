import {
  BACKUP_STATES,
  BackupViewSchema,
  CodeBodySchema,
  ERROR_CODES,
  isTerminalState,
  JobViewSchema,
  PasswordBodySchema,
  PresetBodySchema,
  ServerMessageSchema,
  StartBackupBodySchema,
  TERMINAL_STATES,
} from 'src/shared/contract'

const job = {
  id: 'job-1',
  kind: 'first_backup',
  state: 'downloading',
  authError: null,
  queuePosition: null,
  previewItems: null,
  totalItems: 100,
  downloadedItems: 10,
  skippedItems: 0,
  downloadedBytes: 1024,
  currentFile: '2024/01/IMG_0001.HEIC',
  attempt: 0,
  maxAttempts: 5,
  retryAt: null,
  errorCode: null,
  startedAt: '2026-11-19T00:00:00.000Z',
  finishedAt: null,
}

const view = {
  email: 'alice@example.com',
  isAdmin: false,
  lowDiskSpace: false,
  account: {
    appleId: 'alice@icloud.com',
    appleIdLocked: true,
    adopted: false,
    lastBackupAt: null,
    totalItems: 0,
    totalBytes: 0,
    immich: {
      email: 'alice@example.com',
      createdByUs: true,
      url: 'https://immich.lilnas.io',
    },
  },
  job,
}

describe('StartBackupBodySchema', () => {
  it('trims and lower-cases the Apple ID', () => {
    expect(
      StartBackupBodySchema.parse({ appleId: '  Alice@ICloud.COM ' }),
    ).toEqual({ appleId: 'alice@icloud.com' })
  })

  it.each([{ appleId: 'not-an-email' }, { appleId: '' }, {}])(
    'refuses %j',
    body => {
      expect(StartBackupBodySchema.safeParse(body).success).toBe(false)
    },
  )
})

describe('PasswordBodySchema', () => {
  it('accepts 1 to 256 characters and does not trim', () => {
    expect(PasswordBodySchema.parse({ password: ' a ' })).toEqual({
      password: ' a ',
    })
    expect(
      PasswordBodySchema.safeParse({ password: 'x'.repeat(256) }).success,
    ).toBe(true)
  })

  it.each([{ password: '' }, { password: 'x'.repeat(257) }, { password: 1 }])(
    'refuses %j',
    body => {
      expect(PasswordBodySchema.safeParse(body).success).toBe(false)
    },
  )
})

describe('CodeBodySchema', () => {
  it('accepts exactly six digits', () => {
    expect(CodeBodySchema.parse({ code: '012345' })).toEqual({
      code: '012345',
    })
  })

  it.each(['12345', '1234567', '12345a', ' 12345', ''])('refuses %j', code => {
    expect(CodeBodySchema.safeParse({ code }).success).toBe(false)
  })
})

describe('PresetBodySchema', () => {
  const valid = {
    lilnasEmail: 'Mom@Example.com',
    folder: 'mom',
    immichLibraryId: 'lib-1',
  }

  it('accepts a valid preset and lower-cases the email', () => {
    expect(PresetBodySchema.parse(valid)).toEqual({
      ...valid,
      lilnasEmail: 'mom@example.com',
    })
  })

  it.each([
    { lilnasEmail: 'nope' },
    { folder: '' },
    { folder: '..' },
    { folder: 'a/b' },
    { folder: 'a\\b' },
    { immichLibraryId: '' },
  ])('refuses %j', override => {
    expect(PresetBodySchema.safeParse({ ...valid, ...override }).success).toBe(
      false,
    )
  })
})

describe('views', () => {
  it('parses a BackupView and a websocket message carrying it', () => {
    expect(BackupViewSchema.parse(view)).toEqual(view)
    expect(ServerMessageSchema.parse({ type: 'backup', data: view })).toEqual({
      type: 'backup',
      data: view,
    })
  })

  it('accepts a view with no account and no job', () => {
    expect(
      BackupViewSchema.safeParse({ ...view, account: null, job: null }).success,
    ).toBe(true)
  })

  it('refuses an unknown state, error code or message type', () => {
    expect(JobViewSchema.safeParse({ ...job, state: 'nope' }).success).toBe(
      false,
    )
    expect(JobViewSchema.safeParse({ ...job, errorCode: 'nope' }).success).toBe(
      false,
    )
    expect(
      ServerMessageSchema.safeParse({ type: 'x', data: view }).success,
    ).toBe(false)
  })

  it('lists every state and error code', () => {
    expect(BACKUP_STATES).toHaveLength(16)
    expect(ERROR_CODES).toHaveLength(8)
  })

  it('marks exactly the five terminal states', () => {
    expect(BACKUP_STATES.filter(isTerminalState)).toEqual([...TERMINAL_STATES])
    expect(TERMINAL_STATES).toEqual([
      'done',
      'needs_login',
      'paused_low_disk',
      'failed',
      'cancelled',
    ])
  })
})
