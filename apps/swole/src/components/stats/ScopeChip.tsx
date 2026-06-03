'use client'

import { cns } from '@lilnas/utils/cns'
import ArchiveOutlinedIcon from '@mui/icons-material/ArchiveOutlined'
import Chip from '@mui/material/Chip'

import type { ScopeChip as ScopeChipModel } from 'src/lib/stats'

type Props = {
  chip: ScopeChipModel
  onSelect: (href: string) => void
  disabled: boolean
}

export function ScopeChip({ chip, onSelect, disabled }: Props) {
  const isArchived = chip.kind === 'archived'
  const isSelected = chip.selected

  if (isArchived) {
    return (
      <Chip
        label={chip.label}
        variant="outlined"
        icon={
          <ArchiveOutlinedIcon className="!text-orange-300" fontSize="small" />
        }
        aria-disabled="true"
        aria-label={`${chip.label} — currently viewing archived routine (read-only)`}
        tabIndex={-1}
        className={cns(
          '!min-h-[40px] !cursor-default !py-2',
          '!border-orange-500/40 !bg-orange-500/10 !text-orange-200',
        )}
      />
    )
  }

  const isActiveSelected = isSelected
  return (
    <Chip
      label={chip.label}
      variant={isActiveSelected ? 'filled' : 'outlined'}
      clickable
      disabled={disabled}
      aria-pressed={isSelected}
      onClick={isSelected ? undefined : () => onSelect(chip.href)}
      className={cns(
        '!min-h-[40px] !py-2',
        isActiveSelected
          ? '!bg-orange-500 !text-white'
          : '!border-neutral-700 !bg-transparent !text-neutral-200',
      )}
    />
  )
}
