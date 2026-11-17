import { Badge, Card, Icon, Kbd, Note } from '@lilnas/ui'
import type { JSX } from 'react'

import { ActionBar } from 'src/components/overview/action-bar'
import { RouteLink } from 'src/components/overview/route-link'
import { ServiceRow } from 'src/components/overview/service-row'
import { StateBadge } from 'src/components/overview/state-badge'
import { formatDuration } from 'src/lib/format'
import {
  displayState,
  missingEnvFiles,
  shortPath,
  stackNote,
} from 'src/lib/stack-display'
import type { Route } from 'src/registry/registry.types'
import type { StackView } from 'src/stacks/stacks.types'

/** Where the stack's detail page lives. Ids contain colons. */
export function stackHref(stack: StackView): string {
  return `/stacks/${encodeURIComponent(stack.id)}`
}

/** Where a stack comes from: the compose file the dashboard read it out of. */
export function SourceBadge({ path }: { path: string }): JSX.Element {
  return (
    <Badge className="max-w-full self-start font-mono" title={path}>
      <span className="min-w-0 truncate">{shortPath(path)}</span>
    </Badge>
  )
}

export function uniqueRoutes(stack: StackView): Route[] {
  const seen = new Set<string>()
  return stack.services
    .flatMap(s => s.routes)
    .filter(route => !seen.has(route.url) && seen.add(route.url))
}

/** The note under the containers: what's missing, what's running, or why. */
function CardNote({
  stack,
  now,
}: {
  stack: StackView
  now: number
}): JSX.Element | null {
  const missing = missingEnvFiles(stack)
  const state = displayState(stack)

  if (state === 'env-missing') {
    return (
      <Note
        icon={<Icon name="file" />}
        lead={`${stack.name} can’t start: ${
          missing.length === 1
            ? 'a required env file isn’t'
            : 'required env files aren’t'
        } on this host.`}
        tone="warn"
      >
        {missing.map(path => (
          <span className="mt-1 block" key={path}>
            <Kbd title={path}>{shortPath(path)}</Kbd>
          </span>
        ))}
        Run <Kbd>pnpm lilnas secrets decrypt</Kbd> there, then press Up.
      </Note>
    )
  }

  if (state === 'busy') {
    const op = stack.operation
    const last = op?.lines.at(-1)?.text
    const action = op?.action ?? 'working'
    return (
      <Note
        icon={<Icon name="terminal" />}
        lead={`${action.charAt(0).toUpperCase()}${action.slice(1)} is running.`}
        tone="accent"
      >
        {op
          ? `${formatDuration(now - Date.parse(op.startedAt))} so far.`
          : null}
        {last ? (
          <span className="mt-1 block font-mono text-mono-sm break-words text-ink-3">
            {last}
          </span>
        ) : null}
      </Note>
    )
  }

  const note = stackNote(stack, now)
  return note ? (
    <Note icon={<Icon name={note.icon} />} lead={note.text} tone={note.tone}>
      {note.detail}
    </Note>
  ) : null
}

/** A stack card. The same for a lilnas app and a `~/dev` project. */
export function StackCard({
  stack,
  now,
  onChanged,
}: {
  stack: StackView
  now: number
  onChanged: () => void
}): JSX.Element {
  const routes = uniqueRoutes(stack)

  return (
    <article>
      <Card className="flex flex-col gap-3 transition-[border-color] duration-200 ease-standard hover:border-line-loud">
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-3">
            <h3 className="min-w-0 text-h3 break-words">
              <a
                className="hover:text-accent-hi hover:underline"
                href={stackHref(stack)}
              >
                {stack.name}
              </a>
            </h3>
            <StateBadge state={displayState(stack)} />
          </div>
          <SourceBadge path={stack.composeFile} />
        </div>

        {routes.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            {routes.map(route => (
              <RouteLink key={route.url} route={route} />
            ))}
          </div>
        ) : null}

        <div className="flex flex-col gap-3 border-t border-line-soft pt-3">
          {stack.services.map(service => (
            <ServiceRow key={service.name} now={now} service={service} />
          ))}
        </div>

        <CardNote now={now} stack={stack} />

        <ActionBar
          className="mt-auto border-t border-line-soft pt-3"
          onActed={onChanged}
          split
          stack={stack}
        />
      </Card>
    </article>
  )
}
