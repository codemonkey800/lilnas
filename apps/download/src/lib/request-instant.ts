import { cache } from 'react'

/**
 * The instant this request is being rendered at, in epoch milliseconds.
 *
 * Every relative timestamp the server renders has to be measured against one
 * pinned instant, for two separate reasons:
 *
 *   - **Hydration.** `formatRelative`'s default `now` is `Date.now()`, read
 *     once while the HTML is built and again while the browser hydrates. A row
 *     that straddles a minute boundary between those two reads is served
 *     `'12m ago'` and re-rendered `'13m ago'`, which React reports as a
 *     hydration mismatch. Passing a server instant down means the client never
 *     computes one.
 *   - **Coherence.** A grid whose rows each called `Date.now()` could show two
 *     rows added in the same second as `'59m ago'` and `'1h ago'`.
 *
 * `cache()` rather than a bare function so that every server component in one
 * request agrees on the answer without threading it through props from the
 * top. Outside a React server request scope `cache` does not memoize at all —
 * it degrades to calling through, which is still a correct clock and is why
 * nothing here depends on the memoization being observable.
 *
 * It also keeps the impure call out of any component body, which
 * `react-hooks/purity` (an error in this package) refuses outright.
 */
export const getRequestInstant: () => number = cache(() => Date.now())
