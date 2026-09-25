'use client'

import { cns } from '@lilnas/utils/cns'
import type {
  ComponentPropsWithoutRef,
  ComponentPropsWithRef,
  JSX,
  KeyboardEvent,
  MouseEvent,
  ReactNode,
  RefObject,
} from 'react'
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useSyncExternalStore,
} from 'react'
import { createPortal } from 'react-dom'

import type { ButtonProps } from 'src/components/ui/button'
import { Button } from 'src/components/ui/button'

/**
 * Deviation from `ui.pug`: the mixin is `absolute inset-0`, because the
 * mockups draw the scrim inside their `appFrame` so a modal can be
 * photographed over a cropped page. The real app portals to the document
 * root, where `fixed` is what "cover the viewport" means, and needs a
 * stacking order above the two scrims the system already has (`filterScrim`
 * is `z-10`, `Menu`'s panel `z-20`).
 */
const MODAL_SCRIM = cns(
  'fixed inset-0 z-50 flex items-center justify-center',
  'bg-scrim/62 p-6 backdrop-blur-[2px]',
)

export type ModalScrimProps = ComponentPropsWithRef<'div'>

/**
 * The dimmed, blurred backdrop, and the thing that centres the dialog on it.
 *
 * Exported on its own because it is the whole visual half of the modal
 * pattern; `Modal` renders one of these and supplies the dialog behaviour.
 */
export function ModalScrim({
  className,
  ...props
}: ModalScrimProps): JSX.Element {
  return <div {...props} className={cns(MODAL_SCRIM, className)} />
}

/**
 * ⚠️ Known, pre-approved deviation: `ui.pug:264` caps the panel at 380px and
 * flags in its own comment that `docs/designs/foundations.md` puts the
 * system's modal width at 440px. `patterns.html`'s prose already describes
 * the panel as "capped at the system's 440px modal width", so the mixin is
 * the stale copy. 440px wins.
 */
const MODAL_PANEL = cns(
  'w-full max-w-[440px] rounded-lg border border-line-loud bg-surface',
  'p-[22px] shadow-lift',
)

/**
 * Both mockup dialogs open with `text-h3`; only the gap under it differs, and
 * it differs on exactly one thing — whether a line of prose follows. The
 * report dialog goes straight into its reasons (`mb-2.5`), the delete dialog
 * into its warning (`mb-1.5`, with `mb-[18px]` under the warning itself).
 */
const MODAL_TITLE = 'mb-2.5 text-h3'
const MODAL_TITLE_WITH_DESCRIPTION = 'mb-1.5 text-h3'
const MODAL_DESCRIPTION = 'mb-[18px] text-sm text-ink-3'

/**
 * Everything that can hold focus, before the roving/disabled filter below.
 * `[tabindex]` is matched broadly and then narrowed by `tabIndex >= 0`, so a
 * `tabindex="-1"` element — the panel itself, or an unchecked `Reason` — is
 * reachable by script but never by Tab.
 */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button',
  'input',
  'select',
  'textarea',
  'iframe',
  'object',
  'embed',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]',
].join(',')

function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter(
    element =>
      !element.hasAttribute('disabled') &&
      !element.hasAttribute('inert') &&
      element.getAttribute('aria-hidden') !== 'true' &&
      !element.hidden &&
      element.tabIndex >= 0,
  )
}

/** Tags that never take focus and carry no content to hide. */
const NEVER_INERT = new Set([
  'HEAD',
  'LINK',
  'META',
  'SCRIPT',
  'STYLE',
  'TEMPLATE',
])

/**
 * Takes everything outside `element` out of the tab order and out of the
 * accessibility tree, by walking up to the document root and marking each
 * level's siblings.
 *
 * Walking rather than "every child of `<body>`" is deliberate: the portal can
 * be pointed at a container other than `document.body`, and then the
 * background is the container's siblings *and* the container's ancestors'
 * siblings.
 *
 * `inert` is the real mechanism — it removes focusability, pointer events and
 * AT exposure in one attribute. `aria-hidden` rides along for the same reason
 * the rest of this file hand-rolls its behaviour: jsdom implements neither,
 * so the trap below cannot lean on `inert` either. Anything that already
 * carries one of the two attributes is left completely alone, so restoring is
 * exact rather than best-effort.
 */
function inertOutside(element: Element): () => void {
  const marked: Element[] = []
  let node: Element | null = element

  while (node?.parentElement) {
    for (const sibling of Array.from(node.parentElement.children)) {
      if (
        sibling === node ||
        NEVER_INERT.has(sibling.tagName) ||
        sibling.hasAttribute('inert') ||
        sibling.hasAttribute('aria-hidden')
      ) {
        continue
      }

      sibling.setAttribute('inert', '')
      sibling.setAttribute('aria-hidden', 'true')
      marked.push(sibling)
    }

    node = node.parentElement
  }

  return () => {
    for (const sibling of marked) {
      sibling.removeAttribute('inert')
      sibling.removeAttribute('aria-hidden')
    }
  }
}

/** Nothing to subscribe to — the answer only ever changes once, at hydration. */
const subscribeToNothing = (): (() => void) => () => {}

/**
 * Whether there is a real DOM to portal into.
 *
 * `useSyncExternalStore` rather than the usual `useState(false)` +
 * `useEffect(() => setMounted(true))`: React's own lint rule rejects a
 * synchronous `setState` in an effect, and this is the hook the React docs
 * point at instead. The server snapshot is `false` and the client snapshot is
 * `true`, so a server render and the hydrating render agree, and the render
 * straight after hydration brings the dialog in.
 */
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  )
}

export type ModalProps = Omit<ComponentPropsWithoutRef<'div'>, 'title'> & {
  /** `Modal` is always controlled — the call site owns the open state. */
  open: boolean
  /** Escape, a scrim click, or anything else that dismisses without a choice. */
  onClose: () => void
  /** The dialog's name. Rendered as its heading and used as its accessible name. */
  title: ReactNode
  /** Overrides the heading's classes, including the margin under it. */
  titleClassName?: string
  /** A line of prose under the title. Also becomes the dialog's description. */
  description?: ReactNode
  descriptionClassName?: string
  /** Extra classes for the scrim rather than the panel. */
  scrimClassName?: string
  /** Escape hatch onto the scrim — `data-testid` and the like. */
  scrimProps?: Omit<ModalScrimProps, 'children' | 'className' | 'ref'>
  /**
   * Whether Escape and a scrim click close the dialog. Off for a dialog that
   * demands an explicit answer.
   */
  dismissible?: boolean
  /**
   * What to focus on open. Defaults to the first focusable element in the
   * panel, then the panel itself. A destructive confirm should point this at
   * its Cancel button.
   */
  initialFocusRef?: RefObject<HTMLElement | null>
  /** Where the portal mounts. Defaults to `document.body`. */
  container?: HTMLElement | null
  children?: ReactNode
}

/**
 * The centred confirm dialog: "report a problem", "delete this".
 *
 * `ui.pug` draws the scrim and the panel and stops there — the mockups
 * declare themselves free of behavioural JS, so every dialog affordance is
 * absent from the spec rather than designed away. All of it is implemented
 * here, following `menu.tsx`'s model: real DOM focus rather than
 * `aria-activedescendant`, keyboard targets found by DOM query rather than a
 * context registry (so wrappers, fragments and `.map()` all work), and focus
 * handed back to whatever raised the dialog when it closes.
 *
 * - The panel is `role="dialog" aria-modal="true"`, named by its heading and
 *   described by its `description` when it has one.
 * - Opening moves focus into the panel; everything outside it is marked
 *   `inert` and `aria-hidden`, and the page behind stops scrolling.
 * - Tab and Shift+Tab wrap inside the panel.
 * - Escape and a click on the scrim itself close it, unless `dismissible` is
 *   false. A drag that starts inside the panel and ends on the scrim does
 *   not — the press and the release both have to land on the backdrop.
 * - Closing returns focus to the element that had it when the dialog opened.
 *
 * Renders nothing at all while closed, and nothing during SSR: the portal
 * needs a real `document`, so the first client render is deliberately empty
 * and the dialog appears on the commit after it.
 */
export function Modal({
  open,
  onClose,
  title,
  titleClassName,
  description,
  descriptionClassName,
  scrimClassName,
  scrimProps,
  dismissible = true,
  initialFocusRef,
  container,
  className,
  children,
  ...props
}: ModalProps): JSX.Element | null {
  const mounted = useMounted()

  const scrimRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  /** Whether the press that a click completes also landed on the scrim. */
  const pressedScrimRef = useRef(false)

  const titleId = useId()
  const descriptionId = useId()

  // Focus in on open, and back out on close. The element to return to is
  // captured here rather than from a trigger ref, because a dialog can be
  // raised from a row action, a menu item or a keyboard shortcut, and the
  // right answer is always "whatever had focus a moment ago".
  useEffect(() => {
    if (!open || !mounted) {
      return
    }

    const previous =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null

    const panel = panelRef.current
    const target =
      initialFocusRef?.current ??
      (panel ? (focusableElements(panel)[0] ?? panel) : null)

    target?.focus()

    return () => {
      if (previous?.isConnected) {
        previous.focus()
      }
    }
  }, [open, mounted, initialFocusRef])

  // The background goes inert and the page behind stops scrolling.
  useEffect(() => {
    if (!open || !mounted) {
      return
    }

    const scrim = scrimRef.current

    if (!scrim) {
      return
    }

    const restoreInert = inertOutside(scrim)
    const previousOverflow = document.body.style.overflow

    document.body.style.overflow = 'hidden'

    return () => {
      restoreInert()
      document.body.style.overflow = previousOverflow
    }
  }, [open, mounted])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    // Anything inside the dialog that already handled the key wins — an open
    // `Menu` swallows its own Escape before this sees it.
    if (event.defaultPrevented) {
      return
    }

    if (event.key === 'Escape') {
      if (!dismissible) {
        return
      }

      event.preventDefault()
      onClose()

      return
    }

    if (event.key !== 'Tab') {
      return
    }

    const panel = panelRef.current

    if (!panel) {
      return
    }

    const items = focusableElements(panel)
    const first = items[0]
    const last = items[items.length - 1]

    // Nothing to tab to: hold focus on the panel rather than letting it
    // escape to the inert page behind.
    if (!first || !last) {
      event.preventDefault()
      panel.focus()

      return
    }

    const active = document.activeElement

    if (
      active === panel ||
      !(active instanceof Node) ||
      !panel.contains(active)
    ) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()

      return
    }

    if (event.shiftKey ? active === first : active === last) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
  }

  function handleScrimMouseDown(event: MouseEvent<HTMLDivElement>): void {
    pressedScrimRef.current = event.target === event.currentTarget
  }

  function handleScrimClick(event: MouseEvent<HTMLDivElement>): void {
    const pressedScrim = pressedScrimRef.current

    pressedScrimRef.current = false

    if (!dismissible || !pressedScrim || event.target !== event.currentTarget) {
      return
    }

    onClose()
  }

  if (!mounted || !open) {
    return null
  }

  return createPortal(
    <ModalScrim
      {...scrimProps}
      ref={scrimRef}
      className={cns(scrimClassName)}
      onClick={handleScrimClick}
      onKeyDown={handleKeyDown}
      onMouseDown={handleScrimMouseDown}
    >
      <div
        role="dialog"
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        {...props}
        ref={panelRef}
        className={cns(MODAL_PANEL, className)}
        tabIndex={-1}
      >
        {/*
          Deviation from `ui.pug`, which opens both dialogs with a `<p>`: a
          dialog's name should be a heading so the dialog has an outline of
          its own. Purely semantic — the classes are the mixin's, so it
          renders identically.
        */}
        <h2
          className={cns(
            description ? MODAL_TITLE_WITH_DESCRIPTION : MODAL_TITLE,
            titleClassName,
          )}
          id={titleId}
        >
          {title}
        </h2>
        {description ? (
          <p
            className={cns(MODAL_DESCRIPTION, descriptionClassName)}
            id={descriptionId}
          >
            {description}
          </p>
        ) : null}
        {children}
      </div>
    </ModalScrim>,
    container ?? document.body,
  )
}

type ReasonGroupContextValue = {
  value: string | undefined
  onSelect: (value: string) => void
}

const ReasonGroupContext = createContext<ReasonGroupContextValue | undefined>(
  undefined,
)

function useReasonGroupContext(component: string): ReasonGroupContextValue {
  const context = useContext(ReasonGroupContext)

  if (!context) {
    throw new Error(`<${component}> must be rendered inside a <ReasonGroup>`)
  }

  return context
}

/** The reason's own value, read back off the DOM during keyboard navigation. */
const REASON_VALUE_ATTRIBUTE = 'data-value'

const REASON_SELECTOR =
  '[role="radio"]:not([disabled]):not([aria-disabled="true"])'

export type ReasonGroupProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'onChange'
> & {
  /** The chosen reason's value. Omitted means nothing is chosen yet. */
  value?: string
  onValueChange?: (value: string) => void
}

/**
 * The single-select list of plain-language reasons behind "report a problem".
 *
 * `ui.pug`'s `reason` mixin is a styled row with no grouping and no input, so
 * the semantics are added here: the container is a `radiogroup` and each row
 * is a `radio`, which is what makes "one of these" audible. Name the group
 * from the call site with `aria-label`, or `aria-labelledby` pointing at the
 * dialog title.
 *
 * Keyboard model is APG's, and `Tabs`': focus roves, so the group is one tab
 * stop; arrows move between rows with wrap-around and selection follows
 * focus; Home/End jump to the ends; Space chooses the focused row. When
 * nothing is chosen yet the first row is the one that takes the tab stop,
 * which is applied from the DOM because no row can know it is first.
 */
export function ReasonGroup({
  value,
  onValueChange,
  className,
  children,
  onKeyDown,
  ...props
}: ReasonGroupProps): JSX.Element {
  const groupRef = useRef<HTMLDivElement>(null)

  // The roving tab stop, settled from the DOM. `Reason` can put itself at
  // `tabIndex={0}` when it is the chosen one, but "and the first row when
  // nothing is chosen" is not knowable from inside a row — hence the query.
  //
  // No dependency array on purpose, and every row is written rather than just
  // the first: React only touches an attribute whose prop changed, so a row
  // this effect promoted would otherwise keep its tab stop forever once the
  // choice moved elsewhere.
  useEffect(() => {
    const group = groupRef.current

    if (!group) {
      return
    }

    const reasons = Array.from(
      group.querySelectorAll<HTMLElement>(REASON_SELECTOR),
    )

    if (reasons.length === 0) {
      return
    }

    const checked = reasons.findIndex(
      reason => reason.getAttribute('aria-checked') === 'true',
    )
    const stop = checked < 0 ? 0 : checked

    reasons.forEach((reason, index) => {
      reason.setAttribute('tabindex', index === stop ? '0' : '-1')
    })
  })

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    onKeyDown?.(event)

    if (event.defaultPrevented) {
      return
    }

    const reasons = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(REASON_SELECTOR),
    )

    if (reasons.length === 0) {
      return
    }

    const current = reasons.findIndex(
      reason => reason === document.activeElement,
    )
    let next: number

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        next = current < 0 ? 0 : (current + 1) % reasons.length
        break
      case 'ArrowUp':
      case 'ArrowLeft':
        next =
          current < 0
            ? reasons.length - 1
            : (current - 1 + reasons.length) % reasons.length
        break
      case 'Home':
        next = 0
        break
      case 'End':
        next = reasons.length - 1
        break
      // Space on a `<button>` would fire a click of its own on key-up;
      // preventing the default below keeps that from double-firing.
      case ' ':
        if (current < 0) {
          return
        }

        next = current
        break
      default:
        return
    }

    event.preventDefault()

    const target = reasons[next]

    if (!target) {
      return
    }

    const targetValue = target.getAttribute(REASON_VALUE_ATTRIBUTE)

    target.focus()

    if (targetValue !== null && targetValue !== value) {
      onValueChange?.(targetValue)
    }
  }

  return (
    <ReasonGroupContext.Provider
      value={{ value, onSelect: next => onValueChange?.(next) }}
    >
      <div
        role="radiogroup"
        {...props}
        ref={groupRef}
        className={cns(className)}
        onKeyDown={handleKeyDown}
      >
        {children}
      </div>
    </ReasonGroupContext.Provider>
  )
}

/**
 * `w-full text-left` is the one addition to the mixin's class list, and it is
 * a consequence of the tag rather than a design change: the mixin's row is a
 * `<div>`, which fills its container and starts its text at the left for
 * free, and a `<button>` does neither.
 */
const REASON_BASE = cns(
  'flex w-full items-center gap-2.5 rounded-md border px-3 py-[11px] text-left',
  'transition-[border-color,background-color] duration-200 ease-uv',
  '[&+&]:mt-2',
)

const REASON_CHECKED = 'border-uv/40 bg-uv-ghost'

/**
 * An idle row's hover is `Button`'s `outline` pair verbatim
 * (`hover:border-uv-dim hover:bg-surface-2`) — the closest analogue in the
 * system, a bordered surface you are about to choose, and it leans toward the
 * uv the checked state lands on.
 *
 * `ui.pug` defines no hover for a reason row, so this is an addition rather
 * than a port. It is not new design: both utilities already carry these exact
 * roles elsewhere (`Button` `outline`, and `DataTable`'s row hover). A
 * selectable row with no pointer feedback inside a destructive confirm was the
 * gap worth closing. The checked row deliberately gets none — it is already
 * the answer.
 */
const REASON_IDLE = cns('border-line', 'hover:border-uv-dim hover:bg-surface-2')

const REASON_DOT_BASE =
  'grid h-4 w-4 shrink-0 place-items-center rounded-full border-[1.5px]'

const REASON_DOT_CHECKED =
  "border-uv after:h-2 after:w-2 after:rounded-full after:bg-uv after:content-['']"

const REASON_DOT_IDLE = 'border-line-loud'

export type ReasonProps = Omit<ComponentPropsWithoutRef<'button'>, 'value'> & {
  /** Reported to `ReasonGroup`'s `onValueChange` when chosen. */
  value: string
  /** Overrides the checked look, which otherwise tracks the group's `value`. */
  checked?: boolean
}

/**
 * One reason. A real `<button role="radio">` rather than the mixin's `<div>`,
 * for the same reason `Tab` and `MenuItem` are buttons: it is genuinely
 * activatable, and a button brings its own activation, its own disabled
 * handling and the theme's `:focus-visible` ring with it.
 *
 * The row's text is `children`; the mixin's `reason(label, checked)` takes it
 * as an argument, but every compound primitive in this package — `Tab`,
 * `MenuItem` — reads its content from `children`.
 */
export function Reason({
  value,
  checked: checkedProp,
  className,
  children,
  onClick,
  ...props
}: ReasonProps): JSX.Element {
  const { value: groupValue, onSelect } = useReasonGroupContext('Reason')
  const checked = checkedProp ?? value === groupValue

  return (
    <button
      type="button"
      {...props}
      aria-checked={checked}
      className={cns(
        REASON_BASE,
        checked ? REASON_CHECKED : REASON_IDLE,
        className,
      )}
      data-value={value}
      role="radio"
      tabIndex={checked ? 0 : -1}
      onClick={event => {
        onClick?.(event)

        if (!event.defaultPrevented) {
          onSelect(value)
        }
      }}
    >
      <span
        className={cns(
          REASON_DOT_BASE,
          checked ? REASON_DOT_CHECKED : REASON_DOT_IDLE,
        )}
      />
      <span className="text-sm">{children}</span>
    </button>
  )
}

/**
 * Tinted rather than filled. `Button`'s bare shape already carries
 * `border-transparent`, and `cns` resolves the two border colours in this
 * one's favour because it comes last.
 */
/**
 * `ui.pug` defines no hover for `deleteBtn`, so the hover pair is an addition
 * rather than a port — the highest-stakes click in the app was giving no
 * pointer feedback at all.
 *
 * It deepens the tint it already sits on rather than introducing anything:
 * `bad-ghost` is `--color-bad` at 14% alpha, so hover is the same hue at 22%
 * with the border brought up from 40% to 60%. No new colour, no hue outside
 * the system's four. `Button`'s own `bad` variant hover (`hover:bg-bad-ghost`)
 * could not be reused directly — this button's *idle* state is already
 * `bg-bad-ghost`, so that would have been a no-op.
 */
const DELETE_BUTTON_TINT = cns(
  'border-bad/40 bg-bad-ghost text-bad',
  'hover:border-bad/60 hover:bg-bad/22',
)

export type DeleteButtonProps = Omit<ButtonProps, 'variant'>

/**
 * The destructive confirm. Bad-tinted instead of solid because the dialog
 * title is already saying the loud part — `ui.pug`'s own comment on
 * `deleteBtn`.
 *
 * Defaults to the mixin's `size: 'sm'`, its trailing `trash` and its "Delete"
 * label, each of which a call site can replace; `full` comes through from
 * `Button` for the stacked mobile layout, which the mockups use as
 * `+deleteBtn(true)`.
 */
export function DeleteButton({
  size = 'sm',
  iconEnd = 'trash',
  className,
  children,
  ...props
}: DeleteButtonProps): JSX.Element {
  return (
    <Button
      {...props}
      className={cns(DELETE_BUTTON_TINT, className)}
      iconEnd={iconEnd}
      size={size}
    >
      {children ?? 'Delete'}
    </Button>
  )
}
