import { DownloadClient } from '@lilnas/utils/download/client'
import type { Media } from '@lilnas/utils/download/types'
import { DownloadType } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import { ButtonLink } from 'src/components/ui/button-link'
import type { ButtonSize, ButtonVariant } from 'src/components/ui/button-recipe'

/**
 * The label, in the one place it is spelled.
 *
 * "Save to device", never "Download" — spec §9. The two words mean opposite
 * directions in this app: *downloading* lands a file on the server's library,
 * and *saving* copies an already-downloaded file onto the machine you are
 * reading this on. A detail page that offered "Download" for both would make
 * the destructive one (re-grabbing a release) and the harmless one
 * indistinguishable.
 */
export const SAVE_LOCAL_LABEL = 'Save to device'

/** Which part of a multi-part video. `0` is the whole thing for a single-part one. */
const DEFAULT_VIDEO_PART = 0

export type MediaFileQuery = {
  /** Sonarr's episode id. Required for a show, rejected on anything else. */
  episodeId?: number
  /** Which part of a video. Rejected on anything else. */
  part?: number
}

/**
 * The browser-reachable URL for a title's file.
 *
 * ⚠️ **`browserInstance`, not `getIdentifiedDownloadClient()`.** This string
 * ends up in an `href` that a browser follows, and the identified server
 * client's base URL is `http://localhost:8081` — the Nest process, which has
 * no Traefik router at all and which no browser can reach. `browserInstance`
 * is based at the relative `/api`, so the request goes to the Next.js process
 * on the origin the user is already on and is rewritten to Nest from there
 * (`next.config.js`), arriving with the `X-Forwarded-User` headers Traefik's
 * `lilnas-auth` set on the way in. Identity is preserved precisely *because*
 * the link is relative.
 *
 * A URL builder, not a fetch — `getMediaFileUrl` does no I/O, so this is safe
 * to call during a server render.
 */
export function mediaFileHref(
  mediaId: string,
  query: MediaFileQuery = {},
): string {
  return DownloadClient.browserInstance.getMediaFileUrl(mediaId, query)
}

/**
 * Whether there is a file to save, decided from the media payload alone.
 *
 * One rule per type, each matching what `MediaFileService.resolveFileSource`
 * will actually do with the request:
 *
 * - **Movie** — `filePath` is the movie *file*, and Radarr populates it only
 *   once `hasFile`. Absent covers both "not in the library" and "requested but
 *   still downloading", which are exactly the two cases that 404.
 * - **Show** — a series is a *folder*, not a file (`Show.filePath` is the
 *   folder), so there is no series-level file to save and the backend answers
 *   400 rather than 404 for a show with no `episodeId`. An episode id is
 *   therefore the whole signal here.
 * - **Video** — the stored object URL for the requested part.
 *
 * ⚠️ **For a show this cannot see `hasFile`.** `Episode.hasFile` lives on the
 * seasons payload, not on `Media`, so the episode row rendering this is the
 * only thing that knows — render `SaveLocal` only for an episode whose
 * `hasFile` is true. Passing an `episodeId` for an episode with no file yields
 * a link that 404s when followed.
 */
export function canSaveLocal(
  media: Media,
  query: MediaFileQuery = {},
): boolean {
  switch (media.type) {
    case DownloadType.Movie:
      return media.filePath !== undefined
    case DownloadType.Show:
      return query.episodeId !== undefined
    case DownloadType.Video:
      return (
        media.downloadUrls?.[query.part ?? DEFAULT_VIDEO_PART] !== undefined
      )
  }
}

/**
 * Two of our prop names are real `<a>` attributes and have to be removed
 * before ours can take them, exactly as `Avatar` does for `hidden` and
 * `title`. Left in, each intersects to an impossible type (`string & Media`,
 * `string & number`) and every call site fails to type-check:
 *
 * - **`media`** — a media-query hint about the linked resource. Keeping our
 *   name is worth the `Omit`: `media` is what `DetailHeader`,
 *   `GalleryItemCard` and every other component in this app call the same
 *   payload, and the native attribute has no use here.
 * - **`part`** — the CSS shadow-parts attribute. Ours is a video part index,
 *   and it is `number` because that is what `GetMediaFileQuery` coerces to.
 *
 * `href` is removed because this component derives it, and `children` because
 * the label is a prop.
 */
export type SaveLocalProps = Omit<
  ComponentPropsWithoutRef<'a'>,
  'children' | 'href' | 'media' | 'part'
> & {
  /**
   * Sonarr's episode id. **Required for a show** and rejected with a 400 on a
   * movie or a video, so it is never passed "just in case".
   */
  episodeId?: number
  /** Overrides {@link SAVE_LOCAL_LABEL}. */
  label?: string
  media: Media
  /** Which part of a video. Defaults to `0`; rejected on other types. */
  part?: number
  size?: ButtonSize
  /** Defaults to `outline`, the weight `video-detail.pug` gives it. */
  variant?: ButtonVariant
}

/**
 * The explicit "put a copy on this machine" action, on all three detail pages.
 *
 * A real `<a>` with a real `href`, never a button with an `onClick`: the
 * backend answers this route with `Content-Disposition: attachment`, so the
 * browser's own download manager takes it from there — with the resume,
 * progress, retry and "save as" that a fetch-and-blob implementation would
 * have to rebuild badly. It also means the action survives middle-click and
 * "copy link address".
 *
 * Renders **`null` when there is no file to save** (see {@link canSaveLocal}),
 * rather than a link that 404s. On a show that includes the series header,
 * which has no `episodeId` and never will — the action belongs on an episode
 * row.
 *
 * ⚠️ Two things deliberately **not** done here:
 *
 * - **No pre-flight check.** Whether the file is still there is only knowable
 *   by asking, and asking costs an upstream call for a title nobody has said
 *   they want. A resolver that is degraded answers **503**, not 404 — surface
 *   that as "temporarily unavailable" rather than "missing" from the page's
 *   error boundary, where the failed navigation actually lands.
 * - **No resume affordance.** The disk branch (`res.sendFile`) honours
 *   `Range`; the MinIO branch does not. Nothing in this UI depends on the
 *   difference, and an affordance that silently worked for movies and shows
 *   but not for videos would be worse than none.
 */
export function SaveLocal({
  episodeId,
  label = SAVE_LOCAL_LABEL,
  media,
  part,
  size,
  variant = 'outline',
  ...props
}: SaveLocalProps): JSX.Element | null {
  // Each type carries only the scope that is legal for it. A stray `part` on a
  // movie or a stray `episodeId` on a video is a 400 from `parseScope`, so the
  // query is built from the type rather than from whatever was passed.
  const query: MediaFileQuery =
    media.type === DownloadType.Show
      ? { episodeId }
      : media.type === DownloadType.Video
        ? { part }
        : {}

  if (!canSaveLocal(media, query)) {
    return null
  }

  return (
    <ButtonLink
      {...props}
      href={mediaFileHref(media.id, query)}
      iconEnd="device"
      size={size}
      variant={variant}
    >
      {label}
    </ButtonLink>
  )
}
