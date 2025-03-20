import {
  FormControl,
  InputLabel,
  MenuItem,
  Select as MUISelect,
  SelectProps,
} from '@mui/material'

export interface SelectItem<T extends string> {
  label: string
  value: T
}

export function Select<T extends string>({
  id,
  items,
  label,
  onChange,
  value,
  ...props
}: Pick<SelectProps, 'id' | 'label' | 'name'> & {
  items: SelectItem<T>[]
  onChange(value: T): void
  value: T
}) {
  const labelId = id ? `${id}-label` : undefined

  return (
    <FormControl variant="standard">
      <InputLabel id={labelId}>{label}</InputLabel>
      <MUISelect
        id={id}
        label={label}
        labelId={labelId}
        onChange={event => onChange(event.target.value as T)}
        value={value}
        {...props}
      >
        {items.map(item => (
          <MenuItem key={item.value} value={item.value}>
            {item.label}
          </MenuItem>
        ))}
      </MUISelect>
    </FormControl>
  )
}
