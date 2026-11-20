import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { LogEvent, parseLine } from 'src/icloudpd/log-parser'

describe('parseLine', () => {
  it.each<[string, LogEvent]>([
    [
      'Two-factor authentication is required (2fa)',
      { type: 'two_factor_required' },
    ],
    [
      '2026-11-19 12:00:00 INFO     Two-factor authentication is required (2fa)',
      { type: 'two_factor_required' },
    ],
    [
      "Great, you're all set up. The script can now be run without user interaction until 2FA expires.",
      { type: 'authenticated' },
    ],
    [
      'Downloading 18,532 original photos and videos to /photos/alice ...',
      { type: 'total', count: 18532 },
    ],
    [
      '2026-11-19 12:00:00 INFO     Downloading 7 original photos and videos to /photos/alice ...',
      { type: 'total', count: 7 },
    ],
    [
      'Downloading 1 original photo to /photos/alice ...',
      { type: 'total', count: 1 },
    ],
    [
      'Downloaded /photos/alice/2024/03/IMG_0001.HEIC',
      { type: 'downloaded', path: '/photos/alice/2024/03/IMG_0001.HEIC' },
    ],
    [
      '2026-11-19 12:00:01 INFO     Downloaded /photos/alice/2024/03/IMG_0001.HEIC',
      { type: 'downloaded', path: '/photos/alice/2024/03/IMG_0001.HEIC' },
    ],
    [
      'Downloaded /photos/alice/Summer Trip 2024/IMG 0002.JPG',
      {
        type: 'downloaded',
        path: '/photos/alice/Summer Trip 2024/IMG 0002.JPG',
      },
    ],
    [
      '\u001b[32mDownloaded /photos/alice/a.jpg\u001b[0m\r\n',
      { type: 'downloaded', path: '/photos/alice/a.jpg' },
    ],
    ['All photos and videos have been downloaded', { type: 'all_done' }],
    [
      'Apple iCloud Photo Library has not finished indexing yet',
      { type: 'indexing' },
    ],
    ['EOFError', { type: 'needs_login' }],
    [
      '  File "getpass.py", line 194, in fallback_getpass',
      { type: 'needs_login' },
    ],
    ['Failed to log in: ACCESS_DENIED', { type: 'access_denied' }],
    ['2026-11-19 12:00:00 INFO     Starting', { type: 'other' }],
    ['', { type: 'other' }],
  ])('maps %j', (line, event) => {
    expect(parseLine(line)).toEqual(event)
  })

  it('does not take a download total from a Downloaded line, or the reverse', () => {
    expect(
      parseLine('Downloaded /photos/Downloading 5 original photos/a.jpg'),
    ).toEqual({
      type: 'downloaded',
      path: '/photos/Downloading 5 original photos/a.jpg',
    })
  })

  it('lets a file path win over the words the later rules look for', () => {
    expect(
      parseLine('Downloaded /photos/alice/getpass EOFError ACCESS_DENIED.jpg'),
    ).toEqual({
      type: 'downloaded',
      path: '/photos/alice/getpass EOFError ACCESS_DENIED.jpg',
    })
  })

  it.each([
    '/photos/alice/IMG_0001.HEIC already exists',
    '2026-11-19 12:00:00 DEBUG    /photos/alice/IMG_0001.HEIC already exists.',
    'Skipping /photos/alice/IMG_0001.HEIC, file already exists',
    'Skipping /photos/alice/IMG_0001.HEIC (already exists)',
  ])('treats %j as a skip', line => {
    expect(parseLine(line)).toEqual({
      type: 'skipped',
      path: '/photos/alice/IMG_0001.HEIC',
    })
  })

  it('keeps spaces inside a skipped path', () => {
    expect(
      parseLine('/photos/alice/Summer Trip/IMG 1.JPG already exists'),
    ).toEqual({
      type: 'skipped',
      path: '/photos/alice/Summer Trip/IMG 1.JPG',
    })
  })

  it('reads the real traceback from a download with no session as needs_login', () => {
    const lines = readFileSync(
      join(__dirname, 'fixtures', 'needs-login.txt'),
      'utf8',
    ).split('\n')
    const types = new Set(lines.map(line => parseLine(line).type))
    expect(types).toEqual(new Set(['other', 'needs_login']))
    expect(parseLine('EOFError')).toEqual({ type: 'needs_login' })
    expect(lines.filter(l => l === 'EOFError')).toHaveLength(1)
  })
})
