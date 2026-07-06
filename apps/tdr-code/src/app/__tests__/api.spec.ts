// Tests src/app/lib/api.ts's redirect-on-401 handler — kept as its own file
// (a defensible small deviation from the plan's literal two-file list,
// login.spec.tsx + middleware.spec.ts) because this logic is a genuinely
// separate concern from the login PAGE component: it's the second of the
// "three cooperating gates" (middleware.ts's cookie-presence check ->
// api.ts's redirect-on-401 -> the NestJS guard, which is authoritative),
// and grouping it here keeps login.spec.tsx focused on rendering/DOM
// behavior rather than mixing in fetch-mocking concerns.
//
// This runs under the BACKEND (node) jest project, not the frontend
// (jsdom) one — api.ts's request() function is plain fetch-wrapping logic
// with no DOM dependency, and Node's native fetch/Request/Response globals
// (available without any import) are exactly what a real browser's fetch()
// call shape looks like, same reasoning as middleware.spec.ts's project
// placement (see jest.config.js's header comment).
//
// Every test below loads api.ts through `jest.isolateModulesAsync` rather
// than a single top-level `import`. api.ts's redirect-storm guard
// (`hasRedirectedForSessionExpiry`) is a deliberately-never-reset
// MODULE-SCOPED flag (see api.ts's own comment: "a redirect that's already
// underway supersedes anything else this page would otherwise do") — that's
// correct for a real browser page (which gets torn down by the first
// redirect and never runs this module again), but it means a shared,
// statically-imported module instance would leak that latched state across
// otherwise-independent test cases in this same file (confirmed
// empirically: without isolation, the "storm" test observed ZERO redirects
// because the flag was already tripped by an earlier test in file order).
// `jest.isolateModulesAsync` gives each test a fresh require-cache scope so
// each one starts from `hasRedirectedForSessionExpiry === false`, matching
// what actually happens on every real page load.
//
// U15: the second describe block below (param-encoding regression) tests
// logTailUrl/api.searchLog/api.readLogWindow instead — none of those three
// touch the redirect-storm latch at all (they only ever build a URL/call
// fetch once each), so they are imported statically like any ordinary
// module rather than through the isolateModulesAsync+require dance above,
// which exists solely to work around that ONE stateful flag.
import type { fetchJson as FetchJsonType } from 'src/app/lib/api'
import { api, logTailUrl } from 'src/app/lib/api'
import type { LogStream, LogWindowDirection } from 'src/logging/log-view.types'

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

async function loadFetchJson(): Promise<typeof FetchJsonType> {
  let fetchJson!: typeof FetchJsonType
  await jest.isolateModulesAsync(async () => {
    // Must be a dynamic require() inside isolateModulesAsync's callback —
    // this is the one place in this unit's tests where require() is
    // genuinely necessary rather than a static top-level import: it has to
    // resolve against the FRESH, isolated module registry
    // isolateModulesAsync creates for this call only, which a
    // module-load-time static `import` (resolved once, before any test
    // runs, against Jest's normal shared registry) cannot do.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ;({ fetchJson } = require('src/app/lib/api') as {
      fetchJson: typeof FetchJsonType
    })
  })
  return fetchJson
}

describe('api.ts redirect-on-401', () => {
  let fetchSpy: jest.SpiedFunction<typeof fetch>
  let hrefValues: string[]

  beforeEach(() => {
    fetchSpy = jest.spyOn(global, 'fetch')
    hrefValues = []
    // window is not defined under the backend (node) test environment —
    // api.ts's redirect path reads/writes `window.location.href`, so a
    // minimal stand-in is installed for exactly this file's tests rather
    // than switching this test to the jsdom project (which would
    // reintroduce the exact "Request is not defined" problem this file's
    // project placement avoids — see the header comment above).
    ;(global as unknown as { window: unknown }).window = {
      location: {
        get href() {
          return hrefValues.at(-1) ?? ''
        },
        set href(value: string) {
          hrefValues.push(value)
        },
      },
    }
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    delete (global as unknown as { window?: unknown }).window
  })

  it('redirects to /login?error=session_expired on a 401 and never settles the promise', async () => {
    const fetchJson = await loadFetchJson()
    fetchSpy.mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, 401))

    const settled = { value: false }
    // Deliberately never awaited: api.ts's 401 path returns a promise that
    // never resolves or rejects by design (see api.ts's own header
    // comment), so awaiting it here would hang the test forever.
    fetchJson('/live').then(
      () => {
        settled.value = true
      },
      () => {
        settled.value = true
      },
    )

    // Give the microtask queue a few turns so the redirect side effect
    // (which happens inside request()'s own async body, not after an
    // additional await this test controls) has a chance to run before
    // asserting on it.
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(hrefValues).toEqual(['/login?error=session_expired'])
    expect(settled.value).toBe(false)
  })

  it('collapses a 401 storm (4 concurrent calls, mirroring the 4 real refetchInterval:5_000 call sites) into exactly ONE redirect', async () => {
    const fetchJson = await loadFetchJson()
    fetchSpy.mockResolvedValue(jsonResponse({ message: 'Unauthorized' }, 401))

    fetchJson('/live')

    fetchJson('/config')

    fetchJson('/bot/status')

    fetchJson('/sessions/1')

    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(hrefValues).toHaveLength(1)
    expect(hrefValues[0]).toBe('/login?error=session_expired')
  })

  it('still throws (does not redirect) for a non-401 error status, preserving the existing inline ErrorState/text-red-400 UI contract', async () => {
    const fetchJson = await loadFetchJson()
    fetchSpy.mockResolvedValue(
      jsonResponse({ message: 'Something broke' }, 500),
    )

    await expect(fetchJson('/live')).rejects.toThrow('Something broke')
    expect(hrefValues).toEqual([])
  })

  it('does not redirect and resolves normally on a 200', async () => {
    const fetchJson = await loadFetchJson()
    fetchSpy.mockResolvedValue(jsonResponse({ ok: true }, 200))

    await expect(fetchJson('/live')).resolves.toEqual({ ok: true })
    expect(hrefValues).toEqual([])
  })

  it('a 401 followed by a later non-401 call from a DIFFERENT poll still does not re-redirect (storm flag stays latched)', async () => {
    const fetchJson = await loadFetchJson()
    fetchSpy.mockResolvedValueOnce(jsonResponse({}, 401))
    fetchSpy.mockResolvedValueOnce(jsonResponse({ ok: true }, 200))

    fetchJson('/live')
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(hrefValues).toHaveLength(1)

    // A second, unrelated call after the redirect has already fired (e.g.
    // a poll that was already in-flight when the first 401 landed and
    // resolves moments later with a 200) must not add a second redirect —
    // the flag is a one-way latch, matching the real-world fact that the
    // page is about to be torn down by the first redirect regardless. This
    // reuses the SAME isolated module instance from this test's own
    // loadFetchJson() call (not a fresh one), which is what proves the
    // latch actually holds across calls rather than just across test
    // boundaries.
    await fetchJson('/config')
    expect(hrefValues).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────
// U15: param-encoding regression — the REVIEW.md "param-encoding footgun"
// this plan repeatedly references. Before this suite, no test actually fed
// a value containing a URL-special character (&, =, #, a space, or a
// literal %) through logTailUrl/api.searchLog/api.readLogWindow and
// asserted the resulting URL round-trips correctly — every existing
// api.ts-adjacent test either used plain alphanumeric fixture values (which
// would pass identically whether or not URLSearchParams' automatic encoding
// were actually wired up) or didn't touch these three functions at all.
// This closes that gap by proving BOTH halves of the round-trip: (1) the
// constructed URL string itself is properly percent-encoded (never a raw
// '&'/'='/'#'/' '/'%' character leaking into the query string, which would
// silently truncate or corrupt the query on a real server), and (2) decoding
// that same URL with URLSearchParams recovers the EXACT original value byte-
// for-byte — proving the encoding is not just "present" but actually
// correct and reversible.
//
// LogStream/LogWindowDirection are closed string-literal unions in normal
// usage (never truly free text), so `as LogStream`/`as LogWindowDirection`
// casts below deliberately inject an out-of-union value into each
// function's `stream`/`direction` parameter — not because a real caller
// would ever do this, but because it is the only way to prove these
// functions rely on URLSearchParams' OWN encoding rather than silently
// assuming every caller only ever passes a pre-vetted enum member. The
// genuinely free-text fields already in the real type (LogScanPredicate's
// `text`/`event` on searchLog) are exercised as themselves, no cast needed.
describe('U15: param encoding — logTailUrl / api.searchLog / api.readLogWindow round-trip URL-special characters', () => {
  const SPECIAL_VALUE = 'a&b=c#d e%f'

  function decodeQueryParam(url: string, key: string): string | null {
    const qIndex = url.indexOf('?')
    const qs = qIndex === -1 ? '' : url.slice(qIndex + 1)
    return new URLSearchParams(qs).get(key)
  }

  describe('logTailUrl', () => {
    it('percent-encodes a special-character stream value and decodes back to the exact original', () => {
      const url = logTailUrl(SPECIAL_VALUE as LogStream, 42)

      // The raw query string itself must never contain an unescaped '&' or
      // '#' from the value (those would otherwise be parsed as a query
      // separator / fragment delimiter, corrupting the request).
      const [, queryPart] = url.split('?')
      expect(queryPart).toBeDefined()
      expect(queryPart).not.toContain('a&b') // the raw '&' must be encoded
      expect(queryPart).not.toMatch(/(?<!%23)#/) // no raw '#' either

      expect(decodeQueryParam(url, 'stream')).toBe(SPECIAL_VALUE)
      expect(decodeQueryParam(url, 'from')).toBe('42')
    })

    it('omits `from` entirely (not `from=undefined`) when absent, independent of the stream value’s own encoding', () => {
      const url = logTailUrl(SPECIAL_VALUE as LogStream)
      expect(url).not.toContain('from=')
      expect(decodeQueryParam(url, 'stream')).toBe(SPECIAL_VALUE)
    })
  })

  describe('api.searchLog', () => {
    let fetchSpy: jest.SpiedFunction<typeof fetch>

    beforeEach(() => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({ total: 0, matches: [], nextCursor: null }),
          {
            status: 200,
            headers: { 'content-type': 'application/json' },
          },
        ),
      )
    })

    afterEach(() => {
      fetchSpy.mockRestore()
    })

    it('percent-encodes special characters in `text` and `event` and both decode back to the exact original', async () => {
      await api.searchLog({
        stream: 'backend',
        text: SPECIAL_VALUE,
        event: SPECIAL_VALUE,
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const requestedUrl = fetchSpy.mock.calls[0]?.[0] as string
      expect(requestedUrl).toContain('/api/logs/search?')
      const [, queryPart] = requestedUrl.split('?')
      expect(queryPart).not.toContain('a&b')
      expect(queryPart).not.toMatch(/(?<!%23)#/)

      expect(decodeQueryParam(requestedUrl, 'text')).toBe(SPECIAL_VALUE)
      expect(decodeQueryParam(requestedUrl, 'event')).toBe(SPECIAL_VALUE)
      expect(decodeQueryParam(requestedUrl, 'stream')).toBe('backend')
    })

    it('percent-encodes a special-character cursor value and decodes back to the exact original', async () => {
      const specialCursor = '100&200#300 400%500'
      await api.searchLog({ stream: 'backend', cursor: specialCursor })

      const requestedUrl = fetchSpy.mock.calls[0]?.[0] as string
      expect(decodeQueryParam(requestedUrl, 'cursor')).toBe(specialCursor)
    })
  })

  describe('api.readLogWindow', () => {
    let fetchSpy: jest.SpiedFunction<typeof fetch>

    beforeEach(() => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            stream: 'backend',
            fileSize: 0,
            windowStart: 0,
            windowEnd: 0,
            atStart: true,
            atEnd: true,
            lines: [],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
      )
    })

    afterEach(() => {
      fetchSpy.mockRestore()
    })

    it('percent-encodes a special-character direction value (the closest free-value field this function exposes) and decodes back to the exact original', async () => {
      // stream/anchor/maxBytes are typed as an enum/numbers with no
      // meaningful "special character" case of their own — `direction` is
      // exercised here via the same as-cast rationale as logTailUrl's
      // stream test above, to prove readLogWindow's OWN `.set()` call for
      // this field goes through URLSearchParams' encoding rather than
      // assuming the value is always a safe, pre-vetted literal.
      await api.readLogWindow({
        stream: 'backend',
        anchor: 123,
        direction: SPECIAL_VALUE as LogWindowDirection,
      })

      expect(fetchSpy).toHaveBeenCalledTimes(1)
      const requestedUrl = fetchSpy.mock.calls[0]?.[0] as string
      expect(requestedUrl).toContain('/api/logs/window?')
      const [, queryPart] = requestedUrl.split('?')
      expect(queryPart).not.toContain('a&b')
      expect(queryPart).not.toMatch(/(?<!%23)#/)

      expect(decodeQueryParam(requestedUrl, 'direction')).toBe(SPECIAL_VALUE)
      expect(decodeQueryParam(requestedUrl, 'stream')).toBe('backend')
      expect(decodeQueryParam(requestedUrl, 'anchor')).toBe('123')
    })
  })
})
