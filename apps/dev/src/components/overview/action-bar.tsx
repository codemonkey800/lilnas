'use client'

import { Button, Icon, Kbd, Note } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import type { JSX } from 'react'
import { useState } from 'react'

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

/** Actions that throw containers away, so they ask first. */
const CONFIRMED: readonly StackAction[] = ['recreate', 'down']

/** What survives, said before the user commits (voice.md). */
const CONFIRM_COPY: Record<'recreate' | 'down', string> = {
  recreate:
    'Its containers are rebuilt from the compose file. Volumes are kept.',
  down: 'Its containers and networks are removed. Volumes are kept.',
}

type Failure = Exclude<ActionResult, { ok: true }>

/** The API's refusal codes, shown in mono after the sentence. */
function Code({ children }: { children: string | number }): JSX.Element {
  return (
    <span className="mt-1 block font-mono text-mono-sm text-ink-3">
      {children}
    </span>
  )
}

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
      <Note
        icon={<Icon name="alert" />}
        lead={
          running
            ? `${ACTION_LABEL[running]} is still running on ${stack.name}.`
            : `Another operation is still running on ${stack.name}.`
        }
        tone="warn"
      >
        Wait for it to finish, then press {label} again.
        <Code>409</Code>
      </Note>
    )
  }

  if (failure.kind === 'preflight') {
    return (
      <Note
        icon={<Icon name="alert" />}
        lead={`${label} can’t start ${stack.name}: a required env file isn’t on this host.`}
        tone="warn"
      >
        {failure.missing.map(path => (
          <span className="mt-1 block" key={path}>
            <Kbd title={path}>{shortPath(path)}</Kbd>
          </span>
        ))}
        Run <Kbd>pnpm lilnas secrets decrypt</Kbd> on the host, then press{' '}
        {label} again.
        <Code>412</Code>
      </Note>
    )
  }

  return (
    <Note
      icon={<Icon name="alert" />}
      lead={`${label} didn’t start on ${stack.name}.`}
      tone="bad"
    >
      <span className="block font-mono text-mono-sm break-words text-ink-3">
        {failure.status ? `${failure.status} ` : ''}
        {failure.message}
      </span>
    </Note>
  )
}

/**
 * The five actions. Up is the one accent; Recreate and Down throw containers
 * away, so they sit apart (`split` pushes them to the right edge on a card),
 * Down in red outline, and both ask first with an inline confirm that names
 * the object and what survives. Which are enabled is a pure function of the
 * stack's state (`actionAvailability`).
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
  split = false,
  className,
}: {
  stack: StackView
  onActed: () => void
  onStarted?: (operation: Operation) => void
  split?: boolean
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

  function button(
    action: StackAction,
    variant: 'accent' | 'outline' | 'bad',
    extra?: string,
  ) {
    return (
      <Button
        className={extra}
        disabled={!available[action] || pending !== null}
        loading={pending === action}
        onClick={() => press(action)}
        size="sm"
        variant={variant}
      >
        {ACTION_LABEL[action]}
      </Button>
    )
  }

  return (
    <div className={cns('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap items-center gap-1.5">
        {button('up', 'accent')}
        {button('stop', 'outline')}
        {button('restart', 'outline')}
        {button('recreate', 'outline', split ? 'sm:ml-auto' : undefined)}
        {button('down', 'bad')}
      </div>

      {confirming === 'recreate' || confirming === 'down' ? (
        <div className="flex flex-col gap-2">
          <Note
            icon={<Icon name="alert" />}
            lead={`${ACTION_LABEL[confirming]} ${stack.name}?`}
            tone="warn"
          >
            {CONFIRM_COPY[confirming]}
          </Note>
          <div className="flex flex-wrap gap-1.5">
            <Button
              className={cns(
                confirming === 'down' &&
                  'bg-bad text-bg-sunk hover:bg-bad/85 active:bg-bad/75',
              )}
              onClick={() => void run(confirming)}
              size="sm"
              variant="accent"
            >
              {ACTION_LABEL[confirming]} {stack.name}
            </Button>
            <Button onClick={() => setAsking(null)} size="sm" variant="ghost">
              Keep it
            </Button>
          </div>
        </div>
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
