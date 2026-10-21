'use client'

import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'
import { useState } from 'react'

import { Button } from 'src/components/ui/button'
import { Callout } from 'src/components/ui/callout'
import type { IconName } from 'src/components/ui/icon'
import { Kbd } from 'src/components/ui/kbd'
import {
  type ActionResult,
  type Operation,
  postAction,
  type StackAction,
  type StackView,
} from 'src/lib/api'
import { actionAvailability, shortPath } from 'src/lib/stack-display'

const ACTION_LABEL: Record<StackAction, string> = {
  up: 'Up',
  stop: 'Stop',
  restart: 'Restart',
  recreate: 'Recreate',
  down: 'Down',
}

const ACTION_ICON: Record<StackAction, IconName> = {
  up: 'play',
  stop: 'stop',
  restart: 'refresh',
  recreate: 'recreate',
  down: 'trash',
}

/** Actions that throw containers away, so they ask first. */
const CONFIRMED: readonly StackAction[] = ['recreate', 'down']

const CONFIRM_COPY: Record<'recreate' | 'down', (name: string) => string> = {
  recreate: name =>
    `Recreate rebuilds the containers of ${name} from its compose file. Volumes are kept.`,
  down: name =>
    `Down removes the containers and networks of ${name}. Volumes are kept.`,
}

type Failure = Exclude<ActionResult, { ok: true }>

function FailureNote({
  action,
  failure,
  stack,
}: {
  action: StackAction
  failure: Failure
  stack: StackView
}): JSX.Element {
  const label = ACTION_LABEL[action]

  if (failure.kind === 'busy') {
    const running = failure.operation?.action
    return (
      <Callout icon="terminal" tone="warn">
        <p className="font-medium text-ink">
          {running
            ? `${ACTION_LABEL[running]} is still running on ${stack.name}.`
            : `Another operation is still running on ${stack.name}.`}
        </p>
        <p className="mt-0.5 text-ink-3">
          Wait for it to finish, then press {label} again.
        </p>
      </Callout>
    )
  }

  if (failure.kind === 'preflight') {
    return (
      <Callout icon="file" tone="warn">
        <p className="font-medium text-ink">
          {label} can’t start {stack.name}: a required env file isn’t on this
          host.
        </p>
        <ul className="mt-1 flex flex-col gap-0.5">
          {failure.missing.map(path => (
            <li key={path}>
              <Kbd title={path}>{shortPath(path)}</Kbd>
            </li>
          ))}
        </ul>
        <p className="mt-1 text-ink-3">
          Run <Kbd className="mx-1">pnpm lilnas secrets decrypt</Kbd> on the
          host, then press {label} again.
        </p>
      </Callout>
    )
  }

  return (
    <Callout icon="alert" tone="bad">
      <p className="font-medium text-ink">
        {label} didn’t start on {stack.name}.
      </p>
      <p className="mt-1 font-mono text-mono-sm break-words text-ink-4">
        {failure.status ? `${failure.status} ` : ''}
        {failure.message}
      </p>
    </Callout>
  )
}

/**
 * The five actions. Up, Stop and Restart are the everyday ones and read as
 * buttons; Recreate and Down throw containers away, so they sit quieter and
 * ask first. Which are enabled is a pure function of the stack's state
 * (`actionAvailability`).
 *
 * The API refuses an action with 409 (another operation owns the stack) or 412
 * (a required env file is missing); both show up under the buttons. Whatever
 * the outcome, `onActed` runs so the card reloads and shows the operation.
 * `onStarted` also hands over the accepted operation itself, for a caller that
 * wants to follow it (a fast one can be over before the reload sees it).
 */
export function ActionBar({
  stack,
  onActed,
  onStarted,
  className,
}: {
  stack: StackView
  onActed: () => void
  onStarted?: (operation: Operation) => void
  className?: string
}): JSX.Element {
  const [pending, setPending] = useState<StackAction | null>(null)
  const [asking, setAsking] = useState<StackAction | null>(null)
  const [outcome, setOutcome] = useState<{
    action: StackAction
    failure: Failure
  } | null>(null)

  const available = actionAvailability(stack)
  const confirming = asking && available[asking] ? asking : null

  async function run(action: StackAction) {
    setPending(action)
    setAsking(null)
    setOutcome(null)

    const result = await postAction(stack.id, action)
    setPending(null)
    if (result.ok) onStarted?.(result.operation)
    else setOutcome({ action, failure: result })
    onActed()
  }

  function press(action: StackAction) {
    if (CONFIRMED.includes(action)) {
      setOutcome(null)
      setAsking(action)
    } else {
      void run(action)
    }
  }

  function button(action: StackAction, variant: 'outline' | 'ghost' | 'bad') {
    return (
      <Button
        disabled={!available[action] || pending !== null}
        icon={ACTION_ICON[action]}
        onClick={() => press(action)}
        size="sm"
        variant={variant}
      >
        {ACTION_LABEL[action]}
      </Button>
    )
  }

  return (
    <div
      className={cns(
        'mt-auto flex flex-col gap-3 border-t border-line-soft pt-3.5',
        className,
      )}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {button('up', 'outline')}
        {button('stop', 'outline')}
        {button('restart', 'outline')}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {button('recreate', 'ghost')}
          {button('down', 'bad')}
        </span>
      </div>

      {confirming === 'recreate' || confirming === 'down' ? (
        <Callout icon="alert" tone="warn">
          <p className="text-ink">{CONFIRM_COPY[confirming](stack.name)}</p>
          <div className="mt-2 flex gap-1.5">
            <Button
              onClick={() => void run(confirming)}
              size="sm"
              variant={confirming === 'down' ? 'bad' : 'outline'}
            >
              {ACTION_LABEL[confirming]} {stack.name}
            </Button>
            <Button onClick={() => setAsking(null)} size="sm" variant="ghost">
              Keep it
            </Button>
          </div>
        </Callout>
      ) : null}

      {outcome ? (
        <FailureNote
          action={outcome.action}
          failure={outcome.failure}
          stack={stack}
        />
      ) : null}
    </div>
  )
}
