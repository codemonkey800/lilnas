import type { JSX } from 'react'

import { ActionBar } from 'src/components/overview/action-bar'
import { RouteLink } from 'src/components/overview/route-link'
import { ServiceRow } from 'src/components/overview/service-row'
import { StateChip } from 'src/components/overview/state-chip'
import { Callout } from 'src/components/ui/callout'
import { Icon } from 'src/components/ui/icon'
import { Kbd } from 'src/components/ui/kbd'
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
    <span
      className="inline-flex max-w-full items-center gap-1.5 self-start rounded-full border border-line bg-bg-sunk py-[3px] pr-2.5 pl-2 font-mono text-mono-sm text-ink-3"
      title={path}
    >
      <Icon className="h-[11px] w-[11px] shrink-0 text-ink-4" name="file" />
      <span className="truncate">{shortPath(path)}</span>
    </span>
  )
}

export function uniqueRoutes(stack: StackView): Route[] {
  const seen = new Set<string>()
  return stack.services
    .flatMap(s => s.routes)
    .filter(route => !seen.has(route.url) && seen.add(route.url))
}

/** The callout under the containers: what's missing, what's running, or why. */
function CardCallout({
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
      <Callout icon="file" tone="warn">
        <p>
          {missing.map((path, i) => (
            <span key={path}>
              {i > 0 ? ', ' : null}
              <Kbd title={path}>{shortPath(path)}</Kbd>
            </span>
          ))}{' '}
          {missing.length === 1 ? 'isn’t' : 'aren’t'} on this host, so{' '}
          {stack.name} can’t start.
        </p>
        <p className="mt-1 text-ink-3">
          Run <Kbd className="mx-1">pnpm lilnas secrets decrypt</Kbd> on the
          host, then press Up.
        </p>
      </Callout>
    )
  }

  if (state === 'busy') {
    const op = stack.operation
    const last = op?.lines.at(-1)?.text
    return (
      <Callout icon="terminal" tone="mute">
        <p className="flex items-center gap-2 font-mono text-mono-sm text-ink-3">
          <span>
            {op?.action ?? 'working'}
            {op ? ` · ${formatDuration(now - Date.parse(op.startedAt))}` : null}
          </span>
        </p>
        {last ? (
          <p className="mt-0.5 font-mono text-mono-sm break-words text-ink-2">
            {last}
          </p>
        ) : null}
      </Callout>
    )
  }

  const note = stackNote(stack, now)
  return note ? (
    <Callout icon={note.icon} tone={note.tone}>
      <p>{note.text}</p>
      {note.detail ? <p className="mt-0.5 text-ink-3">{note.detail}</p> : null}
    </Callout>
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
    <article className="flex flex-col gap-3.5 rounded-lg border border-line bg-surface p-4 transition-[border-color,background-color] duration-200 ease-uv hover:border-uv-dim sm:p-5">
      <div className="flex flex-col gap-2">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-h3 break-words">
            <a
              className="hover:text-uv-hi hover:underline"
              href={stackHref(stack)}
            >
              {stack.name}
            </a>
          </h3>
          <StateChip state={displayState(stack)} />
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

      <div className="flex flex-col gap-3 border-t border-line-soft pt-3.5">
        {stack.services.map(service => (
          <ServiceRow key={service.name} now={now} service={service} />
        ))}
      </div>

      <CardCallout now={now} stack={stack} />

      <ActionBar onActed={onChanged} stack={stack} />
    </article>
  )
}
