import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

export type ToggleProps = Omit<
  ComponentPropsWithoutRef<'button'>,
  'role' | 'aria-checked' | 'onChange'
> & {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}

/** A switch. The track is drawn; the state is `aria-checked`. */
export function Toggle({
  label,
  checked,
  onChange,
  className,
  ...props
}: ToggleProps): JSX.Element {
  return (
    <button
      type="button"
      {...props}
      aria-checked={checked}
      className={cns(
        'inline-flex h-[30px] items-center gap-2 rounded-md px-1.5 text-[13px] font-[550] text-ink-2 transition-colors duration-200 ease-uv hover:text-ink',
        className,
      )}
      onClick={() => onChange(!checked)}
      role="switch"
    >
      <span
        className={cns(
          'relative h-[18px] w-[30px] shrink-0 rounded-full border transition-[background-color,border-color] duration-200 ease-uv',
          checked ? 'border-uv bg-uv' : 'border-line-loud bg-bg-sunk',
        )}
      >
        <span
          className={cns(
            'absolute top-px h-[14px] w-[14px] rounded-full transition-[left] duration-[120ms] ease-spring',
            checked ? 'left-[13px] bg-uv-ink' : 'left-px bg-ink-3',
          )}
        />
      </span>
      {label}
    </button>
  )
}
