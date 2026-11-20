'use client'

import { Button, EmptyState, Skeleton } from '@lilnas/ui'
import Link from 'next/link'
import type { ComponentType, JSX } from 'react'

import { Checking } from 'src/components/steps/checking'
import { Code } from 'src/components/steps/code'
import { Done } from 'src/components/steps/done'
import { Downloading } from 'src/components/steps/downloading'
import { Failed } from 'src/components/steps/failed'
import { Finishing } from 'src/components/steps/finishing'
import { Indexing } from 'src/components/steps/indexing'
import { Paused } from 'src/components/steps/paused'
import { Preflight } from 'src/components/steps/preflight'
import { Queued } from 'src/components/steps/queued'
import { SignIn } from 'src/components/steps/sign-in'
import { SignInAgain } from 'src/components/steps/sign-in-again'
import type { StepProps } from 'src/components/steps/types'
import { WaitingTurn } from 'src/components/steps/waiting-turn'
import { PendingPasswordProvider } from 'src/lib/pending-password'
import { stepFor, type StepName } from 'src/lib/step'
import { useBackup } from 'src/lib/use-backup'

const STEPS: Record<StepName, ComponentType<StepProps>> = {
  preflight: Preflight,
  sign_in: SignIn,
  waiting_turn: WaitingTurn,
  code: Code,
  checking: Checking,
  queued: Queued,
  indexing: Indexing,
  downloading: Downloading,
  finishing: Finishing,
  done: Done,
  sign_in_again: SignInAgain,
  paused: Paused,
  failed: Failed,
}

function ReconnectingBanner(): JSX.Element {
  return (
    <div
      className="flex items-center gap-2.5 border-b border-line bg-warn-ghost px-4 py-2.5 text-sm text-ink-2"
      role="status"
    >
      <span
        aria-hidden="true"
        className="size-3.5 shrink-0 animate-spin rounded-full border-2 border-warn border-t-transparent"
      />
      <p>
        <strong className="font-semibold text-warn">
          Lost the live connection.
        </strong>{' '}
        Reconnecting. Your backup keeps going in the meantime.
      </p>
    </div>
  )
}

function BackupSkeleton(): JSX.Element {
  return (
    <div aria-busy="true" aria-label="Loading your backup" role="status">
      <Skeleton className="h-5 w-20" />
      <Skeleton className="mt-4 h-8 w-3/4" />
      <Skeleton className="mt-3 h-4 w-full" />
      <Skeleton className="mt-6 h-32 w-full" />
    </div>
  )
}

/**
 * The whole page: loads the person's backup, keeps it live and shows the
 * screen for its step. Screens live in `components/steps/`; adding to one
 * never touches this file.
 */
export function BackupApp(): JSX.Element {
  const { view, live, error, actions } = useBackup()

  const Step = view ? STEPS[stepFor(view)] : null

  return (
    <PendingPasswordProvider>
      {view && !live ? <ReconnectingBanner /> : null}
      <main className="mx-auto w-full max-w-[560px] flex-1 px-4 py-6 sm:px-8 sm:py-12">
        {view?.isAdmin ? (
          <div className="mb-4 flex justify-end">
            <Button render={<Link href="/admin" />} size="sm" variant="ghost">
              Admin
            </Button>
          </div>
        ) : null}

        {Step && view ? <Step actions={actions} view={view} /> : null}

        {!view && error ? (
          <EmptyState
            action={
              <Button onClick={actions.reload} variant="accent">
                Try again
              </Button>
            }
            body={error.message}
            title="We couldn't load your backup"
          />
        ) : null}

        {!view && !error ? <BackupSkeleton /> : null}
      </main>
    </PendingPasswordProvider>
  )
}
