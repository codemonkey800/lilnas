import { TextField, TextFieldProps } from '@mui/material'
import { useState } from 'react'

function format(value: string) {
  if (value === '' || Number.isNaN(+value)) {
    return value
  }

  let result = (+value).toLocaleString('en-US', { notation: 'standard' })

  if (value.endsWith('.')) {
    result += '.'
  }

  return result
}

export function NumberInput({
  id,
  label,
  name,
  onChange,
  value,
}: Pick<TextFieldProps, 'id' | 'name' | 'label'> & {
  onChange(value: string): void
  value: string
}) {
  const [input, setInput] = useState(format(value))

  return (
    <TextField
      fullWidth
      id={id}
      name={name}
      label={label}
      variant="standard"
      value={input}
      onChange={event => {
        const value = event.target.value.replaceAll(',', '')

        if (value === '' || !Number.isNaN(+value)) {
          onChange(value)
          setInput(format(value))
        }
      }}
    />
  )
}
