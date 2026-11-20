import { Button, Note } from '@lilnas/ui'
import type { JSX } from 'react'

import { StateHead } from 'src/components/steps/state-head'
import { PHONE_FULL } from 'src/components/steps/styles'
import type { StepProps } from 'src/components/steps/types'
import { useAction } from 'src/components/steps/use-action'

/** Apple ended the session the backup was using. */
export function SignInAgain({ view, actions }: StepProps): JSX.Element {
  const signIn = useAction()
  const appleId = view.account?.appleId

  return (
    <section data-step="sign_in_again">
      <StateHead
        badge={{ tone: 'warn', label: 'Needs sign-in' }}
        lede="Apple ended the sign-in your backup was using. The photos already saved are safe."
        title="Apple wants you to sign in again"
      />
      <Button
        className={PHONE_FULL}
        disabled={!appleId}
        iconEnd="arrow"
        loading={signIn.pending}
        variant="accent"
        onClick={() => {
          if (appleId) void signIn.run(() => actions.start(appleId))
        }}
      >
        Sign in again
      </Button>
      {signIn.error ? (
        <Note className="mt-4" lead="Couldn't start the sign-in." tone="bad">
          {signIn.error}
        </Note>
      ) : null}
    </section>
  )
}
