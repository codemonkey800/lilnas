import { stripAuthCookies } from 'src/verify/strip-auth-cookies'

describe('stripAuthCookies', () => {
  describe('input with nothing to keep', () => {
    it.each([
      ['undefined', undefined],
      ['an empty string', ''],
      ['whitespace only', '   \t '],
      ['only separators', ' ; ;; '],
    ])('returns undefined for %s', (_label, input) => {
      expect(stripAuthCookies(input)).toBeUndefined()
    })

    it('returns undefined when only lilnas-auth cookies are present', () => {
      expect(
        stripAuthCookies(
          'lilnas-auth.session_token=abc; __Secure-lilnas-auth.session_data=def',
        ),
      ).toBeUndefined()
    })
  })

  describe('removing lilnas-auth cookies', () => {
    it('removes the plain-prefixed session cookie and keeps the rest', () => {
      expect(stripAuthCookies('a=1; lilnas-auth.session_token=tok; b=2')).toBe(
        'a=1; b=2',
      )
    })

    it('removes the __Secure- prefixed session cookie and keeps the rest', () => {
      expect(
        stripAuthCookies('a=1; __Secure-lilnas-auth.session_token=tok; b=2'),
      ).toBe('a=1; b=2')
    })

    it.each([
      'session_token',
      'session_data',
      'account_data',
      'dont_remember',
      'state',
      'oauth_state',
    ])('removes the %s cookie in both name forms', suffix => {
      expect(
        stripAuthCookies(
          `keep=1; lilnas-auth.${suffix}=x; __Secure-lilnas-auth.${suffix}=y`,
        ),
      ).toBe('keep=1')
    })

    it('removes both name forms in a single header', () => {
      expect(
        stripAuthCookies(
          'lilnas-auth.session_token=a; x=1; __Secure-lilnas-auth.session_token=b; y=2',
        ),
      ).toBe('x=1; y=2')
    })

    it('removes the same stripped name when it appears twice', () => {
      expect(
        stripAuthCookies(
          'lilnas-auth.session_token=a; x=1; lilnas-auth.session_token=b',
        ),
      ).toBe('x=1')
    })

    it('removes a lilnas-auth cookie that has no value or no "="', () => {
      expect(stripAuthCookies('lilnas-auth.session_token; x=1')).toBe('x=1')
      expect(stripAuthCookies('lilnas-auth.session_token=; x=1')).toBe('x=1')
    })

    it('removes a lilnas-auth cookie with whitespace around its name and "="', () => {
      expect(
        stripAuthCookies('x=1;   lilnas-auth.session_token  = tok  ; y=2'),
      ).toBe('x=1; y=2')
    })
  })

  describe('keeping other cookies', () => {
    it('is case-sensitive: differently-cased prefixes are kept', () => {
      expect(
        stripAuthCookies(
          'LILNAS-AUTH.session_token=a; Lilnas-Auth.session_token=b; __secure-lilnas-auth.session_token=c',
        ),
      ).toBe(
        'LILNAS-AUTH.session_token=a; Lilnas-Auth.session_token=b; __secure-lilnas-auth.session_token=c',
      )
    })

    it('requires the prefix to start at the first character of the name', () => {
      expect(
        stripAuthCookies(
          'xlilnas-auth.session_token=a; x__Secure-lilnas-auth.session_token=b; lilnas-auth.session_token=c',
        ),
      ).toBe(
        'xlilnas-auth.session_token=a; x__Secure-lilnas-auth.session_token=b',
      )
    })

    it('keeps better-auth cookies (another app’s, same domain)', () => {
      expect(
        stripAuthCookies(
          'better-auth.session_token=a; __Secure-better-auth.session_token=b',
        ),
      ).toBe(
        'better-auth.session_token=a; __Secure-better-auth.session_token=b',
      )
    })

    it('does not treat the bare prefix without a dot as an auth cookie', () => {
      expect(stripAuthCookies('lilnas-auth=a; lilnas-authx=b')).toBe(
        'lilnas-auth=a; lilnas-authx=b',
      )
    })

    it('keeps values containing "=", "%" and quotes byte for byte', () => {
      const header =
        'a=b=c==; q="quoted value"; p=%7B%22x%22%3A1%7D%3D; z=a%3Db'
      expect(stripAuthCookies(header)).toBe(header)
    })

    it('keeps pairs with no "=" unchanged', () => {
      expect(stripAuthCookies('flag; lilnas-auth.session_token=a; other')).toBe(
        'flag; other',
      )
    })

    it('preserves the original order', () => {
      expect(
        stripAuthCookies('c=3; lilnas-auth.session_token=x; a=1; b=2'),
      ).toBe('c=3; a=1; b=2')
    })

    it('trims kept pairs and re-joins with "; ", dropping empty segments', () => {
      expect(stripAuthCookies('  a=1 ;;  b=2;   ;c=3  ')).toBe('a=1; b=2; c=3')
    })

    it('keeps a cookie whose value contains the text of a stripped cookie', () => {
      expect(
        stripAuthCookies(
          'redirect=lilnas-auth.session_token=abc; lilnas-auth.session_token=real; trail=__Secure-lilnas-auth.session_token=zzz',
        ),
      ).toBe(
        'redirect=lilnas-auth.session_token=abc; trail=__Secure-lilnas-auth.session_token=zzz',
      )
    })
  })

  describe('large headers', () => {
    it('handles a 4 KB header, stripping only the auth cookies', () => {
      const big = 'v'.repeat(1500)
      const header = [
        `a=${big}`,
        `lilnas-auth.session_token=${'s'.repeat(600)}`,
        `b=${big}`,
        `__Secure-lilnas-auth.session_data=${'d'.repeat(500)}`,
        'c=3',
      ].join('; ')
      expect(header.length).toBeGreaterThan(4096)

      expect(stripAuthCookies(header)).toBe(`a=${big}; b=${big}; c=3`)
    })
  })
})
