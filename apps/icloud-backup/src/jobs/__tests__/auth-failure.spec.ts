import { judgePasswordAttempt } from 'src/jobs/auth-failure'

describe('judgePasswordAttempt', () => {
  it('is open until something decisive happens', () => {
    expect(judgePasswordAttempt([])).toBe('pending')
    expect(judgePasswordAttempt(['checking_password'])).toBe('pending')
  })

  it('has progressed once the code step or the all-set-up line shows', () => {
    expect(judgePasswordAttempt(['checking_password', 'need_code'])).toBe(
      'progressed',
    )
    expect(judgePasswordAttempt(['two_factor_log'])).toBe('progressed')
    expect(judgePasswordAttempt(['checking_password', 'authenticated'])).toBe(
      'progressed',
    )
    // A trusted session that goes straight through, then exits.
    expect(judgePasswordAttempt(['authenticated', 'exit'])).toBe('progressed')
  })

  it('has failed when the process exits without progress', () => {
    expect(judgePasswordAttempt(['checking_password', 'exit'])).toBe('failed')
    expect(judgePasswordAttempt(['exit'])).toBe('failed')
  })

  it('has failed when the form leaves the check for the password or nothing', () => {
    expect(judgePasswordAttempt(['checking_password', 'need_password'])).toBe(
      'failed',
    )
    expect(judgePasswordAttempt(['checking_password', 'no_input'])).toBe(
      'failed',
    )
  })

  it('ignores one stale password form or no-input card right after the relay', () => {
    expect(judgePasswordAttempt(['need_password'])).toBe('pending')
    expect(judgePasswordAttempt(['no_input'])).toBe('pending')
    expect(
      judgePasswordAttempt(['need_password', 'checking_password', 'need_code']),
    ).toBe('progressed')
  })

  it('counts the same weak signal twice in a row as a failure', () => {
    expect(judgePasswordAttempt(['need_password', 'need_password'])).toBe(
      'failed',
    )
    expect(judgePasswordAttempt(['no_input', 'no_input'])).toBe('failed')
    expect(judgePasswordAttempt(['need_password', 'no_input'])).toBe('pending')
  })
})
