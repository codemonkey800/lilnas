'use client'

import { cns } from '@lilnas/utils/cns'
import { useId, useState } from 'react'

import { Icon } from 'src/app/components/icons'
import {
  isValidHostPattern,
  normalizeHostMatcher,
} from 'src/grants/host-matcher'

// The one rule an admin reaches for most often: every externally-exposed
// dev instance (docs/lilnas-expose.md). Offered as a one-click chip so it
// never has to be typed.
const PRESET_RULE = '*.dev.lilnas.io'

export type AccessRulesFieldProps = {
  // The access-rule patterns currently selected — already normalized.
  rules: string[]
  onAdd: (rule: string) => void
  onRemove: (rule: string) => void
  disabled: boolean
}

// Access rules (`*.dev.lilnas.io`, see src/grants/host-matcher.ts) for the
// Edit-access and Add-person modals. Purely presentational over the parent's
// own selection: adding or removing a rule here only changes what that
// modal will submit, in the SAME batched call as its checkbox grid — no
// request of its own.
//
// The input checks a rule's SHAPE only (single leading `*.` over a valid
// domain). Whether the suffix is inside this deployment's domain family is
// REDIRECT_ALLOWED_SUFFIX, a server-only value — a rule outside it is
// rejected on save, and the modal shows that server error like any other.
export function AccessRulesField({
  rules,
  onAdd,
  onRemove,
  disabled,
}: AccessRulesFieldProps) {
  // Both modals mount this field at once, so the input id must be unique.
  const inputId = useId()
  const [draft, setDraft] = useState('')
  const [hasError, setHasError] = useState(false)

  function handleAdd() {
    const rule = normalizeHostMatcher(draft)
    if (!isValidHostPattern(rule)) {
      setHasError(true)
      return
    }
    setHasError(false)
    setDraft('')
    if (!rules.includes(rule)) {
      onAdd(rule)
    }
  }

  return (
    <div className={cns('field', hasError && 'has-error')}>
      <label htmlFor={inputId}>Access rules</label>
      {rules.length > 0 ? (
        <div className="service-chip-list">
          {rules.map(rule => (
            <span key={rule} className="chip chip-neutral">
              <Icon name="globe" />
              <span>{rule}</span>
              <button
                type="button"
                className="row"
                aria-label={`Remove rule ${rule}`}
                onClick={() => onRemove(rule)}
                disabled={disabled}
              >
                <Icon name="x" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
      <div className="row gap-2">
        <input
          id={inputId}
          className="input"
          type="text"
          placeholder="*.dev.lilnas.io"
          value={draft}
          onChange={event => {
            setDraft(event.target.value)
            setHasError(false)
          }}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault()
              handleAdd()
            }
          }}
          disabled={disabled}
        />
        <button
          type="button"
          className="btn btn-outline"
          onClick={handleAdd}
          disabled={disabled || draft.trim() === ''}
        >
          Add rule
        </button>
      </div>
      <span className="field-error">
        Use a single leading wildcard, like *.dev.lilnas.io.
      </span>
      {rules.includes(PRESET_RULE) ? null : (
        <div className="row gap-2">
          <button
            type="button"
            className="chip chip-pending"
            onClick={() => onAdd(PRESET_RULE)}
            disabled={disabled}
          >
            <Icon name="plus" />
            <span>{PRESET_RULE}</span>
          </button>
        </div>
      )}
      <span className="field-hint">
        A rule grants every site under it, including ones not discovered yet.
      </span>
    </div>
  )
}
