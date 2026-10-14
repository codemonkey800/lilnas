import { detectOidcPrompt } from 'src/app/login/oidc-prompt'

describe('detectOidcPrompt', () => {
  it('returns the client id when client_id and sig are both present', () => {
    expect(
      detectOidcPrompt({ client_id: 'test-app', sig: 'abc', state: 'xyz' }),
    ).toEqual({ clientId: 'test-app' })
  })

  it('returns null when sig is missing', () => {
    expect(detectOidcPrompt({ client_id: 'test-app' })).toBeNull()
  })

  it('returns null when client_id is missing', () => {
    expect(detectOidcPrompt({ sig: 'abc' })).toBeNull()
  })

  it('returns null with no params', () => {
    expect(detectOidcPrompt({})).toBeNull()
  })

  it('returns null when either value is a repeated (array) key', () => {
    expect(detectOidcPrompt({ client_id: ['a', 'b'], sig: 'abc' })).toBeNull()
    expect(
      detectOidcPrompt({ client_id: 'test-app', sig: ['a', 'b'] }),
    ).toBeNull()
  })

  it('returns null for empty strings', () => {
    expect(detectOidcPrompt({ client_id: '', sig: 'abc' })).toBeNull()
    expect(detectOidcPrompt({ client_id: 'test-app', sig: '' })).toBeNull()
  })

  it('treats explicit undefined as absent', () => {
    expect(detectOidcPrompt({ client_id: undefined, sig: 'abc' })).toBeNull()
  })
})
