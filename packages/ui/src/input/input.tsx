'use client'

import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithRef, JSX, ReactElement, ReactNode } from 'react'
import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useLayoutEffect,
  useRef,
} from 'react'

import { Button } from '../button'
import type { IconName } from '../icons'
import { Icon } from '../icons'

/**
 * The id a control and its label agree on: the explicit one when given,
 * otherwise one minted for the lifetime of the component. Custom controls
 * that sit inside a `Field` call this and hand the result to `Field` as
 * `htmlFor`.
 */
export function useFieldId(explicit?: string): string {
  const generated = useId()
  return explicit ?? generated
}

// Height follows the density wrapper (36px comfortable / 30px compact).
const CONTROL_BASE = cns(
  'w-full rounded-md border border-line-control bg-bg-sunk px-3 text-body text-ink',
  'transition-[border-color,box-shadow] duration-200 ease-standard',
  'placeholder:text-ink-3',
  'focus:border-accent focus:ring-2 focus:ring-accent-ghost focus:outline-none',
  'disabled:pointer-events-none disabled:opacity-40',
)

const CONTROL_INVALID = cns(
  'border-bad',
  'focus:border-bad focus:ring-bad-ghost',
)

// Machine values — URLs, paths, ids, tokens — read in the mono face.
const CONTROL_MONO = 'font-mono text-mono'

function isInvalid(
  invalid: boolean | undefined,
  ariaInvalid: ComponentPropsWithRef<'input'>['aria-invalid'],
): boolean {
  return invalid ?? (ariaInvalid != null && ariaInvalid !== 'false')
}

export type InputProps = ComponentPropsWithRef<'input'> & {
  /** Render the value in the machine face. */
  mono?: boolean
  /**
   * Leading glyph drawn inside the field. Supplying one wraps the input in a
   * positioning element: `className` still lands on the `<input>`,
   * `wrapperClassName` on the wrapper.
   */
  icon?: IconName
  /** Mark the field invalid: `border-bad` and `aria-invalid`. */
  invalid?: boolean
  wrapperClassName?: string
}

export function Input({
  mono = false,
  icon,
  invalid,
  wrapperClassName,
  className,
  ...props
}: InputProps): JSX.Element {
  const bad = isInvalid(invalid, props['aria-invalid'])

  const input = (
    <input
      type="text"
      {...props}
      aria-invalid={bad || undefined}
      className={cns(
        CONTROL_BASE,
        'h-(--control-h)',
        mono && CONTROL_MONO,
        icon != null && 'pl-9',
        bad && CONTROL_INVALID,
        className,
      )}
    />
  )

  if (icon == null) {
    return input
  }

  return (
    <div className={cns('relative', wrapperClassName)}>
      <span className="pointer-events-none absolute top-1/2 left-3 flex size-4 -translate-y-1/2 items-center justify-center text-ink-4">
        <Icon name={icon} />
      </span>
      {input}
    </div>
  )
}

export type TextareaProps = ComponentPropsWithRef<'textarea'> & {
  mono?: boolean
  invalid?: boolean
  /** Grow with the content instead of scrolling. */
  autoResize?: boolean
}

export function Textarea({
  mono = false,
  invalid,
  autoResize = false,
  className,
  ref,
  onInput,
  ...props
}: TextareaProps): JSX.Element {
  const bad = isInvalid(invalid, props['aria-invalid'])
  const innerRef = useRef<HTMLTextAreaElement | null>(null)

  function fit(): void {
    const el = innerRef.current
    if (!autoResize || !el) {
      return
    }

    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  // Re-fit when a controlled value changes from outside, not just on typing.
  useLayoutEffect(fit)

  return (
    <textarea
      {...props}
      aria-invalid={bad || undefined}
      className={cns(
        CONTROL_BASE,
        'min-h-[70px] resize-none py-2',
        autoResize && 'overflow-hidden',
        mono && CONTROL_MONO,
        bad && CONTROL_INVALID,
        className,
      )}
      ref={node => {
        innerRef.current = node
        if (typeof ref === 'function') {
          return ref(node)
        }
        if (ref) {
          ref.current = node
        }
      }}
      onInput={event => {
        onInput?.(event)
        fit()
      }}
    />
  )
}

export type FieldProps = {
  label: ReactNode
  hint?: ReactNode
  /** Replaces the hint, turns the control `aria-invalid`. */
  error?: ReactNode
  /** The id of the control, when it isn't (or can't take) the minted one. */
  htmlFor?: string
  className?: string
  /** One control. Elements receive `id`, `aria-invalid` and `aria-describedby`. */
  children: ReactNode
}

type ControlProps = {
  id?: string
  'aria-describedby'?: string
  'aria-invalid'?: boolean
}

/**
 * A label over a control with a hint or an error beneath it. The error
 * replaces the hint; both are wired to the control with `aria-describedby`.
 */
export function Field({
  label,
  hint,
  error,
  htmlFor,
  className,
  children,
}: FieldProps): JSX.Element {
  const child = Children.count(children) === 1 ? children : null
  const control =
    isValidElement<ControlProps>(child) && typeof child.type !== 'symbol'
      ? (child as ReactElement<ControlProps>)
      : null

  const id = useFieldId(htmlFor ?? control?.props.id)
  const hasError = error != null && error !== false && error !== ''
  const message = hasError ? error : hint
  const messageId =
    message != null ? `${id}-${hasError ? 'error' : 'hint'}` : ''

  const describedBy =
    [control?.props['aria-describedby'], messageId].filter(Boolean).join(' ') ||
    undefined

  return (
    <div className={cns('flex flex-col gap-1.5', className)}>
      <label className="text-sm font-medium text-ink-2" htmlFor={id}>
        {label}
      </label>
      {control
        ? cloneElement(control, {
            id,
            'aria-describedby': describedBy,
            ...(hasError ? { 'aria-invalid': true } : null),
          })
        : children}
      {message != null && message !== false && message !== '' && (
        <p
          className={cns('text-cap', hasError ? 'text-bad' : 'text-ink-3')}
          id={messageId}
        >
          {message}
        </p>
      )}
    </div>
  )
}

export type SearchProps = {
  value: string
  onValueChange: (value: string) => void
  onSubmit: (value: string) => void
  placeholder?: string
  /** Visible label on the button; always the accessible name. */
  buttonLabel?: string
  /** A search is running: the button is disabled and shows its pending ring. */
  pending?: boolean
  className?: string
}

/**
 * An `Input` and an accent button in one row. Enter or the button submits;
 * below `sm` the button collapses to its icon.
 */
export function Search({
  value,
  onValueChange,
  onSubmit,
  placeholder,
  buttonLabel = 'Search',
  pending = false,
  className,
}: SearchProps): JSX.Element {
  return (
    <form
      className={cns('flex items-center gap-2', className)}
      role="search"
      onSubmit={event => {
        event.preventDefault()
        onSubmit(value)
      }}
    >
      <Input
        aria-label={buttonLabel}
        className="min-w-0"
        icon="search"
        placeholder={placeholder}
        type="search"
        value={value}
        wrapperClassName="min-w-0 flex-1"
        onChange={event => onValueChange(event.target.value)}
      />
      <Button
        aria-label={buttonLabel}
        className="max-sm:w-(--control-h) max-sm:px-0"
        disabled={pending}
        icon="search"
        loading={pending}
        type="submit"
        variant="accent"
      >
        <span className="hidden sm:inline">{buttonLabel}</span>
      </Button>
    </form>
  )
}
