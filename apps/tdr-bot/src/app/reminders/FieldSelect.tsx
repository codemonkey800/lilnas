import { Field, Select, useFieldId } from '@lilnas/ui'

interface FieldSelectProps {
  label: string
  hint?: string
  error?: string
  value: string
  options: readonly { value: string; label: string }[]
  disabled?: boolean
  onValueChange: (value: string) => void
}

/** A `Field` around a `Select`, which can't take the id and aria wiring itself. */
export function FieldSelect({
  label,
  hint,
  error,
  value,
  options,
  disabled,
  onValueChange,
}: FieldSelectProps) {
  const id = useFieldId()
  const message = error ?? hint
  const describedBy = message ? `${id}-${error ? 'error' : 'hint'}` : undefined

  return (
    <Field error={error} hint={hint} htmlFor={id} label={label}>
      <>
        <Select.Root
          disabled={disabled}
          items={Object.fromEntries(options.map(o => [o.value, o.label]))}
          value={value}
          onValueChange={next => {
            if (typeof next === 'string') onValueChange(next)
          }}
        >
          <Select.Trigger
            aria-describedby={describedBy}
            aria-invalid={error ? true : undefined}
            className="aria-invalid:border-bad"
            id={id}
          >
            <Select.Value />
          </Select.Trigger>
          <Select.Popup>
            {options.map(o => (
              <Select.Item key={o.value} value={o.value}>
                {o.label}
              </Select.Item>
            ))}
          </Select.Popup>
        </Select.Root>
      </>
    </Field>
  )
}
