import type { JSX } from 'react'

import { ActionBar } from 'src/components/overview/action-bar'
import { RouteLink } from 'src/components/overview/route-link'
import { SourceBadge, uniqueRoutes } from 'src/components/overview/stack-card'
import { StateChip } from 'src/components/overview/state-chip'
import { Icon } from 'src/components/ui/icon'
import type { Operation, StackView } from 'src/lib/api'
import { displayState } from 'src/lib/stack-display'

/** Name, state, where it comes from, its routes, and the five actions. */
export function StackHeader({
  stack,
  onActed,
  onStarted,
}: {
  stack: StackView
  onActed: () => void
  onStarted: (operation: Operation) => void
}): JSX.Element {
  const routes = uniqueRoutes(stack)

  return (
    <header className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
      <div className="flex min-w-0 flex-col gap-3">
        <a
          className="inline-flex items-center gap-1.5 self-start text-sm text-ink-3 hover:text-ink"
          href="/"
        >
          <Icon className="h-3 w-3 -scale-x-100 text-ink-4" name="arrow" />
          All stacks
        </a>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-h1 break-words">{stack.name}</h1>
          <StateChip state={displayState(stack)} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <SourceBadge path={stack.composeFile} />
          <span className="font-mono text-mono-sm text-ink-4">
            project {stack.projectName}
          </span>
        </div>
        {routes.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {routes.map(route => (
              <RouteLink key={route.url} route={route} />
            ))}
          </div>
        ) : null}
      </div>
      <ActionBar
        className="border-t-0 pt-0 md:mt-[30px] md:w-[400px] md:shrink-0"
        onActed={onActed}
        onStarted={onStarted}
        stack={stack}
      />
    </header>
  )
}
