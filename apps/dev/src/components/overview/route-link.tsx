import type { JSX } from 'react'

import { Chip } from 'src/components/ui/chip'
import { Icon } from 'src/components/ui/icon'
import type { Route } from 'src/registry/registry.types'

/**
 * A route as a link. Gated by lilnas-auth gets a lock; anything else is open
 * to the whole internet, which is worth a loud word.
 */
export function RouteLink({ route }: { route: Route }): JSX.Element {
  const label = route.url.replace(/^https?:\/\//, '')

  return (
    <div className="flex min-w-0 items-center gap-2">
      {route.gated ? (
        <span className="flex shrink-0 text-ink-3" title="Gated by lilnas-auth">
          <Icon className="h-[13px] w-[13px]" name="lock" />
          <span className="sr-only">Gated by lilnas-auth</span>
        </span>
      ) : (
        <Chip
          className="h-[19px] px-2 text-[10.5px]"
          label="open"
          title="No lilnas-auth middleware — anyone with the link gets in"
          tone="warn"
        />
      )}
      <a
        className="group flex min-w-0 items-center gap-1.5 font-mono text-mono text-ink-2 transition-colors duration-200 ease-uv hover:text-uv-hi"
        href={route.url}
      >
        <span className="truncate group-hover:underline">{label}</span>
        <Icon
          className="h-[11px] w-[11px] shrink-0 text-ink-4 group-hover:text-uv-hi"
          name="external"
        />
      </a>
    </div>
  )
}
