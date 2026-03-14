'use client'

import { cns } from '@lilnas/utils/cns'
import DeleteIcon from '@mui/icons-material/Delete'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'
import Card from '@mui/material/Card'
import IconButton from '@mui/material/IconButton'
import Tooltip from '@mui/material/Tooltip'
import { useMemo } from 'react'

import { formatBytes, type MovieDetail, parseReleaseName } from 'src/media'

import { AttributePills, getQualityTier, QualityBadge } from './release-pills'

type MovieFileInfo = MovieDetail['files'][number]

interface FileRowProps {
  file: MovieFileInfo
  index: number
  isPending: boolean
  onDelete: (fileId: number, fileName: string | null) => void
}

function FileRow({ file, index, isPending, onDelete }: FileRowProps) {
  const parsed = useMemo(
    () => parseReleaseName(file.relativePath),
    [file.relativePath],
  )

  const tier = getQualityTier(file.quality)

  const metaParts: string[] = []
  metaParts.push(formatBytes(file.size))
  if (parsed.group) metaParts.push(parsed.group)
  if (file.dateAdded) {
    const date = new Date(file.dateAdded)
    metaParts.push(
      date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      }),
    )
  }

  const hasAttributes =
    parsed.hdr.length > 0 ||
    parsed.audio.length > 0 ||
    parsed.codec !== null ||
    parsed.source.length > 0

  return (
    <div
      className={cns(
        'group flex items-center gap-3 px-4 py-3 transition-colors',
        'hover:bg-carbon-700/50',
        'animate-fade-in',
      )}
      style={{ animationDelay: `${Math.min(index, 9) * 30}ms` }}
    >
      {/* File icon */}
      <InsertDriveFileOutlinedIcon
        className="shrink-0 text-carbon-500 transition-colors group-hover:text-carbon-400"
        sx={{ fontSize: 16 }}
      />

      {/* Main content */}
      <div className="min-w-0 flex-1 space-y-1.5">
        {/* Filename */}
        <p className="min-w-0 break-all font-mono text-sm leading-snug text-carbon-200">
          {file.relativePath ?? 'Unknown file'}
        </p>

        {/* Quality badge + attribute pills row */}
        <div className="flex flex-wrap items-center gap-1.5">
          {file.quality && <QualityBadge quality={file.quality} tier={tier} />}
          {hasAttributes && <AttributePills parsed={parsed} />}
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {metaParts.map((part, i) => (
            <span key={part} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-carbon-600">·</span>}
              <span
                className={cns(
                  'font-mono text-xs tabular-nums',
                  i === 0 ? 'font-medium text-carbon-200' : 'text-carbon-500',
                )}
              >
                {part}
              </span>
            </span>
          ))}
        </div>
      </div>

      {/* Delete button */}
      <div className="shrink-0 self-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100">
        <Tooltip title="Delete file" placement="left" arrow>
          <span>
            <IconButton
              size="small"
              disabled={isPending}
              onClick={() => onDelete(file.id, file.relativePath)}
              sx={{
                color: 'var(--color-carbon-500)',
                '&:hover': {
                  color: 'var(--color-error)',
                  bgcolor: 'rgba(239, 68, 68, 0.08)',
                },
                '&.Mui-disabled': { opacity: 0.25 },
              }}
            >
              <DeleteIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
      </div>
    </div>
  )
}

interface FileListProps {
  files: MovieFileInfo[]
  isPending: boolean
  onDelete: (fileId: number, fileName: string | null) => void
}

export function FileList({ files, isPending, onDelete }: FileListProps) {
  if (files.length === 0) return null

  return (
    <div className="space-y-3">
      <h2 className="font-mono text-lg text-carbon-100">Files</h2>
      <Card sx={{ overflow: 'hidden' }}>
        <div className="divide-y divide-carbon-600/40">
          {files.map((file, index) => (
            <FileRow
              key={file.id}
              file={file}
              index={index}
              isPending={isPending}
              onDelete={onDelete}
            />
          ))}
        </div>
      </Card>
    </div>
  )
}
