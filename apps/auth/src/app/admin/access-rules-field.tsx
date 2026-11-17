'use client'

import { Badge, Button, Field, Icon, Input } from '@lilnas/ui'
import { useId, useState } from 'react'

import {
  isValidHostPattern,
  normalizeHostMatcher,
} from 'src/grants/host-matcher'

// The one rule an admin reaches for most often: every externally-exposed
// dev instance (docs/lilnas-expose.md). Offered as a one-click button so it
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

  const messageId = `${inputId}-${hasError ? 'error' : 'hint'}`

  return (
    <Field
      label="Access rules"
      htmlFor={inputId}
      hint="A rule grants every site under it, including ones not discovered yet."
      error={
        hasError ? 'Use a single leading wildcard, like *.dev.lilnas.io.' : null
      }
    >
      {/* A fragment so Field leaves the controls alone: the input below is
          the one the label points at. */}
      <>
        <div className="flex flex-col gap-2">
          {rules.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5">
              {rules.map(rule => (
                // A badge is never clickable, so removing a rule is its own
                // button beside it.
                <li key={rule} className="flex items-center gap-0.5">
                  <Badge className="font-mono text-mono-sm">
                    <Icon name="globe" />
                    {rule}
                  </Badge>
                  <Button
                    aria-label={`Remove rule ${rule}`}
                    disabled={disabled}
                    icon="x"
                    size="sm"
                    variant="ghost"
                    onClick={() => onRemove(rule)}
                  />
                </li>
              ))}
            </ul>
          ) : null}
          <div className="flex gap-2">
            <Input
              id={inputId}
              mono
              aria-describedby={messageId}
              className="flex-1"
              disabled={disabled}
              invalid={hasError}
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
            />
            <Button
              disabled={disabled || draft.trim() === ''}
              variant="outline"
              onClick={handleAdd}
            >
              Add rule
            </Button>
          </div>
          {rules.includes(PRESET_RULE) ? null : (
            <div>
              <Button
                disabled={disabled}
                icon="plus"
                size="sm"
                variant="ghost"
                onClick={() => onAdd(PRESET_RULE)}
              >
                {PRESET_RULE}
              </Button>
            </div>
          )}
        </div>
      </>
    </Field>
  )
}
