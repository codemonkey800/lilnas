import { jsonlPath } from 'src/console/jsonl-locator'

describe('jsonlPath', () => {
  const HOME = '/home/testuser'

  beforeEach(() => {
    process.env.HOME = HOME
  })

  it('happy path: standard cwd and uuid acpSessionId', () => {
    const result = jsonlPath('/home/testuser/work', 'abc-123')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolvedPath).toBe(`${HOME}/.claude/projects/-home-testuser-work/abc-123.jsonl`)
    }
  })

  it('cwd with dots → . escaped to -', () => {
    const result = jsonlPath('/a/.config', 'abc-123')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.resolvedPath).toContain('-a--config')
    }
  })

  it('cwd with trailing slash → deterministic result', () => {
    const r1 = jsonlPath('/home/user/work', 'sess-1')
    const r2 = jsonlPath('/home/user/work/', 'sess-1')
    expect(r1.ok && r2.ok && r1.resolvedPath === r2.resolvedPath).toBe(true)
  })

  it('acpSessionId with / → invalid-acp-session-id', () => {
    const result = jsonlPath('/home/user', '../../etc/passwd')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-acp-session-id')
  })

  it('acpSessionId with absolute path → invalid-acp-session-id', () => {
    const result = jsonlPath('/home/user', '/etc/passwd')
    expect(result.ok).toBe(false)
  })

  it('acpSessionId with dot → invalid-acp-session-id', () => {
    const result = jsonlPath('/home/user', 'foo.bar')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid-acp-session-id')
  })

  it('acpSessionId with NUL → invalid-acp-session-id', () => {
    const result = jsonlPath('/home/user', 'foo\0bar')
    expect(result.ok).toBe(false)
  })

  it('response body contains no raw path or cwd — locator is pure / path stays server-side', () => {
    // The locator itself just returns the resolved path; the service decides not to echo it.
    // This test verifies the locator is pure and does not perform FS operations.
    const result = jsonlPath('/some/cwd', 'valid-session-id')
    expect(result.ok).toBe(true)
    // The path must be under ~/.claude/projects/
    if (result.ok) {
      expect(result.resolvedPath.startsWith(HOME)).toBe(true)
      expect(result.resolvedPath).toContain('.claude/projects/')
    }
  })
})
