'use client'

import { Button, Icon, type IconName } from '@lilnas/ui'
import { type JSX, useCallback, useState } from 'react'

import { Intro, LowSpaceNote, StepMarker } from 'src/components/steps/parts'
import { SignIn } from 'src/components/steps/sign-in'
import type { StepProps } from 'src/components/steps/types'

const CHECKS: { icon: IconName; title: string; where: string }[] = [
  {
    icon: 'shield',
    title: 'Advanced Data Protection must be off',
    where:
      'On your iPhone: Settings, tap your name, iCloud, Advanced Data Protection.',
  },
  {
    icon: 'globe',
    title: 'Access iCloud Data on the Web must be on',
    where:
      'On your iPhone: Settings, tap your name, iCloud, Access iCloud Data on the Web.',
  },
  {
    icon: 'device',
    title: 'You need an Apple device nearby for the 6-digit code',
    where:
      "Text-message codes and security keys don't work here. The code appears on an iPhone, iPad or Mac that's already signed in.",
  },
]

/**
 * Step 1: the three things to check. Continue leads into the sign-in form,
 * which is local UI state: the backend has no state for it. There is no
 * Cancel here because there is no job to cancel yet.
 */
export function Preflight({ view, actions }: StepProps): JSX.Element {
  const [continued, setContinued] = useState(false)
  const back = useCallback(() => setContinued(false), [])

  if (continued) {
    return <SignIn actions={actions} onBack={back} view={view} />
  }

  return (
    <div data-step="preflight">
      <StepMarker label="Check your settings" n={1} />
      <Intro
        lede="Two settings on your iPhone, and one thing to keep nearby. It takes a minute."
        title="Before you start"
      />

      {view.lowDiskSpace ? <LowSpaceNote className="mt-5" /> : null}

      <ul className="mt-6 flex flex-col gap-3">
        {CHECKS.map(check => (
          <li
            className="flex gap-3 rounded-lg border border-line bg-surface p-4"
            key={check.title}
          >
            <span className="grid size-[30px] shrink-0 place-items-center rounded-md bg-accent-ghost text-accent-hi">
              <Icon name={check.icon} size={16} />
            </span>
            <div className="min-w-0">
              <h3 className="text-h3">{check.title}</h3>
              <p className="mt-1 text-sm text-ink-3">{check.where}</p>
            </div>
          </li>
        ))}
      </ul>

      <Button
        className="mt-6 max-sm:w-full"
        disabled={view.lowDiskSpace}
        iconEnd="arrow"
        variant="accent"
        onClick={() => setContinued(true)}
      >
        Continue
      </Button>
    </div>
  )
}
