import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { JSX } from 'react'

import { Checking } from 'src/components/steps/checking'
import { Code } from 'src/components/steps/code'
import { Preflight } from 'src/components/steps/preflight'
import { SignIn } from 'src/components/steps/sign-in'
import { WaitingTurn } from 'src/components/steps/waiting-turn'
import { makeJob, makeView } from 'src/lib/__tests__/helpers/view'
import { ApiError } from 'src/lib/api'
import { PendingPasswordProvider } from 'src/lib/pending-password'
import { stepFor } from 'src/lib/step'
import type { BackupActions } from 'src/lib/use-backup'
import type { BackupView } from 'src/shared/contract'

// Not a real password. Specs assert it never reaches a log line or the DOM
// once sent.
const PASSWORD = 'fake-pass-for-tests'

function makeActions(over: Partial<BackupActions> = {}): BackupActions {
  const view = makeView('need_password')
  return {
    start: jest.fn().mockResolvedValue(view),
    sync: jest.fn().mockResolvedValue(view),
    submitPassword: jest.fn().mockResolvedValue(view),
    submitCode: jest.fn().mockResolvedValue(view),
    cancel: jest.fn().mockResolvedValue(view),
    resetImmichPassword: jest.fn().mockResolvedValue('unused'),
    reload: jest.fn(),
    ...over,
  }
}

const SCREENS = {
  preflight: Preflight,
  sign_in: SignIn,
  waiting_turn: WaitingTurn,
  code: Code,
  checking: Checking,
} as const

/** Picks the screen the way BackupApp does, inside the provider. */
function Screen({
  view,
  actions,
}: {
  view: BackupView
  actions: BackupActions
}): JSX.Element {
  const Step = SCREENS[stepFor(view) as keyof typeof SCREENS]
  return (
    <PendingPasswordProvider>
      <Step actions={actions} view={view} />
    </PendingPasswordProvider>
  )
}

function viewWith(
  state: Parameters<typeof makeView>[0],
  job: Parameters<typeof makeJob>[1] = {},
  over: Partial<BackupView> = {},
): BackupView {
  const base = makeView(state, over)
  return state ? { ...base, job: makeJob(state, job) } : base
}

async function signIn(
  user: ReturnType<typeof userEvent.setup>,
  appleId = 'nobody@example.invalid',
): Promise<void> {
  const id = screen.getByLabelText('Apple ID')
  if (!id.hasAttribute('readonly')) {
    await user.clear(id)
    await user.type(id, appleId)
  }
  await user.type(screen.getByLabelText('Password'), PASSWORD)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('sign-in screens', () => {
  const logs: jest.SpyInstance[] = []

  beforeEach(() => {
    for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
      logs.push(jest.spyOn(console, method).mockImplementation(() => undefined))
    }
  })

  afterEach(() => {
    logs.length = 0
  })

  function expectNoPasswordLogged(): void {
    for (const spy of logs) {
      expect(JSON.stringify(spy.mock.calls)).not.toContain(PASSWORD)
    }
  }

  describe('pre-flight', () => {
    it('lists the three checks and leads to the form on Continue', async () => {
      const user = userEvent.setup()
      render(<Screen actions={makeActions()} view={makeView(null)} />)

      expect(
        screen.getByText('Advanced Data Protection must be off'),
      ).toBeInTheDocument()
      expect(
        screen.getByText('Access iCloud Data on the Web must be on'),
      ).toBeInTheDocument()
      expect(
        screen.getByText(/You need an Apple device nearby/),
      ).toBeInTheDocument()
      expect(screen.getByText(/Text-message codes/)).toBeInTheDocument()
      expect(screen.queryByLabelText('Apple ID')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Continue' }))

      expect(screen.getByLabelText('Apple ID')).toHaveFocus()
      expect(screen.getByLabelText('Password')).toBeInTheDocument()
    })

    it('disables Continue and shows the low-space note', () => {
      render(
        <Screen
          actions={makeActions()}
          view={makeView(null, { lowDiskSpace: true })}
        />,
      )

      expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
      expect(screen.getByText('The server is low on space.')).toBeVisible()
    })

    it('Cancel on the form goes back to the checklist without a request', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      render(<Screen actions={actions} view={makeView(null)} />)

      await user.click(screen.getByRole('button', { name: 'Continue' }))
      await user.click(screen.getByRole('button', { name: 'Cancel' }))

      expect(screen.getByRole('button', { name: 'Continue' })).toBeVisible()
      expect(actions.cancel).not.toHaveBeenCalled()
    })
  })

  describe('sign in', () => {
    it('uses the autocomplete tokens and never puts the password in a URL', () => {
      render(
        <Screen actions={makeActions()} view={viewWith('need_password')} />,
      )

      expect(screen.getByLabelText('Apple ID')).toHaveAttribute(
        'autocomplete',
        'username',
      )
      const password = screen.getByLabelText('Password')
      expect(password).toHaveAttribute('autocomplete', 'current-password')
      expect(password).toHaveAttribute('type', 'password')
      expect(password.closest('form')).toHaveAttribute('method', 'post')
    })

    it('starts the job, then sends the password once when need_password arrives', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      const { rerender } = render(
        <Screen actions={actions} view={makeView(null)} />,
      )
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      await signIn(user, 'nobody@example.invalid')

      expect(actions.start).toHaveBeenCalledTimes(1)
      expect(actions.start).toHaveBeenCalledWith('nobody@example.invalid')
      expect(actions.submitPassword).not.toHaveBeenCalled()

      rerender(<Screen actions={actions} view={viewWith('need_password')} />)
      expect(actions.submitPassword).toHaveBeenCalledTimes(1)
      expect(actions.submitPassword).toHaveBeenCalledWith(PASSWORD)

      // Later renders, even in the same state, don't send it again.
      rerender(
        <Screen
          actions={actions}
          view={viewWith('need_password', { attempt: 1 })}
        />,
      )
      expect(actions.submitPassword).toHaveBeenCalledTimes(1)
      expectNoPasswordLogged()
    })

    it('sends the password once after a wait in queued_login', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      const { rerender } = render(
        <Screen actions={actions} view={makeView(null)} />,
      )
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      await signIn(user)

      rerender(
        <Screen
          actions={actions}
          view={viewWith('queued_login', { queuePosition: 2 })}
        />,
      )
      expect(screen.getByText("You're number 2 in line")).toBeVisible()
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
      expect(actions.submitPassword).not.toHaveBeenCalled()

      rerender(<Screen actions={actions} view={viewWith('need_password')} />)
      expect(actions.submitPassword).toHaveBeenCalledTimes(1)
      expect(actions.submitPassword).toHaveBeenCalledWith(PASSWORD)
      expect(actions.start).toHaveBeenCalledTimes(1)
      expectNoPasswordLogged()
    })

    it('cancelling in the queue drops the held password', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      const { rerender } = render(
        <Screen actions={actions} view={makeView(null)} />,
      )
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      await signIn(user)
      rerender(
        <Screen
          actions={actions}
          view={viewWith('queued_login', { queuePosition: 1 })}
        />,
      )

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(actions.cancel).toHaveBeenCalledTimes(1)

      rerender(<Screen actions={actions} view={viewWith('need_password')} />)
      expect(actions.submitPassword).not.toHaveBeenCalled()
    })

    it('makes the Apple ID read-only and focuses the password when it is locked', async () => {
      const user = userEvent.setup()
      const view = makeView(null)
      const locked: BackupView = {
        ...view,
        account: view.account && { ...view.account, appleIdLocked: true },
      }
      render(<Screen actions={makeActions()} view={locked} />)
      await user.click(screen.getByRole('button', { name: 'Continue' }))

      const id = screen.getByLabelText('Apple ID')
      expect(id).toHaveValue('nobody@example.invalid')
      expect(id).toHaveAttribute('readonly')
      expect(screen.getByLabelText('Password')).toHaveFocus()
    })

    it('makes the Apple ID read-only on a retry even when it is not locked', () => {
      render(
        <Screen actions={makeActions()} view={viewWith('need_password')} />,
      )

      const id = screen.getByLabelText('Apple ID')
      expect(id).toHaveValue('nobody@example.invalid')
      expect(id).toHaveAttribute('readonly')
      expect(screen.getByLabelText('Password')).toHaveFocus()
    })

    it('shows the wrong-password message with an empty field, and a retry goes straight out', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      render(
        <Screen
          actions={actions}
          view={viewWith('need_password', { authError: 'wrong_password' })}
        />,
      )

      expect(
        screen.getByText("That password didn't work, try again"),
      ).toBeVisible()
      expect(screen.getByLabelText('Password')).toHaveValue('')
      expect(screen.getByLabelText('Password')).toHaveAttribute(
        'aria-invalid',
        'true',
      )

      await user.type(screen.getByLabelText('Password'), PASSWORD)
      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(actions.start).not.toHaveBeenCalled()
      expect(actions.submitPassword).toHaveBeenCalledTimes(1)
      expect(actions.submitPassword).toHaveBeenCalledWith(PASSWORD)
      expect(screen.getByLabelText('Password')).toHaveValue('')
      expectNoPasswordLogged()
    })

    it('leaves no password in the DOM once it is sent', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      render(<Screen actions={actions} view={viewWith('need_password')} />)

      await user.type(screen.getByLabelText('Password'), PASSWORD)
      await user.click(screen.getByRole('button', { name: 'Sign in' }))

      expect(actions.submitPassword).toHaveBeenCalledWith(PASSWORD)
      expect(document.body.innerHTML).not.toContain(PASSWORD)
      expect(screen.getByLabelText('Password')).toHaveValue('')
    })

    it('shows a 409 message and keeps the form usable', async () => {
      const user = userEvent.setup()
      const actions = makeActions({
        start: jest
          .fn()
          .mockRejectedValue(new ApiError(409, 'A backup is already running.')),
      })
      const { rerender } = render(
        <Screen actions={actions} view={makeView(null)} />,
      )
      await user.click(screen.getByRole('button', { name: 'Continue' }))
      await signIn(user)

      expect(screen.getByText('A backup is already running.')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()

      // The failed start must not leave the password behind to be sent later.
      rerender(<Screen actions={actions} view={viewWith('need_password')} />)
      expect(actions.submitPassword).not.toHaveBeenCalled()
    })

    it('disables Sign in when the server is low on space', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      // Pre-flight blocks Continue, so reach the form directly.
      render(
        <PendingPasswordProvider>
          <SignIn
            actions={actions}
            view={makeView(null, { lowDiskSpace: true })}
          />
        </PendingPasswordProvider>,
      )

      expect(screen.getByText('The server is low on space.')).toBeVisible()
      await user.type(screen.getByLabelText('Apple ID'), 'a@example.invalid')
      await user.type(screen.getByLabelText('Password'), PASSWORD)
      expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
    })

    it('Cancel calls the action when a job is running', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      render(<Screen actions={actions} view={viewWith('need_password')} />)

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(actions.cancel).toHaveBeenCalledTimes(1)
    })
  })

  describe('waiting for a turn', () => {
    it("says you're next, has no inputs, and cancels", async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      render(
        <Screen
          actions={actions}
          view={viewWith('queued_login', { queuePosition: 1 })}
        />,
      )

      expect(screen.getByText("You're next")).toBeVisible()
      expect(screen.getByText(/Someone else is signing in/)).toBeVisible()
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(actions.cancel).toHaveBeenCalledTimes(1)
    })
  })

  describe('code', () => {
    it('focuses the input and has the one-time-code attributes', () => {
      render(<Screen actions={makeActions()} view={viewWith('need_code')} />)

      const input = screen.getByLabelText('6-digit code')
      expect(input).toHaveFocus()
      expect(input).toHaveAttribute('inputmode', 'numeric')
      expect(input).toHaveAttribute('autocomplete', 'one-time-code')
    })

    it('refuses letters and submits on the sixth digit', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      render(<Screen actions={actions} view={viewWith('need_code')} />)
      const input = screen.getByLabelText('6-digit code')

      await user.type(input, 'ab1c2')
      expect(input).toHaveValue('12')
      expect(actions.submitCode).not.toHaveBeenCalled()

      await user.type(input, '3456')
      expect(actions.submitCode).toHaveBeenCalledTimes(1)
      expect(actions.submitCode).toHaveBeenCalledWith('123456')
      expect(input).toHaveValue('')
    })

    it('submits a pasted code with a space in it', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      render(<Screen actions={actions} view={viewWith('need_code')} />)

      await user.click(screen.getByLabelText('6-digit code'))
      await user.paste('654 321')

      expect(actions.submitCode).toHaveBeenCalledWith('654321')
    })

    it('submits on Enter when a send failed and the digits are still there', async () => {
      const user = userEvent.setup()
      const actions = makeActions({
        submitCode: jest
          .fn()
          .mockRejectedValueOnce(new ApiError(0, 'Check your connection.'))
          .mockResolvedValue(makeView('checking_code')),
      })
      render(<Screen actions={actions} view={viewWith('need_code')} />)
      const input = screen.getByLabelText('6-digit code')

      await user.type(input, '123456')
      expect(await screen.findByText('Check your connection.')).toBeVisible()
      expect(input).toHaveValue('123456')

      await user.keyboard('{Enter}')
      expect(actions.submitCode).toHaveBeenCalledTimes(2)
    })

    it('shows the wrong-code message on an empty field until you type again', async () => {
      const user = userEvent.setup()
      render(
        <Screen
          actions={makeActions()}
          view={viewWith('need_code', { authError: 'wrong_code' })}
        />,
      )
      const input = screen.getByLabelText('6-digit code')

      expect(screen.getByText("That code didn't work, try again")).toBeVisible()
      expect(input).toHaveValue('')

      await user.type(input, '1')
      expect(
        screen.queryByText("That code didn't work, try again"),
      ).not.toBeInTheDocument()
    })

    it('clears the field after a code is sent', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      const { rerender } = render(
        <Screen actions={actions} view={viewWith('need_code')} />,
      )
      await user.type(screen.getByLabelText('6-digit code'), '123456')

      rerender(
        <Screen
          actions={actions}
          view={viewWith('need_code', { authError: 'wrong_code' })}
        />,
      )
      expect(screen.getByLabelText('6-digit code')).toHaveValue('')
      expect(screen.getByText("That code didn't work, try again")).toBeVisible()
    })

    it('Cancel calls the action', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      render(<Screen actions={actions} view={viewWith('need_code')} />)

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(actions.cancel).toHaveBeenCalledTimes(1)
    })
  })

  describe('checking', () => {
    it('says what is happening and offers Cancel', async () => {
      const user = userEvent.setup()
      const actions = makeActions()
      render(<Screen actions={actions} view={viewWith('checking_password')} />)

      expect(screen.getByRole('status')).toHaveTextContent(
        'Checking with Apple',
      )
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(actions.cancel).toHaveBeenCalledTimes(1)
    })

    it('shows a failed cancel instead of swallowing it', async () => {
      const user = userEvent.setup()
      const actions = makeActions({
        cancel: jest.fn().mockRejectedValue(new ApiError(409, 'Too late.')),
      })
      render(<Screen actions={actions} view={viewWith('checking_code')} />)

      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      expect(await screen.findByText('Too late.')).toBeVisible()
    })
  })
})
