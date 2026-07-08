import { BASE_SYSTEM_PROMPT } from 'src/agent/system-prompt.constants'

describe('BASE_SYSTEM_PROMPT', () => {
  it('includes the new gh transparency rule (R17)', () => {
    expect(BASE_SYSTEM_PROMPT).toContain('gh` is already authenticated')
    expect(BASE_SYSTEM_PROMPT).toContain('link it in the console at `/git`')
  })

  it('references the current /git console route, never the stale /git-identity route', () => {
    expect(BASE_SYSTEM_PROMPT).toContain('/git`')
    expect(BASE_SYSTEM_PROMPT).not.toContain('/git-identity')
  })

  it('leaves rule 1 (git-wrapper transparency) unchanged', () => {
    expect(BASE_SYSTEM_PROMPT).toContain('Git identity is automatic')
    expect(BASE_SYSTEM_PROMPT).toContain(
      'Never invoke `$TDR_REAL_GIT` directly',
    )
  })

  it('leaves rule 2 (no Markdown tables) unchanged', () => {
    expect(BASE_SYSTEM_PROMPT).toContain('Never send Markdown tables')
  })
})
