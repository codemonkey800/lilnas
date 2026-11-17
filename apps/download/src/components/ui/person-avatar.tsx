import { Avatar, type AvatarSize } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/**
 * The two named sizes this app draws avatars at, on top of `@lilnas/ui`'s
 * default 24px. Anything else is a call site overriding `size-*`/`text-*`
 * through `className`; `cns` resolves the later utility.
 */
export type PersonAvatarSize = 'md' | 'xs' | AvatarSize

/** The named sizes are class overrides; a number is the package's own scale. */
const SIZES: Record<'md' | 'xs', string> = {
  md: 'size-[30px] text-cap',
  xs: 'size-[18px] text-[8.5px]',
}

/**
 * What a masked avatar shows in place of initials. Attribution masking happens
 * server-side: `GalleryItem.lastRequester` and `DownloadJob.requester` arrive
 * already `null` when the viewer is not allowed the true identity, and the UI
 * renders that `null` as this dash. The component owns the glyph so a call
 * site cannot pass one — see `PersonAvatarMaskedProps`.
 *
 * An en dash rather than `UNKNOWN_VALUE`'s em dash: the avatar is a fixed-width
 * circle 18-52px across and an em dash at 8.5px reads as a rule through the
 * middle of it rather than a placeholder.
 */
export const MASKED_INITIALS = '–'

type ElementProps = Omit<
  ComponentPropsWithoutRef<'span'>,
  'children' | 'hidden' | 'title'
>

type CommonProps = ElementProps & {
  /** Marks "this is you": the accent avatar. */
  ring?: boolean
  size?: PersonAvatarSize
  /** Native tooltip, and the avatar's accessible name. */
  title?: string
}

type IdentifiedProps = CommonProps & {
  hidden?: false
  /**
   * Wraps the avatar in an `<a>`. A call site opts in per the access rules
   * (own identity always, another user's only for an admin) rather than every
   * avatar in the app quietly becoming a link.
   */
  href?: string
  initials: string
}

type MaskedProps = CommonProps & {
  hidden: true
  /**
   * A masked identity has no profile to link to and no initials to leak, so
   * neither is accepted. This is why `PersonAvatarProps` is a union.
   */
  href?: never
  initials?: never
}

export type PersonAvatarProps = IdentifiedProps | MaskedProps

/**
 * A person marker: `@lilnas/ui`'s `Avatar`, plus the two things only this app
 * needs — a dashed outline when attribution is masked, and an optional link to
 * the person's profile.
 */
export function PersonAvatar({
  className,
  hidden,
  href,
  initials,
  ring,
  size,
  title,
  ...props
}: PersonAvatarProps): JSX.Element {
  // The type union already rules this out, but a masked identity linking to
  // the profile it is masking would leak exactly what the mask exists to hide,
  // so the runtime refuses it too rather than trusting the call site.
  const linkHref = hidden ? undefined : href

  const avatar = (
    <Avatar
      {...props}
      className={cns(
        typeof size === 'string' && SIZES[size],
        hidden && 'border border-dashed border-line bg-transparent text-ink-4',
        // A link's hover plate: the anchor carries the group.
        linkHref &&
          'transition-colors duration-200 ease-standard group-hover:bg-surface-3',
        className,
      )}
      // The initials stay the accessible name, as they were when this was a
      // plain `<span>`: `title` is a tooltip only, so a linked avatar beside a
      // link that spells out the same email doesn't read as a duplicate.
      aria-label={hidden ? (title ?? MASKED_INITIALS) : initials}
      initials={hidden ? MASKED_INITIALS : (initials ?? '')}
      self={ring}
      size={typeof size === 'number' ? size : undefined}
      title={title}
    />
  )

  if (linkHref) {
    return (
      <a className="group shrink-0 rounded-full" href={linkHref}>
        {avatar}
      </a>
    )
  }

  return avatar
}

export type CastPersonProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  initials: string
  /**
   * A headshot drawn over the initials. The initials stay underneath rather
   * than being swapped out, so a headshot that fails to load leaves them
   * showing.
   */
  imageUrl?: string
  name: string
  /** A second, quieter line under the name — the character played. */
  role?: string
}

/** One credited name: a medium avatar next to the person's name. */
export function CastPerson({
  className,
  imageUrl,
  initials,
  name,
  role,
  ...props
}: CastPersonProps): JSX.Element {
  return (
    <div
      className={cns('flex shrink-0 items-center gap-2', className)}
      {...props}
    >
      <span className="relative flex shrink-0">
        <PersonAvatar initials={initials} size="md" />
        {imageUrl ? (
          // A bare `<img>`, not `next/image`: the source is a remote TMDb host
          // `next/image` would have to be told about, and nothing here needs
          // resizing.
          <img
            alt=""
            className="absolute inset-0 size-full rounded-full border border-line object-cover"
            loading="lazy"
            src={imageUrl}
          />
        ) : null}
      </span>
      {role ? (
        <span className="flex min-w-0 flex-col">
          <span className="text-sm">{name}</span>
          <span className="text-cap text-ink-3">{role}</span>
        </span>
      ) : (
        <span className="text-sm">{name}</span>
      )}
    </div>
  )
}
