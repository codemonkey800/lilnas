'use client'

import { isValidURL } from '@lilnas/utils/url'
import { Button, TextField } from '@mui/material'
import { useAtomValue } from 'jotai'
import { useState } from 'react'

import { endTimeAtom, showTimeRangeAtom, startTimeAtom } from 'src/store/form'

import { TimeRangeInput } from './TimeRangeInput'
import { isBefore } from './utils'

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
              className: '!text-3xl min-w-[50vw]',
            },
          }}
          variant="standard"
          error={url !== '' && !isValidURL(url)}
          helperText={
            url !== '' && !isValidURL(url) ? 'Invalid URL' : undefined
          }
        />

        <Button
          className="!h-13"
          disabled={!isValid}
          type="submit"
          variant="contained"
        >
          Download
        </Button>
      </div>

      <TimeRangeInput />
    </form>
  )
}
