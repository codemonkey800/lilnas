'use client'

import Accordion from '@mui/material/Accordion'
import AccordionDetails from '@mui/material/AccordionDetails'
import AccordionSummary from '@mui/material/AccordionSummary'
import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import Link from '@mui/material/Link'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useRef, useState } from 'react'

import type { SettingsResponse } from 'src/api/api.types'
import { DiscordContent } from 'src/components/DiscordContent'
import { ModelSelect } from 'src/components/ModelSelect'
import { type EmojiLookup, useEmojiLookup } from 'src/queries/useEmojiLookup'
import { usePlaygroundChat } from 'src/queries/usePlayground'
import { useSettings } from 'src/queries/useSettings'

import {
  draftOverride,
  formatMeta,
  scoreChips,
  threadReducer,
  TONE_COLOR,
  toRequestMessages,
  type Turn,
} from './conversation'
import { EvalPanel } from './EvalPanel'

const PROMPT_MAX = 20_000
/** The author the server stamps on user turns (DEFAULT_PLAYGROUND_AUTHOR). */
const AUTHOR = 'paulbeenis420'

const newId = () => crypto.randomUUID()

const bubbleSx = (isHuman: boolean) => ({
  px: 2,
  py: 1.25,
  borderRadius: 4,
  ...(isHuman
    ? { bgcolor: 'primary.dark', borderBottomRightRadius: 4 }
    : { bgcolor: 'background.paper', borderBottomLeftRadius: 4 }),
})

function BubbleRow({
  isHuman,
  children,
}: {
  isHuman: boolean
  children: React.ReactNode
}) {
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
          minWidth: 0,
        }}
      >
        {children}
      </Box>
    </Box>
  )
}

function UserBubble({ turn, lookup }: { turn: Turn; lookup: EmojiLookup }) {
  if (turn.role !== 'user') return null
  return (
    <BubbleRow isHuman>
      <Box sx={bubbleSx(true)}>
        <Typography variant="caption" color="primary.light" fontWeight={500}>
          {AUTHOR}
        </Typography>
        <DiscordContent text={turn.content} lookup={lookup} />
      </Box>
    </BubbleRow>
  )
}

function AssistantBubble({
  turn,
  lookup,
}: {
  turn: Turn
  lookup: EmojiLookup
}) {
  if (turn.role !== 'assistant') return null
  return (
    <BubbleRow isHuman={false}>
      <Box sx={bubbleSx(false)}>
        <Typography variant="caption" color="text.secondary" fontWeight={500}>
          tdr-bot
        </Typography>
        <DiscordContent text={turn.content} lookup={lookup} />
      </Box>
      <Typography
        variant="caption"
        fontFamily="monospace"
        color="text.secondary"
        sx={{ display: 'block', mt: 0.5, px: 0.5 }}
      >
        {formatMeta(turn.meta)}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, px: 0.5 }}>
        {scoreChips(turn.meta.emojis).map(chip => (
          <Chip
            key={chip.label}
            size="small"
            variant="outlined"
            color={TONE_COLOR[chip.tone]}
            label={chip.label}
            title={chip.title}
          />
        ))}
      </Box>
    </BubbleRow>
  )
}

function ErrorBubble({
  turn,
  disabled,
  onRetry,
}: {
  turn: Turn
  disabled: boolean
  onRetry: () => void
}) {
  if (turn.role !== 'error') return null
  return (
    <BubbleRow isHuman={false}>
      <Box
        sx={{
          ...bubbleSx(false),
          bgcolor: 'rgba(211, 47, 47, 0.1)',
          border: 1,
          borderColor: 'error.dark',
        }}
      >
        <Typography variant="caption" color="error" fontWeight={500}>
          tdr-bot · failed
        </Typography>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 1.5,
          }}
        >
          <Typography variant="body2">{turn.message}</Typography>
          <Button
            size="small"
            color="inherit"
            disabled={disabled}
            onClick={onRetry}
          >
            Retry
          </Button>
        </Box>
      </Box>
    </BubbleRow>
  )
}

function PendingBubble() {
  return (
    <BubbleRow isHuman={false}>
      <Box sx={bubbleSx(false)}>
        <Typography variant="caption" color="text.secondary" fontWeight={500}>
          tdr-bot
        </Typography>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            color: 'text.secondary',
          }}
        >
          <CircularProgress size={14} color="inherit" />
          <Typography variant="body2">Thinking…</Typography>
        </Box>
      </Box>
    </BubbleRow>
  )
}

function EmptyThread() {
  return (
    <Box
      sx={{
        display: 'grid',
        placeItems: 'center',
        py: 8,
        textAlign: 'center',
        border: 1,
        borderStyle: 'dashed',
        borderColor: 'divider',
        borderRadius: 3,
      }}
    >
      <Box>
        <Typography fontSize={32}>💬</Typography>
        <Typography fontWeight={500}>
          Pick a model and say something.
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Replies use the real system prompt and emoji dictionary.
        </Typography>
      </Box>
    </Box>
  )
}

function Playground({ settings }: { settings: SettingsResponse }) {
  const chat = usePlaygroundChat()
  const lookup = useEmojiLookup()

  const [model, setModel] = useState(settings.models.chat)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [draft, setDraft] = useState(settings.systemPrompt)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [evalRunning, setEvalRunning] = useState(false)
  // Bumped on every send and on reset so a late reply can't land in a thread
  // it doesn't belong to.
  const requestSeq = useRef(0)

  const pending = chat.isPending
  const modified = draft !== settings.systemPrompt
  const canSend = !pending && !evalRunning && input.trim().length > 0

  const submit = (next: Turn[], userId: string, content: string) => {
    const seq = ++requestSeq.current
    setTurns(next)
    chat.mutate(
      {
        model,
        messages: toRequestMessages(next),
        systemPromptDraft: draftOverride(draft, settings.systemPrompt),
      },
      {
        onSuccess: reply => {
          if (seq !== requestSeq.current) return
          setTurns(t =>
            threadReducer(t, {
              type: 'assistant',
              id: newId(),
              content: reply.reply,
              raw: reply.raw,
              meta: {
                model: reply.model,
                costUsd: reply.usage.costUsd,
                durationMs: reply.durationMs,
                emojis: reply.emojis,
              },
            }),
          )
        },
        onError: err => {
          if (seq !== requestSeq.current) return
          setTurns(t =>
            threadReducer(t, {
              type: 'error',
              id: newId(),
              message: err.message,
              retryOf: userId,
            }),
          )
          setInput(current => current || content)
        },
      },
    )
  }

  const send = () => {
    if (!canSend) return
    const content = input.trim()
    const id = newId()
    setInput('')
    submit(threadReducer(turns, { type: 'user', id, content }), id, content)
  }

  const retry = (turn: Extract<Turn, { role: 'error' }>) => {
    const next = threadReducer(turns, { type: 'retry', id: turn.id })
    const failed = next.find(t => t.id === turn.retryOf)
    submit(next, turn.retryOf, failed?.role === 'user' ? failed.content : '')
  }

  const reset = () => {
    requestSeq.current++
    chat.reset()
    setTurns(threadReducer(turns, { type: 'reset' }))
    setConfirmOpen(false)
  }

  return (
    <Stack spacing={2}>
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-start',
          gap: 1.5,
        }}
      >
        <ModelSelect
          role="chat"
          label="Model"
          size="small"
          value={model}
          disabled={pending}
          sx={{ flex: 1, minWidth: 260, maxWidth: { sm: 440 } }}
          onChange={setModel}
        />
        <Button
          color="inherit"
          disabled={pending || turns.length === 0}
          onClick={() => setConfirmOpen(true)}
          sx={{ alignSelf: 'center' }}
        >
          Reset conversation
        </Button>
      </Box>

      <Accordion variant="outlined" disableGutters>
        <AccordionSummary>
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              columnGap: 1,
              rowGap: 0.5,
              width: '100%',
            }}
          >
            <Typography variant="body2" fontWeight={500}>
              System prompt draft
            </Typography>
            {modified && (
              <Chip
                size="small"
                color="warning"
                variant="outlined"
                label="modified"
              />
            )}
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ ml: { sm: 'auto' }, width: { xs: '100%', sm: 'auto' } }}
            >
              Overrides the saved prompt for this conversation only
            </Typography>
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          <TextField
            multiline
            fullWidth
            minRows={5}
            value={draft}
            disabled={pending}
            helperText={`${draft.length} / ${PROMPT_MAX}`}
            onChange={e => setDraft(e.target.value)}
            slotProps={{
              input: { sx: { fontFamily: 'monospace', fontSize: 13 } },
              htmlInput: { 'aria-label': 'System prompt draft' },
            }}
          />
          <Box
            sx={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 1,
              mt: 0.5,
            }}
          >
            <Typography variant="caption" color="text.secondary">
              The draft is never saved. The intro, input format and emoji
              dictionary are always appended, same as in production.
            </Typography>
            <Link
              component="button"
              type="button"
              variant="caption"
              disabled={!modified || pending}
              onClick={() => setDraft(settings.systemPrompt)}
            >
              Reset to saved
            </Link>
          </Box>
        </AccordionDetails>
      </Accordion>

      {turns.length === 0 && !pending ? (
        <EmptyThread />
      ) : (
        <Stack spacing={1.5}>
          {turns.map(turn =>
            turn.role === 'user' ? (
              <UserBubble key={turn.id} turn={turn} lookup={lookup} />
            ) : turn.role === 'assistant' ? (
              <AssistantBubble key={turn.id} turn={turn} lookup={lookup} />
            ) : (
              <ErrorBubble
                key={turn.id}
                turn={turn}
                disabled={pending}
                onRetry={() => retry(turn)}
              />
            ),
          )}
          {pending && <PendingBubble />}
        </Stack>
      )}

      <EvalPanel
        savedModel={settings.models.chat}
        systemPromptDraft={draftOverride(draft, settings.systemPrompt)}
        lookup={lookup}
        disabled={pending}
        onRunningChange={setEvalRunning}
      />

      <Box
        sx={{
          p: 1.5,
          border: 1,
          borderColor: 'divider',
          borderRadius: 3,
          bgcolor: 'background.paper',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'flex-end', gap: 1.5 }}>
          <TextField
            multiline
            fullWidth
            size="small"
            minRows={2}
            maxRows={8}
            placeholder="Message tdr-bot…"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
            slotProps={{ htmlInput: { 'aria-label': 'Message' } }}
          />
          <Button variant="contained" disabled={!canSend} onClick={send}>
            Send
          </Button>
        </Box>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 0.75 }}
        >
          Enter to send · Shift+Enter for a newline
        </Typography>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Reset conversation?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This clears every turn. The model and prompt draft stay as they are.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button color="error" onClick={reset}>
            Reset
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export default function PlaygroundPage() {
  const { data, isLoading, error } = useSettings()

  return (
    <Box sx={{ maxWidth: 880, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Typography variant="h4" component="h1" fontWeight={600}>
        Playground
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: 3, mt: 0.5 }}
      >
        Chat with the bot’s chat model outside Discord to check it uses the
        custom-emoji dictionary. The model writes :shortcodes:, which are
        resolved to real emojis before display, same as in Discord. Repaired and
        hallucinated ones are counted against the raw output.
      </Typography>

      {isLoading && <CircularProgress aria-label="Loading playground" />}
      {error && <Alert severity="error">Couldn’t load settings.</Alert>}
      {data && <Playground settings={data} />}
    </Box>
  )
}
