import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'

import { NOT_FOUND_TITLE, NotFound } from 'src/components/shell/not-found'

/** `mock.pug`'s `appBody` at both widths, as every other route spells it. */
const PAGE_SHELL = cns(
  'flex-auto px-6 pt-[18px] pb-[30px]',
  'sm:px-8 sm:pt-[30px] sm:pb-11',
)

/**
 * ⚠️ Applied **only** when no route matched at all.
 *
 * A route that reached `notFound()` has already resolved its own metadata, and
 * Next keeps it: `/movies/abc` still reads `Movie · Download` (its
 * `generateMetadata` falls back before the page body refuses the segment) and
 * `/videos/…` still reads `Video · Download`. Verified against the running dev
 * server rather than assumed — Next's docs are silent on whether `not-found`
 * files are a metadata source, and on 15.5.20 they are.
 *
 * Without this, `/nope` renders with an empty `<title>`: the root layout
 * exports no metadata, so there is nothing to inherit.
 */
export const metadata = {
  title: 'Not found · Download',
}

/**
 * The app's global 404.
 *
 * Catches two things, which look the same to a reader and are worth separating
 * here:
 *
 * 1. **A path that matches no route at all** — `/nope`, a stale bookmark, a
 *    mistyped link. Next answers these itself, with a real `404` status.
 * 2. **A `notFound()` thrown by a route with no `not-found.tsx` of its own** —
 *    `/movies/abc` and `/shows/abc`, where `mediaIdFromRoute` refused the
 *    segment. Only `/videos/[videoId]` has a segment-scoped boundary, because
 *    only it has something more specific to say.
 *
 * ⚠️ Case 2 renders this body over an HTTP **200** in the dev server, because
 * those routes stream: the response is committed before the page function gets
 * far enough to throw. Case 1 is a true 404. See the task report; the
 * production-build behaviour is deliberately unconfirmed here.
 *
 * Renders inside the root layout, so the app bar and its search field are still
 * there — which matters, because "search for it instead" is the most useful
 * thing anyone can do from here and the control is already on screen.
 */
export default function RootNotFound(): JSX.Element {
  return (
    <main className={PAGE_SHELL}>
      <div className={cns('mx-auto max-w-[1080px]')}>
        {/*
          `NotFound` renders an `<h2>`, so the route still owes the document its
          own heading — the same call `/profile` makes for `NotAuthorized`.
        */}
        <h1 className="sr-only">{NOT_FOUND_TITLE}</h1>
        <NotFound />
      </div>
    </main>
  )
}
