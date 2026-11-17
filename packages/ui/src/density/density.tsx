import type { ComponentPropsWithRef, JSX } from 'react'

export type DensityMode = 'comfortable' | 'compact'

export type DensityProps = ComponentPropsWithRef<'div'> & {
  mode: DensityMode
}

/**
 * Sets `data-density` once for everything inside. `theme.css` turns that into
 * the `--control-h*` variables and the compact type size, and components that
 * need to differ read it with `in-data-[density=compact]:`.
 */
export function Density({ mode, ...props }: DensityProps): JSX.Element {
  return <div {...props} data-density={mode} />
}
