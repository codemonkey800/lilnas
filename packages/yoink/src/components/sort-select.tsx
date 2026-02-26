'use client'

import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'

export type SortValue =
  | 'relevance'
  | 'title-asc'
  | 'title-desc'
  | 'added-desc'
  | 'added-asc'
  | 'release-desc'
  | 'release-asc'

const options: { value: SortValue; label: string }[] = [
  { value: 'relevance', label: 'Relevance' },
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
  showRelevance?: boolean
}

export function SortSelect({
  value,
  onChange,
  showRelevance,
}: SortSelectProps) {
  const visible = showRelevance
    ? options
    : options.filter(o => o.value !== 'relevance')

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
      {visible.map(o => (
        <MenuItem key={o.value} value={o.value}>
          {o.label}
        </MenuItem>
      ))}
    </Select>
  )
}
