'use client'

import { Button, Field, Input, Note } from '@lilnas/ui'
import {
  type FormEvent,
  type JSX,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  CancelButton,
  Intro,
  LowSpaceNote,
  messageOf,
  StepMarker,
  useCancel,
} from 'src/components/steps/parts'
import type { StepProps } from 'src/components/steps/types'
import { usePendingPassword } from 'src/lib/pending-password'

export type SignInProps = StepProps & {
  /** Where Cancel goes when there is no job yet: back to the checklist. */
  onBack?: () => void
}

/**
 * Step 2: Apple ID and password.
 *
 * With no job running, submit starts one with the Apple ID and parks the
 * password in the pending-password provider. The password is sent, once, when
 * the view reaches `need_password`, which may be after a wait for a turn
 * (this screen is gone by then and mounts again). On a retry the view is
 * already `need_password` and the password goes straight out. The password
 * lives in this component's state and the provider's ref, never in a URL,
 * storage or a log.
 */
export function SignIn({ view, actions, onBack }: SignInProps): JSX.Element {
  const pending = usePendingPassword()
  const { job, account } = view
  const retrying = job?.state === 'need_password'
  // A retry already told the server which Apple ID; it can't change here.
  const readOnlyId = Boolean(account?.appleIdLocked) || retrying

  const [appleId, setAppleId] = useState(account?.appleId ?? '')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const appleIdRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)
  const busy = submitting || sending

  const { cancel, error: cancelError } = useCancel(
    actions,
    retrying ? undefined : onBack,
  )

  useEffect(() => {
    ;(readOnlyId ? passwordRef : appleIdRef).current?.focus()
    // Once, when the screen appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The turn came: send the password held since the form was submitted.
  const sendHeld = useCallback(
    async (held: string): Promise<void> => {
      setSending(true)
      setError(null)
      try {
        await actions.submitPassword(held)
      } catch (err) {
        setError(messageOf(err))
      } finally {
        setSending(false)
      }
    },
    [actions],
  )

  const state = job?.state
  useEffect(() => {
    if (state !== 'need_password') return
    const held = pending.take()
    // The held password lives in a ref outside React, so this effect is the
    // one place that learns the turn has come; `sending` must show at once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (held !== null) void sendHeld(held)
  }, [state, pending, sendHeld])

  // Back on the form after a failure or a retry: the field is ready again.
  useEffect(() => {
    if (!busy && error) passwordRef.current?.focus()
  }, [busy, error])

  const startsJob = !retrying
  const blocked = startsJob && view.lowDiskSpace
  const canSubmit =
    !busy && !blocked && appleId.trim() !== '' && password !== ''

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!canSubmit) return

    setSubmitting(true)
    setError(null)
    try {
      if (retrying) {
        await actions.submitPassword(password)
      } else {
        pending.set(password)
        await actions.start(appleId.trim())
      }
      setPassword('')
    } catch (err) {
      if (!retrying) pending.clear()
      setError(messageOf(err))
    } finally {
      setSubmitting(false)
    }
  }

  const wrongPassword = job?.authError === 'wrong_password'
  const problem = error ?? cancelError

  return (
    <div data-step="sign_in">
      <StepMarker label="Sign in" n={2} />
      <Intro
        lede="Use the Apple ID your photos are stored under."
        title="Sign in to iCloud"
      />

      <Note className="mt-5" lead="Your password goes to Apple.">
        It isn&apos;t saved on this server.
      </Note>
      {blocked ? <LowSpaceNote className="mt-3" /> : null}
      {problem ? <Note className="mt-3" lead={problem} tone="bad" /> : null}

      {/* method="post" so a password can never end up in a URL, even if the
          submit handler were missing. */}
      <form method="post" onSubmit={submit}>
        <div className="mt-5 flex flex-col gap-4">
          <Field hint="The email you use for iCloud" label="Apple ID">
            <Input
              autoCapitalize="none"
              autoComplete="username"
              autoCorrect="off"
              disabled={busy}
              name="username"
              readOnly={readOnlyId}
              ref={appleIdRef}
              spellCheck={false}
              type="email"
              value={appleId}
              onChange={event => setAppleId(event.target.value)}
            />
          </Field>
          <Field
            error={
              wrongPassword ? "That password didn't work, try again" : null
            }
            label="Password"
          >
            <Input
              autoComplete="current-password"
              disabled={busy}
              name="password"
              ref={passwordRef}
              type="password"
              value={password}
              onChange={event => setPassword(event.target.value)}
            />
          </Field>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button
            aria-disabled={!canSubmit && !busy ? true : undefined}
            className="max-sm:w-full"
            disabled={blocked}
            loading={busy}
            type="submit"
            variant="accent"
          >
            {busy ? 'Signing in' : 'Sign in'}
          </Button>
          <CancelButton onCancel={cancel} />
        </div>
      </form>
    </div>
  )
}
