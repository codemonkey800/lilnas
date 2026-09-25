import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/**
 * `mock.pug`'s `appBody` at both widths (`px-6 pt-[18px] pb-[30px]` /
 * `px-8 pt-[30px] pb-11`) around `admin-dashboard.pug`'s
 * `mx-auto max-w-[1080px]` column.
 *
 * ⚠️ `<main>` is the scroll container, not `<body>` — see the same note on
 * `GalleryPageShell` and `ActivityPageShell`. The shell's `<body>` is
 * `h-full flex flex-col` with the app bar `shrink-0` above this, and the nav
 * search's mobile overlay is `fixed` against the viewport top, which making the
 * document scroll would slide the bar out from under.
 */
const ADMIN_SHELL = cns(
  'flex-auto overflow-y-auto px-6 pt-[18px] pb-[30px]',
  'sm:px-8 sm:pt-[30px] sm:pb-11',
)

/**
 * The page title. `admin-dashboard.pug` writes it `text-[22px]` on desktop and
 * `text-[20px]` on mobile; `text-h1` is the token those two round to, and the
 * token is what the rest of the app's headings are written in.
 */
export const ADMIN_TITLE = 'mb-4 text-h1 sm:mb-5'

/** The one string the page, its skeleton and its error boundary all title with. */
export const ADMIN_TITLE_TEXT = 'Admin dashboard'

/**
 * What a viewer who is not an admin is told, in place of the dashboard.
 *
 * Here rather than in `app/admin/page.tsx` because a route module's exports are
 * a closed set: Next generates `.next/types/app/admin/page.ts` constraining
 * anything beyond `default`/`metadata`/the route config to `never`, so a stray
 * `export const` in a page is a type error — and one that only appears once the
 * dev server has generated the types for that route.
 */
export const ADMIN_NOT_AUTHORIZED_DESCRIPTION =
  'The admin dashboard — system-wide metrics, the complete download history and the audit trail — is limited to admins.'

/** `text-h2` section headings, at the mockup's two rhythms. */
export const ADMIN_SECTION_HEADING = 'text-h2'

export type AdminPageShellProps = ComponentPropsWithoutRef<'main'>

/**
 * The admin route's page frame, shared by the page itself, its loading skeleton
 * and its error boundary so all three occupy exactly the same column and
 * nothing shifts as one replaces another.
 */
export function AdminPageShell({
  children,
  className,
  ...props
}: AdminPageShellProps): JSX.Element {
  return (
    <main {...props} className={cns(ADMIN_SHELL, className)}>
      <div className="mx-auto max-w-[1080px]">{children}</div>
    </main>
  )
}
