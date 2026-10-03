'use client'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import List from '@mui/material/List'
import ListItemButton from '@mui/material/ListItemButton'
import ListItemText from '@mui/material/ListItemText'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'

import type { TranscriptTotals } from 'src/api/api.types'
import type { LlmCallRow } from 'src/db/schema'
import { useTranscript, useTranscriptChannels } from 'src/queries/useTranscript'

import { buildTranscriptItems, TranscriptItem } from './group-turns'

const DAY_MS = 24 * 60 * 60 * 1000

const isoDay = (date: Date) => date.toISOString().slice(0, 10)

const compact = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
})

const usd = (n: number, digits = 5) => `$${n.toFixed(digits)}`

const formatTime = (iso: string | Date | null) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

function TotalsBar({
  totals,
  loading,
}: {
  totals?: TranscriptTotals
  loading: boolean
}) {
  const stats: [string, string | undefined][] = [
    ['Total cost', totals && usd(totals.costUsd, 4)],
    ['Input tokens', totals && compact.format(totals.inputTokens)],
    ['Output tokens', totals && compact.format(totals.outputTokens)],
  ]

  return (
    <Stack direction="row" spacing={3} sx={{ ml: 'auto', textAlign: 'right' }}>
      {stats.map(([label, value]) => (
        <Box key={label}>
          <Typography variant="caption" color="text.secondary">
            {label}
          </Typography>
          {loading || value === undefined ? (
            <Skeleton width={56} />
          ) : (
            <Typography fontFamily="monospace" fontWeight={600} fontSize={14}>
              {value}
            </Typography>
          )}
        </Box>
      ))}
    </Stack>
  )
}

function CallsTable({ calls }: { calls: LlmCallRow[] }) {
  const cost = calls.reduce((sum, c) => sum + Number(c.costUsd ?? 0), 0)
  const headers = [
    'Operation',
    'Model',
    'In',
    'Out',
    'Cached',
    'Cost (USD)',
    'Duration',
    'Retries',
    'Finish',
  ]

  return (
    <Box
      component="details"
      sx={{
        mt: 1,
        border: 1,
        borderColor: 'divider',
        borderRadius: 2,
        fontSize: 12,
      }}
    >
      <Box
        component="summary"
        sx={{ cursor: 'pointer', px: 1.5, py: 0.75, color: 'text.secondary' }}
      >
        {calls.length} LLM call{calls.length === 1 ? '' : 's'} · {usd(cost)}
      </Box>
      <Box sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ width: '100%', textAlign: 'left' }}>
          <thead>
            <tr>
              {headers.map(h => (
                <Box component="th" key={h} sx={{ px: 1.5, py: 0.75 }}>
                  {h}
                </Box>
              ))}
            </tr>
          </thead>
          <Box component="tbody" sx={{ fontFamily: 'monospace' }}>
            {calls.map(c => (
              <Box
                component="tr"
                key={c.id}
                sx={{ borderTop: 1, borderColor: 'divider' }}
              >
                {[
                  c.operation,
                  c.model,
                  (c.inputTokens ?? 0).toLocaleString('en-US'),
                  (c.outputTokens ?? 0).toLocaleString('en-US'),
                  (c.cachedTokens ?? 0).toLocaleString('en-US'),
                  c.costUsd === null ? '—' : usd(Number(c.costUsd)),
                  c.durationMs === null
                    ? '—'
                    : `${(c.durationMs / 1000).toFixed(2)}s`,
                  String(c.retries ?? 0),
                  c.finishReason ?? c.status,
                ].map((value, i) => (
                  <Box
                    component="td"
                    key={headers[i]}
                    sx={{
                      px: 1.5,
                      py: 0.75,
                      color:
                        i === 7 && Number(value) > 0
                          ? 'warning.main'
                          : undefined,
                    }}
                  >
                    {value}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

function Item({ item }: { item: TranscriptItem }) {
  if (item.kind === 'tool') {
    return (
      <Box
        component="details"
        sx={{
          ml: 5,
          border: 1,
          borderStyle: 'dashed',
          borderColor: 'divider',
          borderRadius: 2,
          fontSize: 12,
          color: 'text.secondary',
        }}
      >
        <Box
          component="summary"
          sx={{ cursor: 'pointer', px: 1.5, py: 0.5, fontFamily: 'monospace' }}
        >
          {item.name}
        </Box>
        <Box
          component="pre"
          sx={{ m: 0, px: 1.5, pb: 1, overflowX: 'auto', fontSize: 12 }}
        >
          {item.detail}
        </Box>
      </Box>
    )
  }

  const isHuman = item.kind === 'human'
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: isHuman ? 'flex-end' : 'flex-start',
      }}
    >
      <Box
        sx={{
          maxWidth: isHuman ? '75%' : '80%',
          flex: isHuman ? undefined : 1,
        }}
      >
        <Box
          sx={{
            px: 2,
            py: 1.25,
            borderRadius: 4,
            ...(isHuman
              ? { bgcolor: 'primary.dark', borderBottomRightRadius: 4 }
              : { bgcolor: 'background.paper', borderBottomLeftRadius: 4 }),
          }}
        >
          <Typography
            variant="caption"
            color={isHuman ? 'primary.light' : 'text.secondary'}
            fontWeight={500}
          >
            {isHuman ? (item.message.name ?? 'user') : 'tdr-bot'}
          </Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
            {item.message.content}
          </Typography>
        </Box>
        {item.kind === 'assistant' && item.calls.length > 0 && (
          <CallsTable calls={item.calls} />
        )}
      </Box>
    </Box>
  )
}

function TranscriptBody({
  items,
  loading,
  error,
}: {
  items: TranscriptItem[]
  loading: boolean
  error: Error | null
}) {
  if (error) {
    return <Alert severity="error">{error.message}</Alert>
  }

  if (loading) {
    return (
      <Stack spacing={2} data-testid="transcript-loading">
        {[0.5, 0.66, 0.4, 0.6].map((w, i) => (
          <Box
            key={w}
            sx={{
              display: 'flex',
              justifyContent: i % 2 === 0 ? 'flex-end' : 'flex-start',
            }}
          >
            <Skeleton variant="rounded" height={64} width={`${w * 100}%`} />
          </Box>
        ))}
      </Stack>
    )
  }

  if (items.length === 0) {
    return (
      <Box
        sx={{
          display: 'grid',
          placeItems: 'center',
          height: '100%',
          textAlign: 'center',
        }}
      >
        <Box>
          <Typography fontSize={32}>💬</Typography>
          <Typography fontWeight={500}>No messages in this range</Typography>
          <Typography variant="caption" color="text.secondary">
            Widen the date filter or pick another channel.
          </Typography>
        </Box>
      </Box>
    )
  }

  return (
    <Stack spacing={1.5}>
      {items.map((item, i) => (
        <Item key={i} item={item} />
      ))}
    </Stack>
  )
}

export default function TranscriptPage() {
  const [from, setFrom] = useState(() =>
    isoDay(new Date(Date.now() - 6 * DAY_MS)),
  )
  const [to, setTo] = useState(() => isoDay(new Date()))
  const [selected, setSelected] = useState<string>()

  const channels = useTranscriptChannels()
  const channelId = selected ?? channels.data?.[0]?.channelId
  const transcript = useTranscript(channelId, { from, to })

  const items = useMemo(
    () =>
      transcript.data
        ? buildTranscriptItems(transcript.data.messages, transcript.data.calls)
        : [],
    [transcript.data],
  )

  return (
    <Box
      sx={{
        border: 1,
        borderColor: 'divider',
        borderRadius: 3,
        m: 3,
        overflow: 'hidden',
      }}
    >
      <Stack
        direction="row"
        alignItems="center"
        spacing={2}
        sx={{
          px: 2,
          py: 1.5,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <TextField
          label="From"
          type="date"
          size="small"
          value={from}
          onChange={e => setFrom(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TextField
          label="To"
          type="date"
          size="small"
          value={to}
          onChange={e => setTo(e.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <TotalsBar
          totals={transcript.data?.totals}
          loading={channels.isLoading || transcript.isLoading}
        />
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '15rem 1fr',
          minHeight: '34rem',
        }}
      >
        <Box component="aside" sx={{ borderRight: 1, borderColor: 'divider' }}>
          {channels.isLoading ? (
            [0, 1, 2, 3].map(i => (
              <Box key={i} sx={{ px: 2, py: 1.5 }}>
                <Skeleton width={96} />
                <Skeleton width={128} />
              </Box>
            ))
          ) : channels.error ? (
            <Alert severity="error">{channels.error.message}</Alert>
          ) : (
            <List disablePadding>
              {channels.data?.map(ch => (
                <ListItemButton
                  key={ch.channelId}
                  selected={ch.channelId === channelId}
                  onClick={() => setSelected(ch.channelId)}
                  sx={{ borderBottom: 1, borderColor: 'divider' }}
                >
                  <ListItemText
                    primary={`# ${ch.name}`}
                    secondary={`${formatTime(ch.lastAt)} · ${ch.calls.toLocaleString('en-US')} calls`}
                    slotProps={{
                      primary: { fontSize: 14, fontWeight: 500 },
                      secondary: { fontSize: 11 },
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          )}
        </Box>

        <Box component="section" sx={{ p: 2.5 }}>
          <TranscriptBody
            items={items}
            loading={
              channels.isLoading || (!!channelId && transcript.isLoading)
            }
            error={transcript.error}
          />
        </Box>
      </Box>
    </Box>
  )
}
