'use client'

import { useRender } from '@base-ui/react/use-render'
import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithRef, JSX, ReactElement, ReactNode } from 'react'

import { Doorplate } from '../doorplate'

export type AppBarLink = {
  href: string
  label: string
  active?: boolean
  /** Swap the anchor, e.g. `<Link />` from the app's router. */
  render?: ReactElement
}

export type AppBarProps = Omit<ComponentPropsWithRef<'header'>, 'children'> & {
  /** The subdomain for the doorplate. Omit it on the portal. */
  app?: string
  /** Primary navigation. Hidden below `md`. */
  links?: AppBarLink[]
  /** Search, an `Avatar`: whatever sits at the right edge. */
  end?: ReactNode
  /**
   * The phone menu, shown only below `md`: pass the whole thing, trigger
   * included, built from the same links. The doorplate stays either way.
   */
  sheet?: ReactNode
}

function NavLink({ href, label, active, render }: AppBarLink): ReactElement {
  return useRender({
    defaultTagName: 'a',
    render,
    props: {
      href,
      'aria-current': active ? 'page' : undefined,
      className: cns(
        'inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium',
        'transition-colors duration-200 ease-standard',
        active ? 'text-ink' : 'text-ink-3 hover:text-ink',
      ),
      children: label,
    },
  })
}

/** Doorplate, primary navigation, a spacer, then whatever goes at the end. */
export function AppBar({
  app,
  links,
  end,
  sheet,
  className,
  ...props
}: AppBarProps): JSX.Element {
  return (
    <header
      {...props}
      className={cns(
        'flex h-14 items-center gap-4 border-b border-line bg-surface px-4 in-data-[density=compact]:h-12',
        className,
      )}
    >
      <Doorplate app={app} />
      {links?.length ? (
        <nav aria-label="Primary" className="hidden items-center gap-1 md:flex">
          {links.map(link => (
            <NavLink key={link.href} {...link} />
          ))}
        </nav>
      ) : null}
      <div className="flex-1" />
      {end}
      {sheet ? <div className="md:hidden">{sheet}</div> : null}
    </header>
  )
}
