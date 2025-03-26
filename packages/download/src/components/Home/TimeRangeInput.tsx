'use client'

import { cns } from '@lilnas/utils/cns'
import { Checkbox, TextField } from '@mui/material'
import { useMask } from '@react-input/mask'
import { useAtom } from 'jotai'
import { match } from 'ts-pattern'

import { TIME_REGEX } from 'src/download/schema'
import { endTimeAtom, showTimeRangeAtom, startTimeAtom } from 'src/store/form'

import { isBefore } from './utils'

export function TimeRangeInput() {
  const [showTimeRange, setShowTimeRange] = useAtom(showTimeRangeAtom)
  const [startTimeRange, setStartTimeRange] = useAtom(startTimeAtom)
  const [endTimeRange, setEndTimeRange] = useAtom(endTimeAtom)
  const startInputRef = useMask({ mask: '__:__:__', replacement: { _: /\d/ } })
  const endInputRef = useMask({ mask: '__:__:__', replacement: { _: /\d/ } })

  const isStartValid = startTimeRange === '' || TIME_REGEX.test(startTimeRange)
  const isEndValid = endTimeRange === '' || TIME_REGEX.test(endTimeRange)
  const isTimeRangeValid =
    startTimeRange === '' ||
    endTimeRange === '' ||
    (isStartValid && isEndValid && isBefore(startTimeRange, endTimeRange))

  return (
    <div>
      <div className="flex items-center gap-2">
        <Checkbox
          checked={showTimeRange}
          onChange={event => setShowTimeRange(event.target.checked)}
        />
        <p>Show time range</p>
      </div>

      <div
        className={cns(
          'flex items-center gap-3',
          !showTimeRange && 'invisible',
        )}
      >
        <TextField
          name="start"
          inputRef={startInputRef}
          label="Start"
          variant="standard"
          placeholder="00:00:00"
          value={startTimeRange}
          onChange={event => setStartTimeRange(event.target.value)}
          error={!isStartValid || !isTimeRangeValid}
          helperText={match({ isStartValid, isTimeRangeValid })
            .with({ isStartValid: false }, () => 'Must be in format 00:00:00')
            .with({ isTimeRangeValid: false }, () => 'Start must be before end')
            .otherwise(() => null)}
        />

        <TextField
          name="end"
          inputRef={endInputRef}
          label="End"
          variant="standard"
          placeholder="00:00:00"
          value={endTimeRange}
          onChange={event => setEndTimeRange(event.target.value)}
          error={!isEndValid || !isTimeRangeValid}
          helperText={match({ isEndValid, isTimeRangeValid })
            .with({ isEndValid: false }, () => 'Must be in format 00:00:00')
            .with({ isTimeRangeValid: false }, () => 'Start must be before end')
            .otherwise(() => null)}
        />
      </div>
    </div>
  )
}
