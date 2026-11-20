import { stepFor, type StepName } from 'src/lib/step'
import { BACKUP_STATES, type BackupState } from 'src/shared/contract'

import { makeView } from './helpers/view'

const EXPECTED: Record<Exclude<BackupState, 'cancelled'>, StepName> = {
  queued_login: 'waiting_turn',
  need_password: 'sign_in',
  checking_password: 'checking',
  need_code: 'code',
  checking_code: 'checking',
  queued_download: 'queued',
  indexing_wait: 'indexing',
  downloading: 'downloading',
  provisioning: 'finishing',
  done: 'done',
  needs_login: 'sign_in_again',
  paused_low_disk: 'paused',
  failed: 'failed',
}

describe('stepFor', () => {
  it.each(Object.entries(EXPECTED))('maps %s to %s', (state, step) => {
    expect(stepFor(makeView(state as BackupState))).toBe(step)
  })

  it('covers every backend state', () => {
    const covered = [...Object.keys(EXPECTED), 'cancelled'].sort()
    expect(covered).toEqual([...BACKUP_STATES].sort())
  })

  it('is preflight with no account', () => {
    expect(stepFor(makeView('downloading', { account: null }))).toBe(
      'preflight',
    )
  })

  it('is preflight with no job', () => {
    expect(stepFor(makeView(null))).toBe('preflight')
  })

  it('is failed for cancelled after a finished backup', () => {
    const view = makeView('cancelled', {}, '2026-11-01T00:00:00.000Z')
    expect(stepFor(view)).toBe('failed')
  })

  it('is preflight for cancelled with no finished backup', () => {
    expect(stepFor(makeView('cancelled'))).toBe('preflight')
  })
})
