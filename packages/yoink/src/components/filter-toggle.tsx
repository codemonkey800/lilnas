'use client'

import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'

export type FilterValue = 'all' | 'movies' | 'shows'

const options: { value: FilterValue; label: string }[] = [
  { value: 'all', label: 'Both' },
  { value: 'movies', label: 'Movies' },
  { value: 'shows', label: 'Shows' },
]

interface FilterToggleProps {
  value: FilterValue
  onChange: (value: FilterValue) => void
}

export function FilterToggle({ value, onChange }: FilterToggleProps) {
  return (
    <>
      <Select
        value={value}
        onChange={e => onChange(e.target.value as FilterValue)}
        size="small"
        sx={{
          display: { xs: 'inline-flex', sm: 'none' },
          minWidth: 100,
          fontFamily: 'inherit',
          fontSize: '0.875rem',
        }}
      >
        {options.map(o => (
          <MenuItem key={o.value} value={o.value}>
            {o.label}
          </MenuItem>
        ))}
      </Select>

      <ToggleButtonGroup
        value={value}
        exclusive
        onChange={(_, val: FilterValue | null) => {
          if (val) onChange(val)
        }}
        size="small"
        sx={{ display: { xs: 'none', sm: 'flex' } }}
      >
        {options.map(o => (
          <ToggleButton key={o.value} value={o.value}>
            {o.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </>
  )
}
