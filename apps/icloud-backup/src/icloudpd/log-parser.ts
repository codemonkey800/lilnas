import { Injectable } from '@nestjs/common'

export type LogEvent =
  | { type: 'two_factor_required' }
  | { type: 'authenticated' }
  | { type: 'total'; count: number }
  | { type: 'downloaded'; path: string }
  | { type: 'skipped'; path: string }
  | { type: 'all_done' }
  | { type: 'indexing' }
  | { type: 'needs_login' }
  | { type: 'access_denied' }
  | { type: 'other' }

// Strips ANSI colour/cursor escapes. Built with RegExp() because an ESC byte
// in a regex literal trips `no-control-regex`.
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;?]*[ -/]*[@-~]`, 'g')

// `Downloaded <absolute path>`: the path runs to the end of the line and may
// contain spaces, so it is not split on whitespace. The earliest `Downloaded `
// wins, so a path that itself says "Downloaded /" cannot confuse it.
const DOWNLOADED = /(?:^|\s)Downloaded (\/.+?)\s*$/

// `Downloading 18,532 original photos and videos to /… ...`. N is the grand
// total, printed with thousands separators.
const TOTAL = /\bDownloading (\d[\d,]*) original (?:photos?|videos?)/

// The exact "already exists" wording is unverified on 1.32.3 (the library logs
// it at debug level, which `--log-level info` hides), so this is loose: an
// absolute path followed, possibly after a little punctuation, by "already
// exists". Everything between the first `/` and the phrase is the path.
const SKIPPED = /(\/.+?)[\s,:;(-]*(?:file )?already exists?\b/i

const TRAILING_PUNCTUATION = /[\s,:;('"-]+$/

export function parseLine(line: string): LogEvent {
  const text = line.replace(ANSI, '').replace(/[\r\n]+$/, '')

  // Lines that quote a file path come first: a path may contain any word the
  // rules below look for (`getpass`, `ACCESS_DENIED`, …).
  const downloaded = DOWNLOADED.exec(text)
  if (downloaded?.[1]) {
    return { type: 'downloaded', path: downloaded[1] }
  }

  const skipped = SKIPPED.exec(text)
  if (skipped?.[1]) {
    return {
      type: 'skipped',
      path: skipped[1].replace(TRAILING_PUNCTUATION, ''),
    }
  }

  const total = TOTAL.exec(text)
  if (total?.[1]) {
    return { type: 'total', count: Number(total[1].replace(/,/g, '')) }
  }

  if (text.includes('Two-factor authentication is required')) {
    return { type: 'two_factor_required' }
  }
  if (text.includes("Great, you're all set up.")) {
    return { type: 'authenticated' }
  }
  if (text.includes('All photos and videos have been downloaded')) {
    return { type: 'all_done' }
  }
  if (text.includes('has not finished indexing yet')) {
    return { type: 'indexing' }
  }
  if (text.includes('ACCESS_DENIED')) {
    return { type: 'access_denied' }
  }
  // Without the webui flags and without a valid session, icloudpd asks for a
  // password on stdin, finds it closed and dies with a traceback.
  if (/\bEOFError\b/.test(text) || /\bgetpass\b/.test(text)) {
    return { type: 'needs_login' }
  }

  return { type: 'other' }
}

// Injectable face of the pure parser, so IcloudpdModule can export all three
// pieces (process runner, form client, log parser) as providers.
@Injectable()
export class LogParser {
  parseLine(line: string): LogEvent {
    return parseLine(line)
  }
}
