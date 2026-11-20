'use client'

import { Badge, Card, StatusDot } from '@lilnas/ui'
import type { JSX } from 'react'

import {
  CancelButton,
  Intro,
  StepMarker,
  useCancel,
} from 'src/components/steps/parts'
import type { StepProps } from 'src/components/steps/types'

/**
 * Step 2, while someone else is signing in. No inputs. The password typed
 * before the wait stays in the pending-password provider; the sign-in screen
 * sends it when the turn comes. Cancel drops it.
 */
export function WaitingTurn({ view, actions }: StepProps): JSX.Element {
  const position = view.job?.queuePosition ?? 1
  const next = position <= 1
  const { cancel, error } = useCancel(actions)

  return (
    <div data-step="waiting_turn">
      <StepMarker label="Sign in" n={2} />
      <div className="mb-4">
        <Badge tone="warn">Waiting for a turn</Badge>
      </div>
      <Intro
        lede={
          next
            ? "Someone else is signing in. You're next, this page moves on by itself."
            : 'Other people are signing in first. This page moves on by itself when it is your turn.'
        }
        title={next ? "You're next" : `You're number ${position} in line`}
      />

      <Card className="mt-6 flex items-center gap-3" variant="sunk">
        <StatusDot pulse tone="accent" />
        <p className="text-sm text-ink-3">
          You can keep this tab open. There is nothing to type.
        </p>
      </Card>

      {error ? (
        <p className="mt-3 text-sm text-bad" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-6">
        <CancelButton onCancel={cancel} />
      </div>
    </div>
  )
}
