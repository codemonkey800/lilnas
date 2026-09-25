'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'
import { useRef, useState } from 'react'

import { FilterPanel } from 'src/components/ui/filters'

/**
 * The Discord brand mark, inlined rather than referenced through `Icon`.
 *
 * `ICON_NAMES`/`IconSprite` carry no `discord` symbol yet — the sprite in
 * `docs/features/download/designs/src/layout/sprite.html` has `i-discord` but
 * `src/components/ui/sprite.tsx` was ported before it existed, and a
 * `<use href="#i-discord">` against a sprite that lacks the symbol paints
 * nothing at all, silently. Drawing it here keeps this component self-contained
 * and correct on its own; promoting it into the sprite later is a pure
 * substitution. The path is Simple Icons' Discord glyph, byte-identical to the
 * design sprite's copy (`react-icons`' `SiDiscord`), and must not be redrawn.
 *
 * Decorative: the trigger around it carries the accessible name.
 */
function DiscordGlyph(): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      className="h-3 w-3 shrink-0"
      focusable="false"
      viewBox="0 0 24 24"
    >
      <path
        d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z"
        fill="currentColor"
      />
    </svg>
  )
}

/**
 * `relative` so the popover can anchor to the mark rather than to whatever
 * cell, row or card it was dropped into. `inline-flex` keeps it a phrasing-level
 * item beside a username, and `shrink-0` keeps the 12px glyph from being
 * squeezed out by a `truncate`d name in a narrow column.
 */
const ROOT = 'relative inline-flex shrink-0 items-center'

/**
 * `admin-actor.tsx`'s `PROFILE_LINK` technique, verbatim and for the same
 * reason: the glyph is 12px, which is the right *weight* for a secondary mark
 * and the wrong *size* for a finger. `before:-inset-1.5` grows the hit area to
 * 24x24 (WCAG 2.5.8) without the visible glyph or the row's rhythm changing —
 * padding would have moved the username beside it.
 */
const TRIGGER = cns(
  'relative inline-flex shrink-0 items-center text-ink-4',
  'transition-colors duration-200 ease-uv hover:text-ink-2',
  'before:absolute before:-inset-1.5',
)

/**
 * Overrides `FilterPanel`'s own padding, width and surface for a two-line
 * popover, and positions it under the mark.
 *
 * - Centred on the trigger (`left-1/2 -translate-x-1/2`) rather than
 *   left-aligned: the panel is far wider than its 12px trigger, and centring
 *   halves the worst-case overhang on either side. That matters because the
 *   consumers are a table cell, a three-part audit row and a ~158px gallery
 *   card — a left-anchored panel on a right-hand column runs off the viewport.
 * - `w-max` with a viewport-relative cap, so the snowflake sets the width on a
 *   roomy surface and the panel still cannot exceed the screen on a phone.
 * - `z-30` clears the `z-20` a `FilterPanel` popover wrapper uses elsewhere, so
 *   a mark inside a filtered list does not render under the filter panel.
 *
 * ⚠️ Absolute positioning escapes a card's box but not an ancestor's
 * `overflow: hidden`. None of the current consumers clip (`GalleryCard` and
 * `Card` set no overflow), but a future one that does will need
 * `panelClassName` to re-anchor, or a portal.
 */
const PANEL = cns(
  'absolute top-[calc(100%+9px)] left-1/2 z-30 -translate-x-1/2',
  'flex w-max max-w-[min(15rem,calc(100vw-2rem))] flex-col gap-[9px]',
  'border-line-loud bg-surface-3 px-3 py-2.5',
)

const FIELD = 'flex flex-col gap-[3px]'

const FIELD_LABEL = 'font-mono text-label uppercase text-ink-4'

const FIELD_VALUE = 'font-mono text-mono-sm text-ink-2'

/**
 * `select-all` makes one click select the whole snowflake, which is 18–19
 * digits of nothing memorable and is not retyped correctly by anyone.
 *
 * ⚠️ It is **not** copied anywhere to link the account. Linking lives in
 * `apps/auth`'s admin panel (`src/app/admin/discord-links-panel.tsx`) and is
 * two pick-from-a-list columns of radio rows — a person on the left, an
 * observed Discord account on the right, then Link. No snowflake and no handle
 * is ever typed there; the only text inputs are optional client-side filters
 * over the two lists, and they match on name/email and handle/display name,
 * never on the id.
 *
 * The id is disclosed anyway because it is the *stable* identity: the handle
 * beside it is a cache of a name its owner can change at will, so the
 * snowflake is the only value here that still names this requester after a
 * rename, and the only one that separates two similar-looking handles when an
 * admin goes looking for the matching row in that picker.
 *
 * `break-all` lets it wrap rather than widen the panel past the viewport cap on
 * a phone.
 */
const FIELD_ID = cns(FIELD_VALUE, 'break-all select-all')

const NOTE = 'text-cap text-ink-4'

/** The panel's one line of context — why this identity is raw Discord at all. */
export const DISCORD_UNLINKED_NOTE = 'No lilnas account linked yet'

export type DiscordIdentityMarkProps = {
  /**
   * Overrides on the trigger button — colour or spacing for a surface that
   * needs the mark a step louder or quieter.
   */
  className?: string
  /**
   * The raw Discord snowflake, **always a string**: snowflakes exceed
   * `Number.MAX_SAFE_INTEGER`, so a number would silently round. Rendered in
   * full and never abbreviated — a truncated id identifies nobody.
   */
  discordUserId: string
  /** The requester's current Discord handle, without the leading `@`. */
  discordUsername: string
  /**
   * Overrides on the popover — positioning, for a surface whose edges the
   * default centred anchor does not suit.
   */
  panelClassName?: string
}

/**
 * The mark beside an unlinked Discord requester: a Discord glyph that discloses
 * the two facts the glyph alone cannot — the current handle and the raw
 * snowflake.
 *
 * ⚠️ **A real `<button>`, opened by click or tap.** A `title` tooltip (or any
 * other hover-only affordance) was rejected outright: it is invisible until
 * hovered, announced inconsistently by screen readers, and simply unreachable
 * on a touch device, which is most of this app's traffic. Click/tap is the
 * baseline and behaves identically at both breakpoints — there is no hover path
 * and therefore no mobile special case bolted onto one.
 *
 * The open/close model is not re-implemented here: `open`, `onOpenChange` and
 * `triggerRef` hand it to `FilterPanel`'s popover mode, which already does
 * Escape-closes-and-returns-focus, outside-press-closes, tab-out-closes,
 * focus-to-the-panel-rather-than-its-first-control and — deliberately — no
 * focus trap. Only padding, width, surface and position are overridden.
 *
 * ⚠️ **Masking outranks disclosure.** A job with `hiddenAttribution` renders as
 * `hidden` and must not render this mark *at all* — no trigger, no snowflake in
 * the DOM. That gate belongs to the caller; this component renders nothing on
 * its own behalf when it is not mounted, and stashes the snowflake in no
 * attribute of any always-present wrapper.
 */
export function DiscordIdentityMark({
  className,
  discordUserId,
  discordUsername,
  panelClassName,
}: DiscordIdentityMarkProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  // Names what the button reveals, not what it is: "Discord" alone leaves a
  // screen-reader user meeting a row of these with no idea which one they are
  // on. The handle is the thing that tells them apart.
  const label = `Discord account details for ${discordUsername}`

  return (
    <span className={ROOT}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={label}
        className={cns(TRIGGER, open && 'text-ink-2', className)}
        type="button"
        onClick={() => setOpen(current => !current)}
      >
        <DiscordGlyph />
      </button>
      <FilterPanel
        aria-label={label}
        className={cns(PANEL, panelClassName)}
        open={open}
        triggerRef={triggerRef}
        onOpenChange={setOpen}
      >
        <span className={FIELD}>
          <span className={FIELD_LABEL}>handle</span>
          <span className={FIELD_VALUE}>{`@${discordUsername}`}</span>
        </span>
        <span className={FIELD}>
          <span className={FIELD_LABEL}>discord id</span>
          <span className={FIELD_ID}>{discordUserId}</span>
        </span>
        <span className={NOTE}>{DISCORD_UNLINKED_NOTE}</span>
      </FilterPanel>
    </span>
  )
}
