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
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, auto)',
        columnGap: 3,
        ml: { md: 'auto' },
        textAlign: { md: 'right' },
        justifyContent: { xs: 'space-between', md: 'end' },
      }}
    >
      {stats.map(([label, value]) => (
        <Box key={label} sx={{ minWidth: 0 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block', whiteSpace: 'nowrap' }}
          >
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
    </Box>
  )
}

const fmtInt = (n: number | null) => (n ?? 0).toLocaleString('en-US')
const fmtCost = (c: LlmCallRow) =>
  c.costUsd === null ? '—' : usd(Number(c.costUsd))
const fmtDuration = (c: LlmCallRow) =>
  c.durationMs === null ? '—' : `${(c.durationMs / 1000).toFixed(2)}s`

function CallCard({ call }: { call: LlmCallRow }) {
  const metrics: [string, string][] = [
    ['In', fmtInt(call.inputTokens)],
    ['Out', fmtInt(call.outputTokens)],
    ['Cached', fmtInt(call.cachedTokens)],
    ['Cost', fmtCost(call)],
    ['Time', fmtDuration(call)],
    ['Finish', call.finishReason ?? call.status],
  ]
  const retries = call.retries ?? 0

  return (
    <Box sx={{ px: 1.5, py: 1, borderTop: 1, borderColor: 'divider' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 1,
          mb: 0.75,
          minWidth: 0,
        }}
      >
        <Typography fontSize={12} fontWeight={600} noWrap>
          {call.operation}
        </Typography>
        <Typography
          fontSize={11}
          fontFamily="monospace"
          color="text.secondary"
          noWrap
          sx={{ minWidth: 0 }}
        >
          {call.model}
        </Typography>
        {retries > 0 && (
          <Typography
            fontSize={11}
            color="warning.main"
            sx={{ ml: 'auto', flexShrink: 0 }}
          >
            {retries} retr{retries === 1 ? 'y' : 'ies'}
          </Typography>
        )}
      </Box>
      <Box
        component="dl"
        sx={{
          m: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          rowGap: 0.75,
          columnGap: 1.5,
        }}
      >
        {metrics.map(([label, value]) => (
          <Box key={label} sx={{ minWidth: 0 }}>
            <Box
              component="dt"
              sx={{ fontSize: 10, color: 'text.secondary', lineHeight: 1.4 }}
            >
              {label}
            </Box>
            <Box
              component="dd"
              sx={{
                m: 0,
                fontFamily: 'monospace',
                fontSize: 12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {value}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
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
        minWidth: 0,
      }}
    >
      <Box
        component="summary"
        sx={{ cursor: 'pointer', px: 1.5, py: 0.75, color: 'text.secondary' }}
      >
        {calls.length} LLM call{calls.length === 1 ? '' : 's'} · {usd(cost)}
      </Box>
      <Box sx={{ display: { xs: 'block', md: 'none' } }}>
        {calls.map(c => (
          <CallCard key={c.id} call={c} />
        ))}
      </Box>
      <Box sx={{ display: { xs: 'none', md: 'block' }, overflowX: 'auto' }}>
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
                  fmtInt(c.inputTokens),
                  fmtInt(c.outputTokens),
                  fmtInt(c.cachedTokens),
                  fmtCost(c),
                  fmtDuration(c),
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
          ml: { xs: 2, md: 5 },
          minWidth: 0,
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
          maxWidth: isHuman
            ? { xs: '88%', md: '75%' }
            : { xs: '100%', md: '80%' },
          flex: isHuman ? undefined : 1,
          minWidth: 0,
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
          <Typography
            variant="body2"
            sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
          >
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

  const dateField = (
    label: string,
    value: string,
    onChange: (v: string) => void,
  ) => (
    <TextField
      label={label}
      type="date"
      size="small"
      value={value}
      onChange={e => onChange(e.target.value)}
      slotProps={{ inputLabel: { shrink: true } }}
      sx={{ minWidth: 0, '& input': { minWidth: 0 } }}
    />
  )

  const channelList = channels.isLoading ? (
    [0, 1, 2, 3].map(i => (
      <Box key={i} sx={{ px: 2, py: 1.5, flexShrink: 0 }}>
        <Skeleton width={96} />
        <Skeleton width={128} />
      </Box>
    ))
  ) : channels.error ? (
    <Alert severity="error">{channels.error.message}</Alert>
  ) : null

  return (
    <Box
      sx={{
        border: { md: 1 },
        borderColor: { md: 'divider' },
        borderRadius: { md: 3 },
        m: { xs: 0, md: 3 },
        overflow: 'hidden',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: { xs: 'stretch', md: 'center' },
          gap: 2,
          px: 2,
          py: 1.5,
          bgcolor: 'background.paper',
          borderBottom: 1,
          borderColor: 'divider',
        }}
      >
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: {
              xs: 'repeat(2, minmax(0, 1fr))',
              md: 'repeat(2, 11rem)',
            },
            gap: 1.5,
          }}
        >
          {dateField('From', from, setFrom)}
          {dateField('To', to, setTo)}
        </Box>
        <TotalsBar
          totals={transcript.data?.totals}
          loading={channels.isLoading || transcript.isLoading}
        />
      </Box>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: 'minmax(0, 1fr)',
            md: '15rem minmax(0, 1fr)',
          },
          minHeight: { md: '34rem' },
        }}
      >
        <Box
          component="nav"
          aria-label="Channels"
          sx={{
            display: { xs: 'flex', md: 'none' },
            gap: 1,
            px: 2,
            py: 1.25,
            overflowX: 'auto',
            borderBottom: 1,
            borderColor: 'divider',
            scrollbarWidth: 'none',
          }}
        >
          {channelList ??
            channels.data?.map(ch => {
              const active = ch.channelId === channelId
              return (
                <Box
                  component="button"
                  type="button"
                  key={ch.channelId}
                  aria-pressed={active}
                  onClick={() => setSelected(ch.channelId)}
                  sx={{
                    flexShrink: 0,
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 0.75,
                    px: 1.5,
                    py: 0.75,
                    border: 1,
                    borderRadius: 999,
                    borderColor: active ? 'primary.main' : 'divider',
                    bgcolor: active ? 'action.selected' : 'transparent',
                    color: 'text.primary',
                    font: 'inherit',
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: 'pointer',
                    '&:focus-visible': {
                      outline: 2,
                      outlineColor: 'primary.light',
                      outlineOffset: 2,
                    },
                  }}
                >
                  # {ch.name}
                  <Box
                    component="span"
                    sx={{ fontSize: 11, color: 'text.secondary' }}
                  >
                    {ch.calls.toLocaleString('en-US')}
                  </Box>
                </Box>
              )
            })}
        </Box>

        <Box
          component="aside"
          sx={{
            display: { xs: 'none', md: 'block' },
            borderRight: 1,
            borderColor: 'divider',
          }}
        >
          {channelList ?? (
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

        <Box
          component="section"
          sx={{
            p: { xs: 2, md: 2.5 },
            minWidth: 0,
            minHeight: { xs: '24rem', md: 0 },
          }}
        >
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
