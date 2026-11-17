'use client'

import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'
import { useState } from 'react'

export type AvatarSize = 24 | 32 | 40 | 64

const AVATAR_SIZES: Record<AvatarSize, string> = {
  24: 'size-6 text-[11px]',
  32: 'size-8 text-[13px]',
  40: 'size-10 text-[13px]',
  64: 'size-16 text-xl',
}

export type AvatarProps = Omit<ComponentPropsWithoutRef<'span'>, 'children'> & {
  initials: string
  /** A photo drawn over the initials; they show if it fails to load. */
  src?: string
  size?: AvatarSize
  /** The accent avatar means "you". */
  self?: boolean
  /** Native tooltip, and the avatar's accessible name (else the initials). */
  title?: string
}

/** Person marker: initials, optionally under a photo. */
export function Avatar({
  initials,
  src,
  size = 24,
  self = false,
  title,
  className,
  ...props
}: AvatarProps): JSX.Element {
  // Remember *which* source failed, so a new `src` gets its own attempt.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const showImage = !!src && failedSrc !== src

  return (
    <span
      aria-label={title ?? initials}
      role="img"
      title={title}
      {...props}
      className={cns(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold',
        AVATAR_SIZES[size],
        self ? 'bg-accent text-accent-ink' : 'bg-surface-2 text-ink',
        className,
      )}
    >
      <span aria-hidden="true">{initials}</span>
      {showImage ? (
        <img
          alt=""
          className="absolute inset-0 size-full object-cover"
          onError={() => setFailedSrc(src)}
          src={src}
        />
      ) : null}
    </span>
  )
}

export type AvatarStackProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  people: Omit<AvatarProps, 'size'>[]
  /** How many people to show before collapsing the rest into `+N`. */
  max?: number
  size?: AvatarSize
}

/** Overlapping avatars (8px, each ringed in `bg`) with a `+N` for overflow. */
export function AvatarStack({
  people,
  max = 3,
  size = 32,
  className,
  ...props
}: AvatarStackProps): JSX.Element {
  const shown = people.slice(0, Math.max(0, max))
  const overflow = people.length - shown.length
  const overlap = 'ring-2 ring-bg [&:not(:first-child)]:-ml-2'

  return (
    <div className={cns('flex items-center', className)} {...props}>
      {shown.map((person, i) => (
        <Avatar
          key={person.title ?? `${person.initials}-${i}`}
          {...person}
          className={cns(overlap, person.className)}
          size={size}
        />
      ))}
      {overflow > 0 ? (
        <Avatar
          className={overlap}
          initials={`+${overflow}`}
          size={size}
          title={`${overflow} more`}
        />
      ) : null}
    </div>
  )
}
