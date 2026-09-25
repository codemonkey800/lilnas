'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX, ReactNode } from 'react'

import { IMPORT_TRIGGER_LABEL } from 'src/components/detail/import-dialog'
import type { JobActionKey } from 'src/components/detail/job-state'
import type { ButtonVariant } from 'src/components/ui/button-recipe'
import type { IconName } from 'src/components/ui/icon'

/**
 * The job action pieces — what a page hands over for a job action, what each
 * control looks like and in what order, and the row they sit in. `AttemptList`
 * renders them; `show-episode-row.tsx` and `video-detail.tsx` borrow single
 * pieces. Which of them a given job offers is never decided here: that is
 * `jobActionState` in `job-state.ts`.
 */

/**
 * What a page hands over for one of the four mutating actions.
 *
 * It takes the job id rather than closing over one, which is the whole reason
 * a page never has to pick the job itself: E2's `src/app/actions/video-job.ts`
 * exports plain `(jobId: string) => Promise<void>` server actions, the page
 * passes the unbound reference straight through, and each attempt card calls
 * it with the id of the job it is rendering. There is no second place for the
 * two to disagree about which attempt a press was meant for.
 *
 * `void` as well as `Promise<void>` so a client-side handler (an optimistic
 * store update, a test spy) is assignable too.
 */
export type JobAction = (jobId: string) => Promise<void> | void

export type ActionSpec = {
  iconEnd?: IconName
  key: JobActionKey
  label: string
  variant: ButtonVariant
}

/**
 * Every lifecycle control, in render order, with the label and weight the
 * mockups give it. The order is the mockups' own: pause before cancel on the
 * live video frame, watch before save on the completed one, and the
 * destructive control last everywhere.
 *
 * Which of these appear is never decided here - `jobActionState` decides, per
 * status, and this table only says what each one looks like.
 *
 * ⚠️ `import` is the one entry that is **not** a `Button` bound to a
 * `JobAction`, and it is listed here anyway so that the render order stays one
 * list. Every other control is a single press against a job id; an import is a
 * decision - which of the files that came down should be taken, or none of
 * them - so it needs the media key, the scope and three separate server
 * actions, and it owns a modal to ask in. `ImportDialog` is that control, it
 * arrives on its own `imports` prop rather than through the handler map, and
 * it gets its own branch in each consumer's controls map. `label` and
 * `variant` here still decide what its trigger looks like, exactly as for the
 * rest.
 */
export const ACTION_SPECS: readonly ActionSpec[] = [
  { iconEnd: 'pause', key: 'pause', label: 'Pause', variant: 'outline' },
  { key: 'resume', label: 'Resume', variant: 'uv' },
  { key: 'import', label: IMPORT_TRIGGER_LABEL, variant: 'outline' },
  { key: 'retry', label: 'Retry', variant: 'outline' },
  { iconEnd: 'eye', key: 'watch', label: 'Watch', variant: 'uv' },
  {
    iconEnd: 'device',
    key: 'save',
    label: 'Save to device',
    variant: 'outline',
  },
  { iconEnd: 'x', key: 'cancel', label: 'Cancel', variant: 'bad' },
]

/**
 * Stacked and full-width on a phone, inline from `sm`. Deliberately not
 * `Button`'s own `full`, which is an unconditional `w-full`; these need the
 * width at one breakpoint and not the other, and `w-full` + `sm:w-auto` are
 * different variants, so `twMerge` keeps both.
 */
export const ACTION_BUTTON = 'w-full sm:w-auto'

/**
 * The button row - stacked on a phone, inline from `sm`, which is the same
 * reconciliation `video-detail.pug` writes as two separate frames.
 *
 * ⚠️ Deviation: the desktop mockup nests Pause and Cancel *inside* the
 * progress card, where the mobile one puts them under it. Outside is the only
 * arrangement that generalises - a completed or failed job draws no card at
 * all and its buttons have to sit somewhere - so the row is always the card's
 * sibling, at both widths.
 */
export function ActionRow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <div
      className={cns(
        'flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2.5',
      )}
    >
      {children}
    </div>
  )
}
