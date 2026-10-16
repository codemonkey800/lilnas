'use client'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import CircularProgress from '@mui/material/CircularProgress'
import Skeleton from '@mui/material/Skeleton'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import ToggleButton from '@mui/material/ToggleButton'
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'

import type { EmojiView } from 'src/api/api.types'
import {
  useEmojis,
  useReconcileEmojis,
  useRedescribeEmoji,
} from 'src/queries/useEmojis'

import { EmojiTable } from './EmojiTable'
import {
  type EmojiFilter,
  filterCounts,
  FILTERS,
  needsRedescribeConfirm,
  reconcileStatusLine,
  redescribeAllScope,
  visibleEmojis,
} from './format'
import { RedescribeAllDialog } from './RedescribeAllDialog'
import { RedescribeDialog } from './RedescribeDialog'

export default function EmojisPage() {
  const [filter, setFilter] = useState<EmojiFilter>('all')
  const [text, setText] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<EmojiView | null>(null)
  const [confirmingAll, setConfirmingAll] = useState(false)
  const [startedAt, setStartedAt] = useState<Date | null>(null)

  const list = useEmojis()
  const reconcile = useReconcileEmojis()
  const redescribe = useRedescribeEmoji()

  const emojis = useMemo(() => list.data?.emojis ?? [], [list.data])
  const counts = useMemo(() => filterCounts(emojis), [emojis])
  const scope = useMemo(() => redescribeAllScope(emojis), [emojis])
  const visible = useMemo(
    () => visibleEmojis(emojis, filter, text),
    [emojis, filter, text],
  )

  // The POST is pending until the refetch it triggers lands, so the buttons
  // stay busy until the poll takes over and reports the run finished.
  const running = reconcile.isPending || !!list.data?.reconcile.running
  const now = new Date()

  const failedName =
    emojis.find(e => e.id === redescribe.variables)?.name ??
    redescribe.variables

  const startReconcile = () => {
    setStartedAt(new Date())
    reconcile.mutate()
  }

  const onRedescribe = (emoji: EmojiView) => {
    if (needsRedescribeConfirm(emoji)) {
      setConfirming(emoji)
      return
    }
    redescribe.mutate(emoji.id)
  }

  const redescribeAllButton = (
    <Button
      variant="outlined"
      disabled={running || scope.total === 0}
      onClick={() => setConfirmingAll(true)}
    >
      Re-describe all
    </Button>
  )

  const reconcileButton = (
    <Button
      variant="contained"
      disabled={running}
      onClick={startReconcile}
      startIcon={
        running ? <CircularProgress size={14} color="inherit" /> : undefined
      }
    >
      {running ? 'Reconciling…' : 'Run reconcile now'}
    </Button>
  )

  return (
    <Box sx={{ maxWidth: 1200, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Typography variant="h4" component="h1" fontWeight={600}>
        Emojis
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: 3, mt: 0.5 }}
      >
        The bot’s custom-emoji dictionary: what each emoji looks like and means.
      </Typography>

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 1.5,
          mb: 2,
        }}
      >
        <ToggleButtonGroup
          exclusive
          size="small"
          value={filter}
          aria-label="Emoji filter"
          onChange={(_, value: EmojiFilter | null) => value && setFilter(value)}
        >
          {FILTERS.map(f => (
            <ToggleButton key={f.value} value={f.value}>
              {f.label}
              <Typography
                component="span"
                variant="caption"
                color="text.secondary"
                sx={{ ml: 0.75 }}
              >
                {counts[f.value]}
              </Typography>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <TextField
          size="small"
          placeholder="Search name or description…"
          value={text}
          onChange={e => setText(e.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Search emojis' } }}
          sx={{ width: 256 }}
        />
        <Box sx={{ ml: 'auto', textAlign: 'right' }}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ justifyContent: 'flex-end' }}
          >
            {redescribeAllButton}
            {reconcileButton}
          </Stack>
          {list.data && (
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 0.75 }}
            >
              {reconcileStatusLine(
                { ...list.data.reconcile, running },
                now,
                startedAt,
              )}
            </Typography>
          )}
        </Box>
      </Box>

      {reconcile.error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={reconcile.reset}>
          Couldn’t start a reconcile: {reconcile.error.message}
        </Alert>
      )}
      {redescribe.error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={redescribe.reset}>
          Couldn’t re-describe :{failedName}: — {redescribe.error.message}
        </Alert>
      )}

      {list.isLoading && (
        <Stack spacing={1} aria-label="Loading emojis">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} variant="rounded" height={40} />
          ))}
        </Stack>
      )}
      {list.error && (
        <Alert severity="error">
          Couldn’t load emojis: {list.error.message}
        </Alert>
      )}
      {list.data && emojis.length === 0 && (
        <Box
          sx={{
            py: 8,
            textAlign: 'center',
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <Typography fontSize={32}>😶</Typography>
          <Typography variant="body2" fontWeight={500} sx={{ mt: 1 }}>
            No emojis synced yet
          </Typography>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ display: 'block' }}
          >
            Run a reconcile to pull the server’s custom emojis.
          </Typography>
          <Box sx={{ mt: 2 }}>{reconcileButton}</Box>
        </Box>
      )}
      {emojis.length > 0 && visible.length === 0 && (
        <Box
          sx={{
            py: 8,
            textAlign: 'center',
            border: 1,
            borderStyle: 'dashed',
            borderColor: 'divider',
            borderRadius: 2,
          }}
        >
          <Typography variant="body2" fontWeight={500}>
            No matching emojis
          </Typography>
        </Box>
      )}
      {visible.length > 0 && (
        <EmojiTable
          emojis={visible}
          editingId={editingId}
          redescribingId={
            redescribe.isPending ? (redescribe.variables ?? null) : null
          }
          reconciling={running}
          onEdit={emoji => setEditingId(emoji.id)}
          onCloseEdit={() => setEditingId(null)}
          onRedescribe={onRedescribe}
        />
      )}

      <RedescribeDialog
        emoji={confirming}
        onClose={() => setConfirming(null)}
      />
      <RedescribeAllDialog
        open={confirmingAll}
        total={scope.total}
        manual={scope.manual}
        onClose={() => setConfirmingAll(false)}
        onStarted={() => setStartedAt(new Date())}
      />
    </Box>
  )
}
