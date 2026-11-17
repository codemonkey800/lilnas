'use client'

import { useRender } from '@base-ui/react/use-render'
import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithRef, JSX, ReactNode } from 'react'

import type { IconName } from '../icons'
import { Icon } from '../icons'
import type { StatusDotTone } from '../status-dot'
import { StatusDot } from '../status-dot'

export type CardVariant = 'default' | 'sunk'

export type CardProps = ComponentPropsWithRef<'div'> & {
  /** `sunk` is a well for content with its own chrome, such as a log pane. */
  variant?: CardVariant
}

/**
 * Raised surface. No shadow, and none on hover either: a card that is a link
 * is a `Tile`.
 */
export function Card({
  variant = 'default',
  className,
  ...props
}: CardProps): JSX.Element {
  return (
    <div
      {...props}
      className={cns(
        'rounded-lg border border-line p-4 in-data-[density=compact]:p-3',
        variant === 'sunk' ? 'bg-bg-sunk' : 'bg-surface',
        className,
      )}
    />
  )
}

/** A bordered section that clips its children and carries its own padding. */
export function Panel({
  className,
  ...props
}: ComponentPropsWithRef<'div'>): JSX.Element {
  return (
    <div
      {...props}
      className={cns(
        'overflow-hidden rounded-lg border border-line bg-surface',
        className,
      )}
    />
  )
}

export type PanelHeadProps = {
  title: string
  /** Mono line under the title: a path, a source, a count. */
  caption?: string
  /** Room on the right for a badge or a button. */
  children?: ReactNode
  className?: string
}

export function PanelHead({
  title,
  caption,
  children,
  className,
}: PanelHeadProps): JSX.Element {
  return (
    <header
      className={cns(
        'flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 border-b border-line-soft px-4 py-3',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-0.5">
        <h2 className="text-h3">{title}</h2>
        {caption ? (
          <p className="font-mono text-mono-sm break-words text-ink-3">
            {caption}
          </p>
        ) : null}
      </div>
      {children}
    </header>
  )
}

export type TileProps = Omit<ComponentPropsWithRef<'a'>, 'title'> & {
  icon: IconName
  title: ReactNode
  /** Mono line under the title, usually the subdomain. */
  meta?: ReactNode
  /** A word beside the dot: `3 active`, `Ready`, `Down`. */
  status?: ReactNode
  statusTone?: StatusDotTone
  /** Swap the element, e.g. `render={<Link href="…" />}`. */
  render?: useRender.ComponentProps<'a'>['render']
}

/**
 * A card that is a navigation target: the portal grid and auth's services.
 * Renders an `<a>` when it has an `href`, a `<div>` otherwise, and anything
 * else through `render`. Hover steps the surface and the border one level.
 */
export function Tile({
  icon,
  title,
  meta,
  status,
  statusTone = 'idle',
  href,
  render,
  className,
  children,
  ref,
  ...props
}: TileProps): JSX.Element {
  return useRender({
    defaultTagName: href ? 'a' : 'div',
    render,
    ref,
    props: {
      ...props,
      href,
      className: cns(
        'flex items-center gap-3 rounded-lg border border-line bg-surface p-3 in-data-[density=compact]:p-2.5',
        'transition-[background-color,border-color] duration-200 ease-standard',
        'hover:border-line-loud hover:bg-surface-2',
        className,
      ),
      children: (
        <>
          <span className="grid size-[30px] shrink-0 place-items-center rounded-md bg-accent-ghost text-accent-hi">
            <Icon name={icon} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-h3">{title}</span>
            {meta ? (
              <span className="truncate font-mono text-mono-sm text-ink-3">
                {meta}
              </span>
            ) : null}
          </span>
          {status ? (
            <span className="flex shrink-0 items-center gap-1.5 text-cap text-ink-3">
              <StatusDot tone={statusTone} />
              {status}
            </span>
          ) : null}
          {children}
        </>
      ),
    },
  })
}
