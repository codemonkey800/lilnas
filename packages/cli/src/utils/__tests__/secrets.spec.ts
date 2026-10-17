import {
  decryptedPathFor,
  isFullyEncrypted,
  listEncryptedEnvFiles,
  privateKeyNameFor,
  stripDotenvxHeader,
} from '../secrets'

const ENCRYPTED_FILES = [
  'apps/auth/.env.prod',
  'apps/download/.env.prod',
  'apps/equations/.env.prod',
  'apps/me-token-tracker/.env.prod',
  'apps/tdr-bot/.env.prod',
  'apps/theater/.env.prod',
  'infra/.env',
  'infra/.env.design',
  'infra/.env.l4d2',
  'infra/.env.nexus-code',
  'infra/.env.palworld',
  'infra/.env.storage',
  'infra/.env.traefik',
  'infra/.env.turbo',
  'infra/.env.valheim',
]

const EXCLUDED_FILES = [
  'apps/auth/.env.example',
  'apps/download/.env.dev-remote.example',
  'infra/.env.example',
  'infra/.env.storage.example',
  'apps/tdr-bot/.env.prod.decrypted',
  'infra/.env.storage.decrypted',
  'apps/x/.env',
  'apps/x/.env.dev-remote',
  'apps/tdr-code/.env',
  'infra/env/.env.storage',
  '.env.turbo',
  '.env.keys',
  'docker-compose.yml',
  'packages/cli/src/utils/secrets.ts',
]

describe('listEncryptedEnvFiles', () => {
  it('finds the 15 committed env files and returns them sorted under root', () => {
    const listing = [...EXCLUDED_FILES, ...ENCRYPTED_FILES].reverse()

    expect(listEncryptedEnvFiles('/repo', listing)).toEqual(
      ENCRYPTED_FILES.map(file => `/repo/${file}`),
    )
  })

  it('excludes examples, decrypted siblings, dev env files and nested dirs', () => {
    expect(listEncryptedEnvFiles('/repo', EXCLUDED_FILES)).toEqual([])
  })

  it('tolerates trailing whitespace from a line-split listing', () => {
    expect(listEncryptedEnvFiles('/repo', ['infra/.env\n'])).toEqual([
      '/repo/infra/.env',
    ])
  })
})

describe('decryptedPathFor', () => {
  it('appends .decrypted to the file', () => {
    expect(decryptedPathFor('/repo/apps/tdr-bot/.env.prod')).toBe(
      '/repo/apps/tdr-bot/.env.prod.decrypted',
    )
    expect(decryptedPathFor('infra/.env')).toBe('infra/.env.decrypted')
  })
})

describe('privateKeyNameFor', () => {
  it.each([
    ['apps/tdr-bot/.env.prod', 'DOTENV_PRIVATE_KEY_PROD'],
    ['infra/.env', 'DOTENV_PRIVATE_KEY'],
    ['infra/.env.nexus-code', 'DOTENV_PRIVATE_KEY_NEXUS-CODE'],
    ['infra/.env.turbo', 'DOTENV_PRIVATE_KEY_TURBO'],
    ['/abs/path/.env.prod', 'DOTENV_PRIVATE_KEY_PROD'],
  ])('%s -> %s', (file, expected) => {
    expect(privateKeyNameFor(file)).toBe(expected)
  })
})

describe('stripDotenvxHeader', () => {
  const banner = [
    '#/-------------------[DOTENV_PUBLIC_KEY]--------------------/',
    '#/            public-key encryption for .env files          /',
    '#/       [how it works](https://dotenvx.com/encryption)     /',
    '#/----------------------------------------------------------/',
  ].join('\n')

  const body = [
    '',
    '# .env.prod',
    '# leading comment',
    'PLAIN_A=hello',
    'PLAIN_B="quoted value"',
    '',
    '# trailing comment',
    'export EXPORTED=x',
  ].join('\n')

  it('removes the banner and public key line, keeps comments and blanks', () => {
    const decrypted = `${banner}\nDOTENV_PUBLIC_KEY_PROD="03abc"\n${body}\n`

    expect(stripDotenvxHeader(decrypted)).toBe(`${body}\n`)
  })

  it('handles the un-suffixed DOTENV_PUBLIC_KEY of infra/.env', () => {
    expect(
      stripDotenvxHeader(`${banner}\nDOTENV_PUBLIC_KEY=03abc\nX=1\n`),
    ).toBe('X=1\n')
  })

  it('does not add or remove a trailing newline', () => {
    expect(stripDotenvxHeader('X=1')).toBe('X=1')
    expect(stripDotenvxHeader('X=1\n')).toBe('X=1\n')
    expect(stripDotenvxHeader('X=1\n\n')).toBe('X=1\n\n')
  })

  it('leaves a file without a header untouched', () => {
    expect(stripDotenvxHeader(body)).toBe(body)
  })
})

describe('isFullyEncrypted', () => {
  const header = [
    '#/-------------------[DOTENV_PUBLIC_KEY]--------------------/',
    '#/----------------------------------------------------------/',
    'DOTENV_PUBLIC_KEY_PROD="03abc"',
    '',
    '# .env.prod',
  ].join('\n')

  it('accepts a fully encrypted file', () => {
    const content = `${header}\nA=encrypted:aaa\nexport B=encrypted:bbb\n`

    expect(isFullyEncrypted(content)).toEqual({ ok: true, plaintextKeys: [] })
  })

  it('accepts quoted encrypted values', () => {
    const content = `${header}\nA="encrypted:aaa"\nB='encrypted:bbb'\n`

    expect(isFullyEncrypted(content)).toEqual({ ok: true, plaintextKeys: [] })
  })

  it('names the one plaintext key', () => {
    const content = `${header}\nA=encrypted:aaa\nSECRET=hunter2\nB=encrypted:bbb\n`

    expect(isFullyEncrypted(content)).toEqual({
      ok: false,
      plaintextKeys: ['SECRET'],
    })
  })

  it('treats an empty value as plaintext', () => {
    expect(isFullyEncrypted(`${header}\nA=encrypted:aaa\nEMPTY=\n`)).toEqual({
      ok: false,
      plaintextKeys: ['EMPTY'],
    })
    expect(isFullyEncrypted('EMPTY=""\n')).toEqual({
      ok: false,
      plaintextKeys: ['EMPTY'],
    })
  })

  it('accepts an empty or comment-only file', () => {
    expect(isFullyEncrypted('')).toEqual({ ok: true, plaintextKeys: [] })
    expect(isFullyEncrypted('# nothing here\n\n')).toEqual({
      ok: true,
      plaintextKeys: [],
    })
  })

  it('reports a malformed line by number instead of echoing it', () => {
    expect(
      isFullyEncrypted('A=encrypted:aaa\nthis is not env syntax\n'),
    ).toEqual({ ok: false, plaintextKeys: ['line 2'] })
  })
})
