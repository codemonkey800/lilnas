import { classifyQuery, SEARCH_MIN_LENGTH } from 'src/lib/url-classify'

describe('classifyQuery', () => {
  describe('links', () => {
    it('treats a bare host/path as a link and assumes https', () => {
      expect(classifyQuery('youtube.com/watch?v=7f2k9dQ')).toEqual({
        kind: 'url',
        url: 'https://youtube.com/watch?v=7f2k9dQ',
      })
    })

    it('treats a bare host with no path as a link', () => {
      expect(classifyQuery('youtu.be')).toEqual({
        kind: 'url',
        url: 'https://youtu.be',
      })
    })

    it('keeps a scheme-ful URL exactly as it was pasted', () => {
      // Not `new URL(...).toString()`: the video's identity lives in the query
      // string, and re-serializing it hands yt-dlp a different link.
      const pasted = 'https://www.youtube.com/watch?v=7f2k9dQ&t=90s'

      expect(classifyQuery(pasted)).toEqual({ kind: 'url', url: pasted })
    })

    it('accepts http as well as https', () => {
      expect(classifyQuery('http://example.com/clip.mp4')).toEqual({
        kind: 'url',
        url: 'http://example.com/clip.mp4',
      })
    })

    it('accepts an explicit scheme in front of a host no bare form would allow', () => {
      expect(classifyQuery('http://localhost:8081/clip')).toEqual({
        kind: 'url',
        url: 'http://localhost:8081/clip',
      })
    })

    it('trims surrounding whitespace before classifying', () => {
      expect(classifyQuery('  youtube.com/watch?v=x  ')).toEqual({
        kind: 'url',
        url: 'https://youtube.com/watch?v=x',
      })
    })

    it('is a link however short the rest of the text is', () => {
      // Shorter than a searchable query, but still unambiguously a link.
      expect(classifyQuery('a.co')).toEqual({
        kind: 'url',
        url: 'https://a.co',
      })
    })
  })

  describe('not links', () => {
    it('classifies plain prose as a search', () => {
      expect(classifyQuery('not a url')).toEqual({
        kind: 'search',
        query: 'not a url',
      })
    })

    it('classifies a URL-shaped string with no host as a search', () => {
      // `new URL('https://')` throws — the spec calls this case out by name.
      expect(classifyQuery('https://')).toEqual({
        kind: 'search',
        query: 'https://',
      })
      expect(classifyQuery('http://:8080')).toEqual({
        kind: 'search',
        query: 'http://:8080',
      })
    })

    it('does not treat a single bare word as a link', () => {
      // `new URL('https://office')` parses fine, which is exactly why the
      // classifier needs more than the WHATWG parser to make this call.
      expect(classifyQuery('office')).toEqual({
        kind: 'search',
        query: 'office',
      })
      expect(classifyQuery('youtub')).toEqual({
        kind: 'search',
        query: 'youtub',
      })
    })

    it('never classifies a non-http scheme as a link', () => {
      expect(classifyQuery('javascript:alert(1)')).toEqual({
        kind: 'search',
        query: 'javascript:alert(1)',
      })
      expect(classifyQuery('file:///etc/passwd')).toEqual({
        kind: 'search',
        query: 'file:///etc/passwd',
      })
    })

    it('does not treat an email address as a link', () => {
      expect(classifyQuery('someone@example.com')).toEqual({
        kind: 'search',
        query: 'someone@example.com',
      })
    })

    it('needs an explicit scheme for a bare IP address', () => {
      expect(classifyQuery('192.168.1.5/clip')).toEqual({
        kind: 'search',
        query: '192.168.1.5/clip',
      })
    })
  })

  describe('the 2-character floor', () => {
    it('is idle below the floor', () => {
      expect(SEARCH_MIN_LENGTH).toBe(2)
      expect(classifyQuery('t')).toEqual({ kind: 'idle' })
    })

    it('becomes a search exactly at the floor', () => {
      expect(classifyQuery('th')).toEqual({ kind: 'search', query: 'th' })
    })

    it('is idle for an empty field', () => {
      expect(classifyQuery('')).toEqual({ kind: 'idle' })
    })

    it('is idle for whitespace only, however much of it there is', () => {
      expect(classifyQuery('   ')).toEqual({ kind: 'idle' })
      expect(classifyQuery('\t\n ')).toEqual({ kind: 'idle' })
    })

    it('counts the trimmed length, not the typed length', () => {
      expect(classifyQuery(' t ')).toEqual({ kind: 'idle' })
    })
  })

  it('never fires a network request', () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')

    for (const text of [
      '',
      'y',
      'yo',
      'youtube.com/watch?v=x',
      'https://',
      'the office',
    ]) {
      classifyQuery(text)
    }

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
