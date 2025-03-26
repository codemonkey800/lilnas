'use client'

import { isBefore } from '@lilnas/utils/download/utils'
import { isValidURL } from '@lilnas/utils/url'
import { Download } from '@mui/icons-material'
import { IconButton, TextField } from '@mui/material'
import { useAtomValue } from 'jotai'
import { useState } from 'react'

import { endTimeAtom, showTimeRangeAtom, startTimeAtom } from 'src/store/form'

import { TimeRangeInput } from './TimeRangeInput'

export function DownloadForm({
  createDownload,
}: {
  createDownload(data: FormData): Promise<void>
}) {
  const startTime = useAtomValue(startTimeAtom)
  const endTime = useAtomValue(endTimeAtom)
  const showTimeRange = useAtomValue(showTimeRangeAtom)
  const [url, setUrl] = useState('')

  const isValid =
    isValidURL(url) &&
    (!showTimeRange ||
      (startTime === '' && endTime === '') ||
      isBefore(startTime, endTime))

  return (
    <form action={createDownload} className="flex flex-col gap-3">
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
    </form>
  )
}
