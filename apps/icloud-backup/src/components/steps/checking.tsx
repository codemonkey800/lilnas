'use client'

import { Spinner } from '@lilnas/ui'
import type { JSX } from 'react'

import { CancelButton, useCancel } from 'src/components/steps/parts'
import type { StepProps } from 'src/components/steps/types'

/** Apple is checking the password or the code: a quiet spinner and Cancel. */
export function Checking({ actions }: StepProps): JSX.Element {
  const { cancel, error } = useCancel(actions)

  return (
    <div
      className="flex flex-col items-center gap-4 py-12 text-center"
      data-step="checking"
    >
      <div className="flex items-center gap-3" role="status">
        <Spinner size={20} />
        <h1 className="text-h2">Checking with Apple</h1>
      </div>
      <p className="text-sm text-ink-3">This takes a few seconds.</p>
      {error ? (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      ) : null}
      <CancelButton onCancel={cancel} />
    </div>
  )
}
