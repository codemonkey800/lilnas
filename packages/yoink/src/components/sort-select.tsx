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

const options: { value: SortValue; label: string; mobileLabel: string }[] = [
  { value: 'relevance', label: 'Relevance', mobileLabel: 'Relevance' },
  { value: 'title-asc', label: 'Title (A–Z)', mobileLabel: 'A–Z' },
  { value: 'title-desc', label: 'Title (Z–A)', mobileLabel: 'Z–A' },
  { value: 'added-desc', label: 'Date Added (Newest)', mobileLabel: 'Newest' },
  { value: 'added-asc', label: 'Date Added (Oldest)', mobileLabel: 'Oldest' },
  {
    value: 'release-desc',
    label: 'Release Date (Newest)',
    mobileLabel: 'Release ↓',
  },
  {
    value: 'release-asc',
    label: 'Release Date (Oldest)',
    mobileLabel: 'Release ↑',
  },
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
      renderValue={val => {
        const opt = options.find(o => o.value === val)
        if (!opt) return val
        return (
          <>
            <span className="sm:hidden">{opt.mobileLabel}</span>
            <span className="hidden sm:inline">{opt.label}</span>
          </>
        )
      }}
      sx={{
        minWidth: { xs: 80, sm: 100 },
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
