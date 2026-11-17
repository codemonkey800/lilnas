import { Badge, Icon } from '@lilnas/ui'
import type { JSX } from 'react'

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
          <Icon name="lock" size={14} />
          <span className="sr-only">Gated by lilnas-auth</span>
        </span>
      ) : (
        <Badge
          title="No lilnas-auth middleware — anyone with the link gets in"
          tone="warn"
        >
          open
        </Badge>
      )}
      <a
        className="group flex min-w-0 items-center gap-1.5 font-mono text-mono text-ink-2 transition-colors duration-200 ease-standard hover:text-accent-hi"
        href={route.url}
      >
        <span className="truncate group-hover:underline">{label}</span>
        <Icon
          className="text-ink-3 group-hover:text-accent-hi"
          name="external"
          size={12}
        />
      </a>
    </div>
  )
}
