import { Button, Note } from '@lilnas/ui'
import type { JSX, ReactNode } from 'react'

import { StateHead } from 'src/components/steps/state-head'
import { PHONE_FULL } from 'src/components/steps/styles'
import type { StepProps } from 'src/components/steps/types'
import { useAction } from 'src/components/steps/use-action'
import type { ErrorCode } from 'src/shared/contract'

interface Reason {
  lead: string
  detail: ReactNode
  /** Sign-in problems start again from the password; the rest retry. */
  signIn: boolean
  /** Shows the machine code in mono under the message. */
  showCode?: boolean
}

const SETTINGS = [
  'Advanced Data Protection must be off',
  'Access iCloud Data on the Web must be on',
] as const

/** The person pressed Stop: nothing broke, so nothing to report. */
const STOPPED: Reason = {
  lead: 'You stopped this backup.',
  detail: 'Photos already saved are safe.',
  signIn: false,
}

const GENERIC: Reason = {
  lead: 'Something went wrong.',
  detail:
    'The backup stopped. Try again, and if it keeps happening tell Jeremy.',
  signIn: false,
  showCode: true,
}

const REASONS: Record<ErrorCode, Reason> = {
  apple_access_denied: {
    lead: 'Apple refused access.',
    detail: 'Check these two settings on your iPhone and try again.',
    signIn: false,
  },
  wrong_password: {
    lead: "That password didn't work.",
    detail: 'Sign in again to try another one.',
    signIn: true,
  },
  login_timeout: {
    lead: 'Sign-in timed out.',
    detail: "Apple didn't get the code in time. Sign in again to start over.",
    signIn: true,
  },
  interrupted_login: {
    lead: 'The sign-in was interrupted.',
    detail: 'It stopped before it finished. Sign in again to start over.',
    signIn: true,
  },
  apple_indexing: {
    lead: "Apple isn't ready yet.",
    detail:
      "Apple is still preparing your library and didn't finish in time. Try again later; big libraries can take hours.",
    signIn: false,
  },
  immich_error: GENERIC,
  icloudpd_error: GENERIC,
  internal: GENERIC,
}

function Settings(): JSX.Element {
  return (
    <ul className="mt-3 flex flex-col gap-2 text-sm text-ink-2">
      {SETTINGS.map(setting => (
        <li
          key={setting}
          className="rounded-lg border border-line bg-surface p-3"
        >
          {setting}
          <span className="block text-ink-3">
            iPhone: Settings, your name, iCloud.
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The backup stopped: why, and the one button that fits the reason. */
export function Failed({ view, actions }: StepProps): JSX.Element {
  const retry = useAction()
  const { account, job } = view
  const stopped = job?.state === 'cancelled'
  const code = job?.errorCode ?? null
  const reason = stopped ? STOPPED : code ? REASONS[code] : GENERIC

  // Once a download has started (or finished) Apple's session may still be
  // good, so a sync can skip the password; otherwise start from the top.
  const sessionMayExist = Boolean(
    account?.appleIdLocked || account?.lastBackupAt,
  )
  const appleId = account?.appleId
  const useSignIn = reason.signIn || !sessionMayExist

  const onRetry = (): void => {
    if (useSignIn) {
      if (appleId) void retry.run(() => actions.start(appleId))
    } else {
      void retry.run(actions.sync)
    }
  }

  return (
    <section data-step="failed">
      <StateHead
        badge={
          stopped
            ? { tone: 'mute', label: 'Stopped' }
            : { tone: 'bad', label: 'Failed' }
        }
        title="Your backup didn't finish"
      />
      <Note
        className="mt-5"
        lead={reason.lead}
        tone={stopped ? 'accent' : 'bad'}
      >
        {reason.detail}
        {reason.showCode && code ? (
          <span className="mt-0.5 block font-mono text-mono-sm text-ink-3">
            {code}
          </span>
        ) : null}
      </Note>
      {code === 'apple_access_denied' ? <Settings /> : null}
      <Button
        className={`mt-5 ${PHONE_FULL}`}
        disabled={useSignIn && !appleId}
        icon={reason.signIn ? undefined : 'refresh'}
        iconEnd={reason.signIn ? 'arrow' : undefined}
        loading={retry.pending}
        variant="accent"
        onClick={onRetry}
      >
        {reason.signIn
          ? 'Sign in again'
          : stopped && !useSignIn
            ? 'Sync now'
            : 'Try again'}
      </Button>
      {retry.error ? (
        <Note className="mt-4" lead="That didn't work." tone="bad">
          {retry.error}
        </Note>
      ) : null}
    </section>
  )
}
