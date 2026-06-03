// Lookup maps for icon keys and button treatments. Keeps JSX/icon imports out
// of the pure runner.ts view-model.

import type { SvgIconComponent } from '@mui/icons-material'
import CheckIcon from '@mui/icons-material/Check'
import CloseIcon from '@mui/icons-material/Close'
import DirectionsRunIcon from '@mui/icons-material/DirectionsRun'
import HourglassEmptyIcon from '@mui/icons-material/HourglassEmpty'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp'
import RemoveIcon from '@mui/icons-material/Remove'
import SkipNextIcon from '@mui/icons-material/SkipNext'

import type { ButtonIconKey, ButtonTreatment } from 'src/lib/runner'

export const ICON_MAP: Record<ButtonIconKey, SvgIconComponent> = {
  increment: KeyboardArrowUpIcon,
  decrement: KeyboardArrowDownIcon,
  stay: RemoveIcon,
  complete: CheckIcon,
  hold: HourglassEmptyIcon,
  done: DirectionsRunIcon,
  failed: CloseIcon,
  skipped: SkipNextIcon,
}

export type ButtonStyleProps = {
  className: string
}

export function getTreatmentStyle(
  treatment: ButtonTreatment,
): ButtonStyleProps {
  switch (treatment) {
    case 'accent':
      return { className: 'bg-[#FF5722] hover:bg-[#F4511E]' }
    case 'red':
      return { className: 'bg-red-500 hover:bg-red-400' }
    case 'neutral':
      return { className: 'bg-neutral-700 hover:bg-neutral-600' }
    case 'amber':
      return { className: 'bg-amber-600 hover:bg-amber-500' }
  }
}
