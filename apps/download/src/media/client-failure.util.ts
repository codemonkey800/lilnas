/**
 * What a person reads when the download client failed because the NAS
 * filled up. The client's own text for it ("Unpacking failed, write error or
 * disk is full? <unrar output>") reads like a broken release, and freeing
 * space is the only fix.
 */
export const DISK_SPACE_ERROR =
  'The NAS ran out of disk space while SABnzbd was unpacking it.'

/**
 * Every way SABnzbd (`newsunpack.py`) and the OS say the disk filled:
 * "Unpacking failed, write error or disk is full?", "Unpacking failed, disk
 * full", "Repairing failed, Disk full", "No space left on device".
 */
const DISK_SPACE_PATTERN = /disk (is )?full|write error|no space left/i

/** What `describeClientFailure` made of a download client's failure text. */
export interface ClientFailure {
  /** `disk_space` when the text says the disk filled, else `other`. */
  kind: 'disk_space' | 'other'
  /** The text a person reads. */
  text: string
}

/**
 * Classifies a download client's failure text and words it for a person.
 *
 * - Disk full: `DISK_SPACE_ERROR`, then the client's text in parentheses up
 *   to and including the first "?" or "." at or after the disk phrase - which
 *   drops the unrar output SABnzbd appends - or the whole text when it has
 *   none ("Repairing failed, Disk full").
 * - Anything else: the text unchanged.
 * - No text (`null`/`undefined`): `other` with an empty string, so a caller
 *   keeps its own fallback for a failure with no reason.
 */
export function describeClientFailure(
  message: string | null | undefined,
): ClientFailure {
  if (message == null) return { kind: 'other', text: '' }

  const match = DISK_SPACE_PATTERN.exec(message)
  if (!match) return { kind: 'other', text: message }

  const tail = message.slice(match.index).search(/[?.]/)
  const original = (
    tail === -1 ? message : message.slice(0, match.index + tail + 1)
  ).trim()

  return { kind: 'disk_space', text: `${DISK_SPACE_ERROR} (${original})` }
}
