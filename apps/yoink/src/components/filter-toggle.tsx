'use client'

import FilterListIcon from '@mui/icons-material/FilterList'
import MovieIcon from '@mui/icons-material/Movie'
import TvIcon from '@mui/icons-material/Tv'
import MenuItem from '@mui/material/MenuItem'
import Select from '@mui/material/Select'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import type { ReactNode } from 'react'

export type FilterValue = 'all' | 'movies' | 'shows'

const options: { value: FilterValue; label: string; icon: ReactNode }[] = [
  { value: 'all', label: 'Both', icon: <FilterListIcon fontSize="small" /> },
  { value: 'movies', label: 'Movies', icon: <MovieIcon fontSize="small" /> },
  { value: 'shows', label: 'Shows', icon: <TvIcon fontSize="small" /> },
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
        renderValue={val => {
          const opt = options.find(o => o.value === val)
          if (!opt) return val
          return (
            <span className="flex items-center gap-1">
              {opt.icon}
              {opt.label}
            </span>
          )
        }}
        sx={{
          display: { xs: 'inline-flex', sm: 'none' },
          minWidth: 80,
          fontFamily: 'inherit',
          fontSize: '0.875rem',
        }}
      >
        {options.map(o => (
          <MenuItem key={o.value} value={o.value}>
            <span className="flex items-center gap-2">
              {o.icon}
              {o.label}
            </span>
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
