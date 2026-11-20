import { slugFromEmail } from 'src/db/slug'

describe('slugFromEmail', () => {
  it('keeps dots, underscores and dashes and lower-cases the local part', () => {
    expect(slugFromEmail('Jane.Doe_x-y@Example.com')).toBe('jane.doe_x-y')
  })

  it('replaces +tag and spaces with dashes', () => {
    expect(slugFromEmail('jane+photos@example.com')).toBe('jane-photos')
    expect(slugFromEmail('jane doe@example.com')).toBe('jane-doe')
  })

  it('trims leading and trailing dots and dashes', () => {
    expect(slugFromEmail('..-jane-.@example.com')).toBe('jane')
    expect(slugFromEmail('+jane+@example.com')).toBe('jane')
  })

  it('falls back to "user" when nothing is left', () => {
    expect(slugFromEmail('@example.com')).toBe('user')
    expect(slugFromEmail('...@example.com')).toBe('user')
    expect(slugFromEmail('')).toBe('user')
  })

  it('cuts a 60 character local part to 40', () => {
    const slug = slugFromEmail(`${'a'.repeat(60)}@example.com`)
    expect(slug).toBe('a'.repeat(40))
  })

  it('puts the prefix in front, after cleaning', () => {
    expect(slugFromEmail('jane@example.com', 'test-')).toBe('test-jane')
    expect(slugFromEmail('@example.com', 'test-')).toBe('test-user')
  })

  it('maps non-ASCII characters to dashes', () => {
    expect(slugFromEmail('jösé@example.com')).toBe('j-s')
  })
})
