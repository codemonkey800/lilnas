'use client'

import { isBefore } from '@lilnas/utils/download/utils'
import { isValidURL } from '@lilnas/utils/url'
import { Download } from '@mui/icons-material'
import { CircularProgress, IconButton, TextField } from '@mui/material'
import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { useFormStatus } from 'react-dom'

import { endTimeAtom, showTimeRangeAtom, startTimeAtom } from 'src/store/form'

import { TimeRangeInput } from './TimeRangeInput'

export function DownloadForm() {
  const startTime = useAtomValue(startTimeAtom)
  const endTime = useAtomValue(endTimeAtom)
  const showTimeRange = useAtomValue(showTimeRangeAtom)
  const [url, setUrl] = useState('')

  const isValid =
    isValidURL(url) &&
    (!showTimeRange ||
      (startTime === '' && endTime === '') ||
      isBefore(startTime, endTime))

  const { pending } = useFormStatus()

  if (pending) {
    return <CircularProgress variant="indeterminate" />
  }

  return (
    <>
      <p className="font-bold text-3xl md:text-6xl w-full md:text-center">
        Download
      </p>

      <div className="flex items-center gap-3">
        <TextField
          name="url"
          value={url}
          onChange={event => setUrl(event.target.value)}
          slotProps={{
            input: {
              className: 'md:!text-3xl min-w-[90vw] md:min-w-[50vw]',
              endAdornment: (
                <IconButton
                  className="!text-xl max-md:!hidden !mb-2"
                  disabled={!isValid}
                  type="submit"
                >
                  <Download fontSize="large" />
                </IconButton>
              ),
            },
          }}
          variant="standard"
          error={url !== '' && !isValidURL(url)}
          helperText={
            url !== '' && !isValidURL(url) ? 'Invalid URL' : undefined
          }
        />
      </div>

      <TimeRangeInput />
    </>
  )
}
