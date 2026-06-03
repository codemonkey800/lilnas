'use client'

import { cns } from '@lilnas/utils/cns'
import SearchIcon from '@mui/icons-material/Search'
import Button from '@mui/material/Button'
import InputAdornment from '@mui/material/InputAdornment'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import TextField from '@mui/material/TextField'
import { useEffect, useMemo, useRef } from 'react'

import type { RoutineRow } from 'src/db/types'
import { formatRelativeDay } from 'src/lib/format'
import { ARCHIVED_RECENT_CAP, selectVisibleArchived } from 'src/lib/stats'

type Props = {
  open: boolean
  onClose: () => void
  orderedArchived: RoutineRow[]
  archivedLastTrained: Map<number, Date>
  now: Date
  onSelect: (id: number) => void
  disabled: boolean
  query: string
  onQueryChange: (query: string) => void
}

export function ArchivedRoutinePicker({
  open,
  onClose,
  orderedArchived,
  archivedLastTrained,
  now,
  onSelect,
  disabled,
  query,
  onQueryChange,
}: Props) {
  const searchRef = useRef<HTMLInputElement>(null)

  // Focus search only on pointer:fine (desktop) so mobile keyboard doesn't
  // compress the viewport and hide the recency-ordered default rows.
  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => {
      if (window.matchMedia('(pointer: fine)').matches) {
        searchRef.current?.focus()
      }
    }, 200)
    return () => clearTimeout(timer)
  }, [open])

  // Keep the latest onClose in a ref so the popstate effect depends only on
  // [open] — prevents re-pushing a history marker on every search keystroke.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })

  // Back-button: push a history marker on open so hardware/browser Back closes
  // the drawer instead of navigating away (R8). Track whether close came from
  // popstate; if not (backdrop/Esc/select), consume the pushed entry on cleanup.
  useEffect(() => {
    if (!open) return
    let popped = false
    history.pushState({ drawerOpen: true }, '')
    const handlePop = () => {
      popped = true
      onCloseRef.current()
    }
    window.addEventListener('popstate', handlePop)
    return () => {
      window.removeEventListener('popstate', handlePop)
      if (!popped) history.back()
    }
  }, [open])

  const visible = useMemo(
    () => selectVisibleArchived(orderedArchived, query, ARCHIVED_RECENT_CAP),
    [orderedArchived, query],
  )

  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      onOpen={() => {}}
      disableSwipeToOpen
      disableDiscovery
      PaperProps={{
        sx: {
          maxHeight: '70vh',
          borderTopLeftRadius: 16,
          borderTopRightRadius: 16,
          bgcolor: 'rgb(23 23 23)',
          display: 'flex',
          flexDirection: 'column',
        },
      }}
    >
      {/* Sticky search */}
      <div className="sticky top-0 z-10 bg-neutral-900 px-4 pb-2 pt-4">
        <div className="mx-auto mb-2 h-1 w-10 rounded-full bg-neutral-700" />
        <TextField
          inputRef={searchRef}
          fullWidth
          size="small"
          placeholder="Search archived routines"
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          inputProps={{ 'aria-label': 'Search archived routines' }}
          InputProps={{
            startAdornment: (
              <InputAdornment position="start">
                <SearchIcon className="!text-neutral-400" fontSize="small" />
              </InputAdornment>
            ),
          }}
          sx={{
            '& .MuiOutlinedInput-root': {
              backgroundColor: 'rgb(38 38 38)',
              '& fieldset': { borderColor: 'rgb(64 64 64)' },
              '&:hover fieldset': { borderColor: 'rgb(82 82 82)' },
              '&.Mui-focused fieldset': { borderColor: 'rgb(249 115 22)' },
            },
            '& .MuiInputBase-input': {
              color: 'rgb(229 229 229)',
              fontFamily: 'inherit',
            },
          }}
        />
      </div>

      {/* Scrollable rows */}
      <div className="flex-1 overflow-y-auto">
        {visible.length === 0 && query.trim() !== '' ? (
          <p className="px-4 py-8 text-center text-sm text-neutral-500">
            No archived routines match &ldquo;{query}&rdquo;.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-800">
            {visible.map(r => {
              const lastTrained = archivedLastTrained.get(r.id)
              const label = lastTrained
                ? formatRelativeDay(lastTrained, now)
                : '—'
              return (
                <li key={r.id}>
                  <Button
                    fullWidth
                    disabled={disabled}
                    onClick={() => onSelect(r.id)}
                    className={cns(
                      '!flex !min-h-[56px] !items-center !justify-between !rounded-none !px-4 !py-3 !text-left',
                      '!normal-case !text-neutral-100',
                    )}
                    sx={{ fontFamily: 'inherit' }}
                  >
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="ml-4 shrink-0 text-sm text-neutral-500">
                      {label}
                    </span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </SwipeableDrawer>
  )
}
