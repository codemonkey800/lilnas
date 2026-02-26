'use client'

import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'

export type SortValue =
  | 'title-asc'
  | 'title-desc'
  | 'added-desc'
  | 'added-asc'
  | 'release-desc'
  | 'release-asc'

const options: { value: SortValue; label: string }[] = [
  { value: 'title-asc', label: 'Title (A–Z)' },
  { value: 'title-desc', label: 'Title (Z–A)' },
  { value: 'added-desc', label: 'Date Added (Newest)' },
  { value: 'added-asc', label: 'Date Added (Oldest)' },
  { value: 'release-desc', label: 'Release Date (Newest)' },
  { value: 'release-asc', label: 'Release Date (Oldest)' },
]

interface SortSelectProps {
  value: SortValue
  onChange: (value: SortValue) => void
}

export function SortSelect({ value, onChange }: SortSelectProps) {
  return (
    <Select
      value={value}
      onChange={e => onChange(e.target.value as SortValue)}
      size="small"
      sx={{
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
  )
}
