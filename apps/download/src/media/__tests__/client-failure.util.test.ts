import {
  type ClientFailure,
  describeClientFailure,
  DISK_SPACE_ERROR,
} from 'src/media/client-failure.util'

// - SABnzbd 4.x's failure texts, from `sabnzbd/newsunpack.py`. The unrar paths
//   append unrar's own line to the message; that tail is what gets dropped.
const UNRAR_WRITE_ERROR =
  'Unpacking failed, write error or disk is full?  in the file /downloads/incomplete/Game.Night.2018.1080p/Game.Night.2018.1080p.mkv'
const UNRAR_RETRY_ABORT =
  'Unpacking failed, write error or disk is full? Game.Night.2018.1080p.mkv - [R]etry, [A]bort '
const UNRAR_NOT_ENOUGH_SPACE = 'Unpacking failed, disk full'
const SEVENZIP_DISK_FULL = 'Unpacking failed, write error or disk is full?'
const PAR2_DISK_FULL = 'Repairing failed, Disk full'

const WRITE_ERROR_TEXT = `${DISK_SPACE_ERROR} (Unpacking failed, write error or disk is full?)`

describe('describeClientFailure', () => {
  it.each<[string, string | null | undefined, ClientFailure]>([
    [
      'unrar "Write error" with its tail (newsunpack.py:820)',
      UNRAR_WRITE_ERROR,
      { kind: 'disk_space', text: WRITE_ERROR_TEXT },
    ],
    [
      'unrar "[R]etry, [A]bort" with its tail (newsunpack.py:898)',
      UNRAR_RETRY_ABORT,
      { kind: 'disk_space', text: WRITE_ERROR_TEXT },
    ],
    [
      'unrar "not enough space" (newsunpack.py:826)',
      UNRAR_NOT_ENOUGH_SPACE,
      {
        kind: 'disk_space',
        text: `${DISK_SPACE_ERROR} (Unpacking failed, disk full)`,
      },
    ],
    [
      '7z, bare (newsunpack.py:1047)',
      SEVENZIP_DISK_FULL,
      { kind: 'disk_space', text: WRITE_ERROR_TEXT },
    ],
    [
      'par2 repair (newsunpack.py:1450)',
      PAR2_DISK_FULL,
      {
        kind: 'disk_space',
        text: `${DISK_SPACE_ERROR} (Repairing failed, Disk full)`,
      },
    ],
    [
      'the OS error, cut at its own period',
      'Movie.2018.mkv: No space left on device. errno 28',
      {
        kind: 'disk_space',
        text: `${DISK_SPACE_ERROR} (Movie.2018.mkv: No space left on device.)`,
      },
    ],
    [
      'a non-disk failure, unchanged',
      'Aborted, cannot be completed - https://sabnzbd.org/not-complete',
      {
        kind: 'other',
        text: 'Aborted, cannot be completed - https://sabnzbd.org/not-complete',
      },
    ],
    ['null, as an empty text', null, { kind: 'other', text: '' }],
    ['undefined, as an empty text', undefined, { kind: 'other', text: '' }],
  ])('%s', (_label, message, expected) => {
    expect(describeClientFailure(message)).toEqual(expected)
  })
})
