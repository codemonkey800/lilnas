import { cns } from '@lilnas/utils/cns'
import type { ComponentPropsWithoutRef, JSX } from 'react'

/**
 * The two named avatar sizes. Anything else is the 24px default, or a call
 * site overriding `h-*`/`w-*`/`text-*` through `className` the way the
 * mockups do (`class='h-[52px] w-[52px] text-[18px]'` on the profile header).
 * `cns` is `twMerge`, so the later utility wins rather than both landing on
 * the element and letting stylesheet order decide.
 */
export type AvatarSize = 'md' | 'xs'

/**
 * Each size owns its full height/width/font-size triple, and the default is a
 * triple of its own rather than a base the variants override. Two utilities
 * for the same property on one element are resolved by Tailwind's output
 * order, not ours - see the same note in `ui.pug`'s `btn` mixin.
 */
const AVATAR_SIZES: Record<AvatarSize, string> = {
  md: 'h-[30px] w-[30px] text-[12px]',
  xs: 'h-[18px] w-[18px] text-[8.5px]',
}

const AVATAR_DEFAULT_SIZE = 'h-6 w-6 text-[10.5px]'

/**
 * What a masked avatar shows in place of initials. Attribution masking
 * happens server-side: `GalleryItem.lastRequester` and `DownloadJob.requester`
 * arrive already `null` when the viewer is not allowed the true identity, and
 * the UI renders that `null` as this dash. The component owns the glyph so a
 * call site cannot pass one - see `AvatarMaskedProps`.
 *
 * Deliberately an en dash rather than `UNKNOWN_VALUE`'s em dash: every masked
 * call site in the mockups passes this exact glyph, because the avatar is a
 * fixed-width circle 18-52px across and an em dash at 8.5px reads as a rule
 * through the middle of it rather than a placeholder. `UNKNOWN_VALUE` stays
 * the glyph for empty *text*.
 */
export const MASKED_INITIALS = '–'

/**
 * `hidden` and `title` are both on `HTMLAttributes`; ours mean something
 * else, so they are removed here and re-declared below. `children` is removed
 * because the avatar's content is its initials, not a slot.
 */
type AvatarElementProps = Omit<
  ComponentPropsWithoutRef<'span'>,
  'children' | 'hidden' | 'title'
>

type AvatarCommonProps = AvatarElementProps & {
  /** The uv halo that marks "this is you". A two-layer shadow, not a border. */
  ring?: boolean
  size?: AvatarSize
  /** Native tooltip - the mockups use `title="Jeremy · you"` on the nav bar. */
  title?: string
}

type AvatarIdentifiedProps = AvatarCommonProps & {
  hidden?: false
  /**
   * Renders an `<a>` instead of a `<span>`. A call site opts in per the access
   * rules (own identity always, another user's only for an admin) rather than
   * every avatar in the app quietly becoming a link.
   */
  href?: string
  initials: string
}

type AvatarMaskedProps = AvatarCommonProps & {
  hidden: true
  /**
   * A masked identity has no profile to link to and no initials to leak, so
   * neither is accepted. This is the whole reason `AvatarProps` is a union.
   */
  href?: never
  initials?: never
}

export type AvatarProps = AvatarIdentifiedProps | AvatarMaskedProps

/**
 * Person marker. Initials, or a dashed outline when attribution is masked.
 *
 * Ported from `docs/features/download/designs/src/mixins/ui.pug`'s `avatar`
 * mixin. Every remaining prop is spread onto the root element, mirroring the
 * mixin's `&attributes(attributes)` convention.
 */
export function Avatar({
  className,
  hidden,
  href,
  initials,
  ring,
  size,
  ...props
}: AvatarProps): JSX.Element {
  // The type union already rules this out, but a masked identity linking to
  // the profile it is masking would leak exactly what the mask exists to
  // hide, so the runtime refuses it too rather than trusting the call site.
  const linkHref = hidden ? undefined : href
  const classes = cns(
    'flex shrink-0 items-center justify-center rounded-full border border-line bg-surface-3 font-semibold text-ink-2',
    size ? AVATAR_SIZES[size] : AVATAR_DEFAULT_SIZE,
    ring && 'shadow-[0_0_0_2px_var(--color-bg-sunk),0_0_0_4px_var(--color-uv)]',
    hidden && 'border-dashed text-ink-4',
    linkHref &&
      'transition-[border-color,background-color] duration-200 ease-uv hover:border-uv-dim hover:bg-surface-2',
    className,
  )
  const content = hidden ? MASKED_INITIALS : initials

  if (linkHref) {
    return (
      <a className={classes} href={linkHref} {...props}>
        {content}
      </a>
    )
  }

  return (
    <span className={classes} {...props}>
      {content}
    </span>
  )
}

export type CastPersonProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> &
  Pick<AvatarIdentifiedProps, 'initials'> & {
    name: string
  }

/**
 * One credited name: a medium avatar next to the person's name. Lives here
 * rather than in its own file because it is the same person-portrait
 * primitive with a label attached.
 *
 * Ported from `ui.pug`'s `castPerson` mixin.
 */
export function CastPerson({
  className,
  initials,
  name,
  ...props
}: CastPersonProps): JSX.Element {
  return (
    <div
      className={cns('flex shrink-0 items-center gap-2', className)}
      {...props}
    >
      <Avatar initials={initials} size="md" />
      <span className={cns('text-sm')}>{name}</span>
    </div>
  )
}
