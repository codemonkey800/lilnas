'use client'

import { Button, Icon, Input } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, FormEvent, JSX, ReactNode } from 'react'

export type HeroFieldProps = Omit<
  ComponentPropsWithoutRef<'section'>,
  'children' | 'onSubmit' | 'title'
> & {
  /** The headline: Geist 600, 60px on desktop and 36px on a phone. */
  title: string
  /** One line under the field. */
  hint?: ReactNode
  value: string
  onValueChange: (value: string) => void
  onSubmit: () => void
  placeholder?: string
  /** What pressing the button does; icon-only below `sm`, still its name. */
  buttonLabel: string
  /** The field's accessible name. */
  inputLabel: string
  /** The form's accessible name. */
  formLabel: string
  autoFocus?: boolean
  /** A failed submit, in the `bad` register under the field. */
  error?: string | null
}

/**
 * The giant single-input hero (`adoption.md` keeps it): a large headline over
 * one 44px field and the one accent button. Home and `/search` share it, so
 * the two heroes cannot drift apart.
 *
 * The button is `type="submit"` and never `loading`/`disabled`: a form whose
 * default button is inert does not submit on Enter, and Enter has to work while
 * a debounce or a create is in flight.
 */
export function HeroField({
  title,
  hint,
  value,
  onValueChange,
  onSubmit,
  placeholder,
  buttonLabel,
  inputLabel,
  formLabel,
  autoFocus,
  error,
  className,
  ...props
}: HeroFieldProps): JSX.Element {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    onSubmit()
  }

  return (
    <section
      {...props}
      className={cns(
        'flex flex-col gap-4 pt-4 pb-8',
        'sm:items-center sm:gap-6 sm:pt-10 sm:pb-14 sm:text-center',
        className,
      )}
    >
      <h1 className="text-4xl leading-[1.1] font-semibold tracking-tight text-balance sm:text-6xl sm:leading-[1.05]">
        {title}
      </h1>
      <form
        aria-label={formLabel}
        className="flex w-full items-center gap-2 sm:max-w-[680px]"
        role="search"
        onSubmit={handleSubmit}
      >
        <Input
          aria-label={inputLabel}
          autoComplete="off"
          autoFocus={autoFocus}
          className="h-11 min-w-0 px-4 text-[15px]"
          enterKeyHint="search"
          placeholder={placeholder}
          value={value}
          wrapperClassName="min-w-0 flex-1"
          onChange={event => onValueChange(event.target.value)}
        />
        <Button
          aria-label={buttonLabel}
          className="max-sm:size-11 max-sm:px-0"
          icon="search"
          size="lg"
          type="submit"
          variant="accent"
        >
          <span className="max-sm:hidden">{buttonLabel}</span>
        </Button>
      </form>
      {error ? (
        <p className="flex items-center gap-1.5 text-xs text-bad" role="alert">
          <Icon className="size-3 shrink-0" name="alert" />
          {error}
        </p>
      ) : null}
      {hint ? <p className="max-w-[60ch] text-cap text-ink-3">{hint}</p> : null}
    </section>
  )
}
