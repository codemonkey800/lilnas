'use client'

import { Button } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import {
  type ChangeEvent,
  type FormEvent,
  type JSX,
  useEffect,
  useRef,
  useState,
} from 'react'

import {
  CancelButton,
  Intro,
  messageOf,
  StepMarker,
  useCancel,
} from 'src/components/steps/parts'
import type { StepProps } from 'src/components/steps/types'

const LENGTH = 6

/**
 * Step 3: the six digits from an Apple device. One real input sits over six
 * drawn cells, so autofill, paste and Backspace behave like any text field.
 * It takes digits only, submits on the sixth and on Enter, and empties once
 * the code is sent.
 */
export function Code({ view, actions }: StepProps): JSX.Element {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [focused, setFocused] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const { cancel, error: cancelError } = useCancel(actions)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Back to typing after a send: the input was disabled and lost focus.
  useEffect(() => {
    if (!busy) inputRef.current?.focus()
  }, [busy])

  async function send(value: string): Promise<void> {
    if (busy || value.length !== LENGTH) return
    setBusy(true)
    setError(null)
    try {
      await actions.submitCode(value)
      setCode('')
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  function change(event: ChangeEvent<HTMLInputElement>): void {
    const digits = event.target.value.replace(/\D/g, '').slice(0, LENGTH)
    setCode(digits)
    setError(null)
    if (digits.length === LENGTH) void send(digits)
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    void send(code)
  }

  // Typing again clears the message.
  const wrongCode = view.job?.authError === 'wrong_code' && code === ''
  const message = wrongCode ? "That code didn't work, try again" : error
  const problem = message ?? cancelError
  const active = focused && !busy ? Math.min(code.length, LENGTH - 1) : -1

  return (
    <div data-step="code">
      <StepMarker label="Enter the code" n={3} />
      <Intro
        lede="Enter the code shown on your Apple device."
        title="Enter the code"
      />
      <p className="mt-1 text-sm text-ink-3" id="code-hint">
        It pops up on an iPhone, iPad or Mac that is signed in to this Apple ID.
      </p>

      <form method="post" onSubmit={submit}>
        <div className="relative mt-6 flex w-fit gap-2">
          {Array.from({ length: LENGTH }, (_, i) => (
            <span
              aria-hidden="true"
              className={cns(
                'grid h-12 w-12 min-w-0 place-items-center rounded-md border bg-bg-sunk font-mono text-h2',
                'transition-[border-color,box-shadow] duration-200 ease-standard',
                problem ? 'border-bad' : 'border-line-control',
                i === active && 'border-accent ring-2 ring-accent-ghost',
                busy && 'opacity-40',
              )}
              key={i}
            >
              {code[i] ?? ''}
            </span>
          ))}
          <input
            aria-describedby="code-hint"
            aria-invalid={problem ? true : undefined}
            aria-label="6-digit code"
            autoComplete="one-time-code"
            className="absolute inset-0 size-full cursor-text opacity-0 focus:outline-none"
            disabled={busy}
            inputMode="numeric"
            name="code"
            pattern="[0-9]*"
            ref={inputRef}
            type="text"
            value={code}
            onBlur={() => setFocused(false)}
            onChange={change}
            onFocus={() => setFocused(true)}
          />
        </div>
        {problem ? (
          <p className="mt-2 text-xs text-bad" role="alert">
            {problem}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button
            className="max-sm:w-full"
            disabled={code.length !== LENGTH && !busy}
            loading={busy}
            type="submit"
            variant="accent"
          >
            {busy ? 'Checking' : 'Check code'}
          </Button>
          <CancelButton onCancel={cancel} />
        </div>
      </form>
    </div>
  )
}
