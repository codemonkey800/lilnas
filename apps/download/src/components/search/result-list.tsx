import { Badge } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { Media } from '@lilnas/utils/download/types'
import type { ComponentPropsWithoutRef, JSX } from 'react'

import {
  RESULT_KIND_ICONS,
  RESULT_KIND_LABELS,
  resultGenres,
  resultRuntime,
  resultYear,
} from 'src/components/search/result-meta'
import { MChip } from 'src/components/ui/mchip'
import { Poster } from 'src/components/ui/poster'
import { UNKNOWN_VALUE } from 'src/lib/format'
import { mediaHref } from 'src/lib/media-route'

const ROW = cns(
  'flex items-center gap-3 rounded-lg border border-line bg-surface p-2.5',
  'transition-[border-color,background-color] duration-200 ease-standard',
  'hover:border-line-loud hover:bg-surface-2',
)

/** `Movie · 1h 52m`, or just `Movie` when the runtime isn't known. */
function kindAndRuntime(media: Media): string {
  const kind = RESULT_KIND_LABELS[media.type]
  const runtime = resultRuntime(media)

  return runtime === UNKNOWN_VALUE ? kind : `${kind} · ${runtime}`
}

export type ResultListProps = Omit<
  ComponentPropsWithoutRef<'div'>,
  'children'
> & {
  items: Media[]
}

/**
 * The results as a list: a row each, with the poster, the title and its kind,
 * then genre (from `sm`), year and a type badge. Every row is one link to the
 * detail page. Ordering is the toolbar's Sort menu, so there are no sortable
 * column headers.
 */
export function ResultList({
  items,
  className,
  ...props
}: ResultListProps): JSX.Element {
  return (
    <div
      {...props}
      className={cns('stagger flex flex-col gap-2', className)}
      data-view="list"
    >
      {items.map(media => (
        <a className={ROW} href={mediaHref(media)} key={media.id}>
          <Poster
            className="w-12"
            seed={media.id}
            shape="tall"
            src={media.posterUrl}
          />
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <p className="truncate text-h3">{media.title}</p>
            <MChip
              className="text-cap text-ink-3 capitalize"
              icon={RESULT_KIND_ICONS[media.type]}
              label={kindAndRuntime(media)}
            />
          </div>
          <span className="hidden w-40 truncate text-cap text-ink-3 sm:block">
            {resultGenres(media)}
          </span>
          <span className="w-12 text-right text-sm tabular-nums">
            {resultYear(media)}
          </span>
          <Badge className="capitalize">{RESULT_KIND_LABELS[media.type]}</Badge>
        </a>
      ))}
    </div>
  )
}
