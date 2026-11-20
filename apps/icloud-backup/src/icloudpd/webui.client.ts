import { Injectable } from '@nestjs/common'

import { EnvKeys } from 'src/env'

const DEFAULT_URL = 'http://127.0.0.1:8080'
const REQUEST_TIMEOUT_MS = 5_000
const SNIPPET_LENGTH = 200

export type FormStep =
  | { step: 'need_password'; error: string | null }
  | { step: 'checking_password' }
  | { step: 'need_code'; error: string | null }
  | { step: 'checking_code' }
  | { step: 'no_input' }
  | { step: 'unreachable' }
  | { step: 'unknown'; snippet: string }

export type SubmitResult = 'accepted' | 'wrong_step' | 'rejected'

// An attribute value, quoted or bare.
const ATTR_VALUE = `(?:"[^"]*"|'[^']*'|[^\\s>]+)`
// A whole <input …> tag. Quoted values may contain `>`, so a plain `[^>]*`
// would stop early and leave the tail of a tag (and whatever it echoes) behind.
const INPUT_TAG = /<input\b(?:"[^"]*"|'[^']*'|[^>"'])*>/gi
const UNTERMINATED_INPUT_TAG = /<input\b[\s\S]*$/i
const VALUE_ATTRIBUTE = new RegExp(`\\svalue\\s*=\\s*${ATTR_VALUE}`, 'gi')

const PASSWORD_FORM = /hx-post\s*=\s*["']?\/password\b/i
const CODE_FORM = /hx-post\s*=\s*["']?\/code\b/i
// The server renders its error inside `<div class="fw-bold">`, in the form
// fragments and the "no input needed" card alike.
const ERROR_TEXT = /<div\s+class\s*=\s*["']fw-bold["']\s*>([\s\S]*?)<\/div>/i

function decodeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;/gi, "'")
    .replace(/&amp;/g, '&')
}

function extractError(html: string): string | null {
  const match = ERROR_TEXT.exec(html)
  if (!match?.[1]) return null
  const text = decodeEntities(match[1].replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? null : text
}

// The first 200 characters of a fragment we could not classify, safe to log:
// every <input> tag (and any `value=` attribute) is removed first so nothing
// the form echoes back survives.
export function snippetOf(html: string): string {
  return html
    .replace(INPUT_TAG, '')
    .replace(UNTERMINATED_INPUT_TAG, '')
    .replace(VALUE_ATTRIBUTE, '')
    .slice(0, SNIPPET_LENGTH)
}

// Pure: classifies one /status response body.
export function parseFragment(html: string): FormStep {
  if (PASSWORD_FORM.test(html)) {
    return { step: 'need_password', error: extractError(html) }
  }
  if (CODE_FORM.test(html)) {
    return { step: 'need_code', error: extractError(html) }
  }
  if (/Status:\s*CHECKING_PASSWORD\b/.test(html)) {
    return { step: 'checking_password' }
  }
  if (/Status:\s*CHECKING_MFA\b/.test(html)) {
    return { step: 'checking_code' }
  }
  if (/No input is needed/i.test(html)) {
    return { step: 'no_input' }
  }
  return { step: 'unknown', snippet: snippetOf(html) }
}

// Talks to the web UI icloudpd starts for `--password-provider webui`. The
// password and the code only ever travel as method parameters: they are never
// stored, logged, or put in an error, and no request body or response body is
// logged either.
@Injectable()
export class WebuiClient {
  private baseUrl(): string {
    return (process.env[EnvKeys.ICLOUDPD_WEBUI_URL] || DEFAULT_URL).replace(
      /\/+$/,
      '',
    )
  }

  async getStep(): Promise<FormStep> {
    try {
      const res = await fetch(`${this.baseUrl()}/status`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      return parseFragment(await res.text())
    } catch {
      return { step: 'unreachable' }
    }
  }

  // Posts only to the endpoint of the step the form is showing: the server
  // takes a code during the password step and treats it as the password's
  // answer. Anything else is `wrong_step` and nothing is sent.
  submitPassword(password: string): Promise<SubmitResult> {
    return this.submit('need_password', '/password', 'password', password)
  }

  submitCode(code: string): Promise<SubmitResult> {
    return this.submit('need_code', '/code', 'code', code)
  }

  async cancel(): Promise<void> {
    try {
      await this.post('/cancel', new URLSearchParams())
    } catch {
      // The process may already be gone.
    }
  }

  private async submit(
    expected: 'need_password' | 'need_code',
    path: string,
    field: string,
    value: string,
  ): Promise<SubmitResult> {
    const current = await this.getStep()
    if (current.step !== expected) return 'wrong_step'
    try {
      const res = await this.post(path, new URLSearchParams({ [field]: value }))
      return res.ok ? 'accepted' : 'rejected'
    } catch {
      return 'rejected'
    }
  }

  private post(path: string, body: URLSearchParams): Promise<Response> {
    return fetch(`${this.baseUrl()}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  }
}
