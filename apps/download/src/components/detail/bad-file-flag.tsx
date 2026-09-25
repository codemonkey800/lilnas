'use client'

import { cns } from '@lilnas/utils/cns'
import type { BadFile, FlagBadFileInput } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX, ReactNode } from 'react'
import { useState, useTransition } from 'react'

import type { BadFileActionResult } from 'src/app/actions/media-files'
import { Button } from 'src/components/ui/button'
import type { ButtonSize, ButtonVariant } from 'src/components/ui/button-recipe'
import { Chip } from 'src/components/ui/chip'
import { Modal, Reason, ReasonGroup } from 'src/components/ui/modal'

/**
 * The label on the trigger, in the one place it is spelled.
 *
 * "Report a problem", never "Flag" or "Blacklist" — `movie-detail.pug`'s own
 * wording, and the register the reason list is written in. The user is
 * describing what they saw, not naming a mechanism.
 */
export const REPORT_LABEL = 'Report a problem'

/** The dialog heading for a movie's file. `movie-detail.pug:122`. */
export const REPORT_PROMPT = "What's wrong with this file?"

/** The dialog heading for one episode. `show-detail.pug:157`. */
export const REPORT_PROMPT_EPISODE = "What's wrong with this episode?"

/**
 * Plain language, not error codes — the user is telling us what they saw.
 * `movie-detail.mjs`'s `REASONS`, verbatim.
 */
export const REPORT_REASONS: readonly string[] = [
  'Wrong audio or subtitles',
  "Video won't play",
  'Not this movie',
]

/** The show variant — `show-detail.mjs` swaps the third reason. */
export const REPORT_REASONS_EPISODE: readonly string[] = [
  'Wrong audio or subtitles',
  "Video won't play",
  'Wrong episode',
]

/**
 * ⚠️ What the flag actually does, said exactly.
 *
 * `movie-detail.pug`'s storyboard caption is "This release won't be auto-picked
 * again", which claims more than the flag delivers: it lives in this app's
 * `bad_files` table and is joined on in `ReleaseService.listReleases()`.
 * Radarr's and Sonarr's own selection logic is untouched, so a search started
 * from *their* UI can still re-pick the release — the spec's accepted gap (§6),
 * also written into `BadFile`'s own doc comment.
 *
 * Concrete rather than hedged, because the user's next move depends on it: if
 * the same bad file keeps coming back, the place to fix it is Radarr/Sonarr,
 * not here.
 */
export const REPORT_SCOPE_CAVEAT =
  "This app won't pick this release again. Radarr and Sonarr can still grab it from their own interfaces."

/** The chip that replaces the trigger once a release is reported. */
export const REPORTED_LABEL = 'reported'

/** The trigger offered back when the report can be taken away again. */
export const UNDO_REPORT_LABEL = 'Undo report'

export const SUBMIT_REPORT_LABEL = 'Submit report'

const CANCEL_LABEL = 'Cancel'

/**
 * The error idiom `search.pug` established and `start-video-download.ts`
 * writes to: a mono clause rather than a paragraph, sitting directly under the
 * control that failed.
 */
const ERROR_LINE = 'font-mono text-[11px] text-bad'

/** The storyboard's step-3 caption. A sentence, so `ink-3` and never `ink-4`. */
const CAVEAT_LINE = 'text-cap text-ink-3'

/**
 * Just enough of a release to report one.
 *
 * Deliberately a `Pick` of {@link FlagBadFileInput} rather than of `Release`:
 * `indexerId`/`title` are denormalized copies kept so a flag stays readable
 * after the release ages out of the indexer, and a caller holding only a
 * `BadFile` — an already-reported row with no live `Release` behind it — can
 * still satisfy this.
 */
export type BadFileRelease = Pick<
  FlagBadFileInput,
  'guid' | 'indexerId' | 'title'
>

/**
 * What a page hands over for the report itself.
 *
 * Takes `mediaId` rather than closing over one — the shape `JobAction` uses,
 * for the same reason: `src/app/actions/media-files.ts` exports
 * `flagBadFile(mediaId, input)` unbound, the page passes that reference
 * straight through, and the component calls it with the title it is actually
 * rendering. Nothing needs `.bind()` on the server, and there is no second
 * place for the two to disagree about which title is being reported.
 *
 * `void` is accepted alongside a result so a client-side handler or a test spy
 * is assignable too. A resolved value with no `error` in it is success —
 * *including* the original row an idempotent re-flag hands back.
 */
export type FlagBadFileAction = (
  mediaId: string,
  input: FlagBadFileInput,
) => Promise<BadFileActionResult | void> | void

/** The inverse. `flagId` is `BadFile.id`, so undo needs the row, not the guid. */
export type UnflagBadFileAction = (
  mediaId: string,
  flagId: number,
) => Promise<BadFileActionResult | void> | void

/**
 * `onSubmit` and `title` are real `<div>` attributes whose names this
 * component wants for its own meaning, exactly as `SaveLocal` removes `media`
 * and `part`. Left in, each intersects to an impossible type at every call
 * site.
 */
export type BadFileFlagProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children' | 'onSubmit' | 'title'
> & {
  /**
   * The flag this release already carries, when the page knows of one —
   * `client.listBadFiles(id)`, joined to the release on `releaseGuid`.
   * Non-null renders the reported state straight away with no trigger at all,
   * so a second report is not merely refused but structurally unreachable.
   */
  flag?: BadFile | null
  /** Stretch the trigger and the root to the container width. */
  full?: boolean
  /** Overrides {@link REPORT_LABEL}. */
  label?: string
  /** The `mediaId()` key — `tmdb:438631`, `tvdb:121361`. */
  mediaId: string
  /**
   * Stack the dialog's buttons and stretch them, which is the mockups' mobile
   * frame. A layout switch rather than a breakpoint, matching `StateLine`.
   */
  mobile?: boolean
  onFlag?: FlagBadFileAction
  /** Omitted renders no undo affordance at all. */
  onUnflag?: UnflagBadFileAction
  /**
   * The dialog heading. Defaults to {@link REPORT_PROMPT}; a show passes
   * {@link REPORT_PROMPT_EPISODE}.
   */
  prompt?: ReactNode
  /**
   * The reason list. Defaults to {@link REPORT_REASONS}; a show passes
   * {@link REPORT_REASONS_EPISODE}. The first entry starts chosen, as
   * `movie-detail.pug` draws it, so the dialog always has an answer to submit.
   */
  reasons?: readonly string[]
  release: BadFileRelease
  /** Size for the trigger. Defaults to the mockups' `sm`. */
  size?: ButtonSize
  /** Weight for the trigger. Defaults to the mockups' `ghost`. */
  variant?: ButtonVariant
}

/** `null` until this component has reported; `badFile` is `null` if the action returned nothing. */
type Reported = { badFile: BadFile | null }

/**
 * "This file is wrong" — the trigger, the reason dialog, and the reported
 * state it settles into.
 *
 * Ports `movie-detail.pug`'s `reportModal` and the three-step storyboard beside
 * it (trigger → pick a reason → confirmed), which is why the confirmed state is
 * a `reported` chip with a caption rather than a toast: the mockups settle in
 * place, and the row the user was looking at is the right place for the answer.
 *
 * Two behaviours worth stating, both of which follow from the backend rather
 * than from taste:
 *
 * - **A repeat report is a success, not an error.** `POST …/bad-files` is
 *   idempotent on `(mediaId, releaseGuid)` and answers a re-flag with the
 *   *original* row. There is no "already reported" branch here, because the
 *   backend draws none and inventing one client-side would mean guessing from
 *   a timestamp.
 * - **The scope caveat is not decoration.** See {@link REPORT_SCOPE_CAVEAT}:
 *   the exclusion is this app's only, and the dialog says so *before* the user
 *   submits rather than overselling it afterwards.
 *
 * The root is always a `<div>`, in both states, so `className` and every
 * escape-hatch prop mean one thing. In a flex row it shrink-wraps the trigger
 * and is visually free; where it has to stretch (a stacked `StateLineActions`,
 * whose `[&>button]` selector cannot reach through a wrapper), pass `full`.
 */
export function BadFileFlag({
  className,
  flag,
  full = false,
  label = REPORT_LABEL,
  mediaId,
  mobile = false,
  onFlag,
  onUnflag,
  prompt = REPORT_PROMPT,
  reasons = REPORT_REASONS,
  release,
  size = 'sm',
  variant = 'ghost',
  ...props
}: BadFileFlagProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [reported, setReported] = useState<Reported | null>(null)
  const [reason, setReason] = useState<string | undefined>(reasons[0])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  // The prop is the page's knowledge, the state is this component's, and the
  // union of the two is "reported" — which also means a local report survives
  // the page's own revalidate arriving a beat later. Pass a `key` to reset;
  // never a `useEffect` + `setState`, which this package lints as an error.
  const existing = reported?.badFile ?? flag ?? null
  const isReported = reported !== null || flag != null

  function close(): void {
    setOpen(false)
    setError(null)
  }

  function submit(): void {
    if (!onFlag) {
      return
    }

    setError(null)

    startTransition(async () => {
      const result = await onFlag(mediaId, {
        guid: release.guid,
        indexerId: release.indexerId,
        reason,
        title: release.title,
      })

      if (result && 'error' in result) {
        setError(result.error)

        return
      }

      // Anything that is not an error is a success — including the original
      // row an idempotent re-flag hands back.
      setReported({
        badFile: result && 'badFile' in result ? result.badFile : null,
      })
      setOpen(false)
    })
  }

  function undo(): void {
    if (!onUnflag || existing == null) {
      return
    }

    setError(null)

    startTransition(async () => {
      const result = await onUnflag(mediaId, existing.id)

      if (result && 'error' in result) {
        setError(result.error)

        return
      }

      setReported(null)
    })
  }

  if (isReported) {
    return (
      <div
        {...props}
        className={cns(
          'flex flex-wrap items-center gap-2.5',
          full && 'w-full',
          className,
        )}
        data-reported="true"
      >
        <Chip className={cns('w-fit')} label={REPORTED_LABEL} tone="mute" />
        <span className={cns('min-w-0 flex-1', CAVEAT_LINE)}>
          {REPORT_SCOPE_CAVEAT}
        </span>
        {onUnflag && existing != null ? (
          <Button
            aria-disabled={pending || undefined}
            size={size}
            variant="ghost"
            onClick={undo}
          >
            {UNDO_REPORT_LABEL}
          </Button>
        ) : null}
        {error ? (
          <p className={cns('w-full', ERROR_LINE)} role="alert">
            {error}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <div {...props} className={cns(full && 'w-full', className)}>
      <Button
        full={full}
        iconEnd="flag"
        size={size}
        variant={variant}
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>
      <Modal open={open} title={prompt} onClose={close}>
        {/*
          `ReasonGroup` carries no layout of its own and has to be named from
          here — `Modal` owns its title's generated id and does not expose it,
          so `aria-label` is the reachable half of that contract.
        */}
        <ReasonGroup
          aria-label={typeof prompt === 'string' ? prompt : REPORT_PROMPT}
          value={reason}
          onValueChange={setReason}
        >
          {reasons.map(entry => (
            <Reason key={entry} value={entry}>
              {entry}
            </Reason>
          ))}
        </ReasonGroup>
        {/*
          Said before submitting, not after. The storyboard's step-3 caption
          claims more than the flag delivers; this is that sentence corrected,
          and moved to where it can still change the user's mind.
        */}
        <p className={cns('mt-2.5', CAVEAT_LINE)}>{REPORT_SCOPE_CAVEAT}</p>
        {error ? (
          <p className={cns('mt-2', ERROR_LINE)} role="alert">
            {error}
          </p>
        ) : null}
        <div
          className={cns(
            'mt-4 flex gap-2',
            mobile ? 'flex-col' : 'justify-end',
          )}
        >
          {mobile ? (
            <>
              <Button
                aria-disabled={pending || undefined}
                full
                size="sm"
                variant="uv"
                onClick={submit}
              >
                {SUBMIT_REPORT_LABEL}
              </Button>
              <Button full size="sm" variant="ghost" onClick={close}>
                {CANCEL_LABEL}
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="ghost" onClick={close}>
                {CANCEL_LABEL}
              </Button>
              <Button
                aria-disabled={pending || undefined}
                size="sm"
                variant="uv"
                onClick={submit}
              >
                {SUBMIT_REPORT_LABEL}
              </Button>
            </>
          )}
        </div>
      </Modal>
    </div>
  )
}
