import {
  HostMatcherSchema,
  isHostPattern,
  isValidHostPattern,
  matchesHost,
  normalizeHostMatcher,
} from 'src/grants/host-matcher'

process.env.REDIRECT_ALLOWED_SUFFIX = 'localhost.test'

describe('host-matcher', () => {
  describe('isHostPattern', () => {
    it('is true only for a leading *. wildcard', () => {
      expect(isHostPattern('*.dev.lilnas.io')).toBe(true)
      expect(isHostPattern('foo.lilnas.io')).toBe(false)
      expect(isHostPattern('foo-*.lilnas.io')).toBe(false)
    })
  })

  describe('normalizeHostMatcher', () => {
    it('trims and lowercases', () => {
      expect(normalizeHostMatcher('  *.Dev.LILNAS.io ')).toBe('*.dev.lilnas.io')
      expect(normalizeHostMatcher('Swole.lilnas.io')).toBe('swole.lilnas.io')
    })
  })

  describe('matchesHost', () => {
    it('matches literals exactly', () => {
      expect(matchesHost('swole.lilnas.io', 'swole.lilnas.io')).toBe(true)
      expect(matchesHost('swole.lilnas.io', 'a.swole.lilnas.io')).toBe(false)
    })

    it('matches any host below a pattern suffix, at any depth', () => {
      expect(matchesHost('*.dev.lilnas.io', 'foo.dev.lilnas.io')).toBe(true)
      expect(matchesHost('*.dev.lilnas.io', 'a.b.dev.lilnas.io')).toBe(true)
    })

    it('does not match the bare suffix itself', () => {
      expect(matchesHost('*.dev.lilnas.io', 'dev.lilnas.io')).toBe(false)
    })

    it('does not match a lookalike domain', () => {
      expect(matchesHost('*.dev.lilnas.io', 'foodev.lilnas.io')).toBe(false)
      expect(matchesHost('*.lilnas.io', 'evil-lilnas.io')).toBe(false)
      expect(matchesHost('*.lilnas.io', 'lilnas.io.evil.com')).toBe(false)
    })

    it('lets an "everything" rule match every subdomain', () => {
      expect(matchesHost('*.lilnas.io', 'swole.lilnas.io')).toBe(true)
      expect(matchesHost('*.lilnas.io', 'foo.dev.lilnas.io')).toBe(true)
    })
  })

  describe('isValidHostPattern', () => {
    it('checks shape only without an allowed suffix', () => {
      expect(isValidHostPattern('*.dev.lilnas.io')).toBe(true)
      expect(isValidHostPattern('*.example.com')).toBe(true)
      expect(isValidHostPattern('foo-*.lilnas.io')).toBe(false)
      expect(isValidHostPattern('*.*.lilnas.io')).toBe(false)
      expect(isValidHostPattern('*.')).toBe(false)
      expect(isValidHostPattern('*.-bad.lilnas.io')).toBe(false)
      expect(isValidHostPattern('foo.lilnas.io')).toBe(false)
    })

    it('requires the suffix to be the allowed suffix or below it', () => {
      expect(isValidHostPattern('*.lilnas.io', 'lilnas.io')).toBe(true)
      expect(isValidHostPattern('*.dev.lilnas.io', 'lilnas.io')).toBe(true)
      expect(isValidHostPattern('*.example.com', 'lilnas.io')).toBe(false)
      expect(isValidHostPattern('*.evil-lilnas.io', 'lilnas.io')).toBe(false)
    })
  })

  describe('HostMatcherSchema', () => {
    it('accepts and normalizes a literal host', () => {
      expect(HostMatcherSchema.parse(' Swole.localhost.test ')).toBe(
        'swole.localhost.test',
      )
    })

    it('accepts a pattern under REDIRECT_ALLOWED_SUFFIX', () => {
      expect(HostMatcherSchema.parse('*.Dev.localhost.test')).toBe(
        '*.dev.localhost.test',
      )
      expect(HostMatcherSchema.parse('*.localhost.test')).toBe(
        '*.localhost.test',
      )
    })

    it.each(['foo-*.localhost.test', '*.example.com', '*.*.localhost.test'])(
      'rejects %s',
      value => {
        const result = HostMatcherSchema.safeParse(value)
        expect(result.success).toBe(false)
        expect(result.error?.issues[0]?.message).toContain(
          'not a valid access rule',
        )
      },
    )

    it('rejects a blank value', () => {
      expect(HostMatcherSchema.safeParse('').success).toBe(false)
      expect(HostMatcherSchema.safeParse('   ').success).toBe(false)
    })
  })
})
