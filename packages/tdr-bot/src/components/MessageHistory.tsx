'use client'

import { cns } from '@lilnas/utils/cns'
import { useState } from 'react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from 'src/components/Card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from 'src/components/Select'
import { useGraphHistoryFiles } from 'src/queries/useGraphHistoryFiles'
import { useGraphHistoryMessages } from 'src/queries/useGraphHistoryMessages'
import { useMessages } from 'src/queries/useMessages'
import { ImageResponse } from 'src/schemas/graph'

export function MessageHistory() {
  const [selectedSource, setSelectedSource] = useState<string>('current')

  // Fetch available history files
  const { data: historyFiles = [] } = useGraphHistoryFiles()

  // Fetch current state messages
  const {
    data: currentMessages = [],
    isLoading: currentLoading,
    error: currentError,
  } = useMessages()

  // Fetch historical messages (only when file selected)
  const {
    data: historyMessages = [],
    isLoading: historyLoading,
    error: historyError,
  } = useGraphHistoryMessages(
    selectedSource !== 'current' ? selectedSource : undefined,
  )

  // Determine which data to display
  const messages =
    selectedSource === 'current' ? currentMessages : historyMessages
  const isLoading =
    selectedSource === 'current' ? currentLoading : historyLoading
  const error = selectedSource === 'current' ? currentError : historyError

  const selectedFile = historyFiles.find(f => f.filename === selectedSource)

  return (
    <Card>
      <CardHeader>
        <div className={cns('flex items-center justify-between', 'gap-4 mb-2')}>
          <CardTitle>Chat History</CardTitle>

          <Select value={selectedSource} onValueChange={setSelectedSource}>
            <SelectTrigger className={cns('w-[200px]')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="current">Current State</SelectItem>
              {historyFiles.map(file => (
                <SelectItem key={file.filename} value={file.filename}>
                  {file.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <CardDescription>
          {selectedSource === 'current'
            ? 'Real-time view of TDR Bot conversation messages'
            : `Viewing ${selectedFile?.label} (${messages.length} messages)`}
        </CardDescription>
      </CardHeader>

      <CardContent>
        {isLoading && (
          <div
            className={cns(
              'flex items-center justify-center py-8',
              'text-neutral-500 dark:text-neutral-400',
            )}
          >
            <div
              className={cns(
                'animate-spin rounded-full h-8 w-8',
                'border-b-2 border-neutral-900 dark:border-neutral-100',
              )}
            />
          </div>
        )}

        {error && (
          <div
            className={cns(
              'flex items-center justify-center py-8',
              'text-red-500 dark:text-red-400',
              'text-sm',
            )}
          >
            Error loading messages: {(error as Error).message}
          </div>
        )}

        {!isLoading && !error && messages && messages.length === 0 && (
          <div
            className={cns(
              'flex items-center justify-center py-8',
              'text-neutral-500 dark:text-neutral-400',
              'text-sm',
            )}
          >
            No messages yet
          </div>
        )}

        {!isLoading && !error && messages && messages.length > 0 && (
          <div
            className={cns(
              'space-y-3',
              'max-h-[600px] overflow-y-auto',
              'pr-2',
            )}
          >
            {messages.map((message, index) => (
              <MessageItem
                key={`${selectedSource}-${message.id || `message-${index}`}`}
                message={message}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MessageTypeBadge({ type }: { type: string }) {
  const colors = {
    human: cns(
      'bg-blue-100 text-blue-800',
      'dark:bg-blue-950 dark:text-blue-300',
    ),
    ai: cns(
      'bg-purple-100 text-purple-800',
      'dark:bg-purple-950 dark:text-purple-300',
    ),
    system: cns(
      'bg-neutral-100 text-neutral-800',
      'dark:bg-neutral-800 dark:text-neutral-300',
    ),
    function: cns(
      'bg-green-100 text-green-800',
      'dark:bg-green-950 dark:text-green-300',
    ),
  }

  const color = colors[type as keyof typeof colors] || colors.system

  return (
    <span
      className={cns(
        'inline-flex items-center rounded-full px-2.5 py-0.5',
        'text-xs font-medium',
        color,
      )}
    >
      {type.toUpperCase()}
    </span>
  )
}

function MessageItem({
  message,
}: {
  message: {
    id?: string
    content: string
    type: string
    kwargs: Record<string, unknown>
    images?: unknown[]
  }
}) {
  const hasKwargs = Object.keys(message.kwargs).length > 0
  const hasImages = message.images && message.images.length > 0

  return (
    <div
      className={cns(
        'border rounded-lg p-4',
        'border-neutral-200 dark:border-neutral-800',
        'bg-neutral-50 dark:bg-neutral-900',
      )}
    >
      <div className="flex items-center gap-2 mb-2">
        <MessageTypeBadge type={message.type} />
        {message.id && (
          <span
            className={cns(
              'text-xs text-neutral-500 dark:text-neutral-400',
              'truncate',
            )}
          >
            {message.id}
          </span>
        )}
      </div>

      <div
        className={cns(
          'text-sm mb-3',
          'text-neutral-900 dark:text-neutral-100',
          'break-words whitespace-pre-wrap',
        )}
      >
        {message.content}
      </div>

      {hasKwargs && (
        <div className="mt-3">
          <div
            className={cns(
              'text-xs font-medium mb-1',
              'text-neutral-700 dark:text-neutral-300',
            )}
          >
            Additional Data:
          </div>
          <pre
            className={cns(
              'text-xs p-2 rounded',
              'bg-neutral-100 dark:bg-neutral-800',
              'text-neutral-800 dark:text-neutral-200',
              'overflow-x-auto',
            )}
          >
            {JSON.stringify(message.kwargs, null, 2)}
          </pre>
        </div>
      )}

      {hasImages && message.images && (
        <div className="mt-3">
          <div
            className={cns(
              'text-xs font-medium mb-2',
              'text-neutral-700 dark:text-neutral-300',
            )}
          >
            Images: {message.images.length}
          </div>
          <div
            className={cns(
              'grid gap-3',
              message.images.length === 1 ? 'grid-cols-1' : 'grid-cols-2',
            )}
          >
            {(message.images as ImageResponse[]).map((image, idx) => (
              <div
                key={`${message.id}-img-${idx}`}
                className={cns(
                  'rounded-lg overflow-hidden',
                  'border border-neutral-200 dark:border-neutral-700',
                  'bg-neutral-100 dark:bg-neutral-800',
                )}
              >
                <img
                  src={image.url}
                  alt={image.title}
                  className={cns('w-full h-auto object-cover', 'max-h-64')}
                  loading="lazy"
                  onError={e => {
                    const target = e.target as HTMLImageElement
                    target.src =
                      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300"%3E%3Crect fill="%23ddd" width="400" height="300"/%3E%3Ctext fill="%23999" x="50%25" y="50%25" text-anchor="middle" dominant-baseline="middle"%3EImage unavailable%3C/text%3E%3C/svg%3E'
                  }}
                />
                {image.title && (
                  <div
                    className={cns(
                      'px-3 py-2',
                      'text-xs text-neutral-700 dark:text-neutral-300',
                      'bg-neutral-50 dark:bg-neutral-900',
                    )}
                  >
                    {image.title}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
