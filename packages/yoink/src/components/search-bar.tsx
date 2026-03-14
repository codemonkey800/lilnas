'use client'

import { cns } from '@lilnas/utils/cns'
import SearchIcon from '@mui/icons-material/Search'
import IconButton from '@mui/material/IconButton'
import InputBase from '@mui/material/InputBase'
import { useRef } from 'react'

const inputSx = {
  flex: 1,
  fontFamily: 'var(--font-mono)',
  fontSize: '0.875rem',
  color: 'var(--color-carbon-100)',
  '& .MuiInputBase-input::placeholder': {
    color: 'var(--color-carbon-400)',
    opacity: 1,
  },
} as const

interface SearchBarProps {
  query: string
  onQueryChange: (query: string) => void
}

export function SearchBar({ query, onQueryChange }: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      className={cns(
        'flex items-center gap-2 rounded-lg',
        'border border-carbon-500 bg-carbon-800 px-3 py-1.5',
        'transition-colors duration-200',
        'focus-within:border-terminal/60',
        'focus-within:shadow-[0_0_0_2px_rgba(57,255,20,0.15)]',
      )}
    >
      <IconButton
        size="small"
        className="shrink-0"
        tabIndex={-1}
        sx={{ pointerEvents: 'none' }}
      >
        <SearchIcon className="size-5 text-carbon-400" />
      </IconButton>

      <InputBase
        inputRef={inputRef}
        autoFocus
        placeholder="Search movies, shows…"
        value={query}
        onChange={e => onQueryChange(e.target.value)}
        sx={inputSx}
      />
    </div>
  )
}
