'use client'

import {
  Badge,
  Button,
  ConfirmDialog,
  EmptyState,
  Icon,
  Kbd,
  Note,
  Skeleton,
  Textarea,
} from '@lilnas/ui'
import { useRef, useState } from 'react'

import type { SettingsResponse } from 'src/api/api.types'
import { ModelSelect } from 'src/components/ModelSelect'
import { useEmojiLookup } from 'src/queries/useEmojiLookup'
import { usePlaygroundChat } from 'src/queries/usePlayground'
import { useSettings } from 'src/queries/useSettings'

import {
  AssistantBubble,
  ErrorBubble,
  PendingBubble,
  UserBubble,
} from './bubbles'
import {
  draftOverride,
  threadReducer,
  toRequestMessages,
  type Turn,
} from './conversation'
import { EvalPanel } from './EvalPanel'

const PROMPT_MAX = 20_000

const newId = () => crypto.randomUUID()

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
  const busy = pending || evalRunning
  const canSend = !busy && input.trim().length > 0

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
    if (busy) return
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
    <>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-end">
          <ModelSelect
            className="w-full md:max-w-md"
            disabled={pending}
            label="Model"
            role="chat"
            value={model}
            onChange={setModel}
          />
          <Button
            className="md:ml-auto"
            disabled={pending || turns.length === 0}
            onClick={() => setConfirmOpen(true)}
          >
            Reset conversation
          </Button>
        </div>

        <details className="group overflow-hidden rounded-lg border border-line bg-surface">
          <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
            <Icon
              className="-rotate-90 text-ink-3 transition-transform duration-200 ease-standard group-open:rotate-0"
              name="chevron"
              size={14}
            />
            <span className="font-medium">System prompt draft</span>
            {modified && <Badge tone="warn">modified</Badge>}
            <span className="w-full pl-6 text-cap text-ink-3 md:ml-auto md:w-auto md:pl-0">
              Overrides the saved prompt for this conversation only
            </span>
          </summary>
          <div className="flex flex-col gap-2 border-t border-line p-3">
            <Textarea
              aria-label="System prompt draft"
              className="border-accent"
              disabled={pending}
              mono
              rows={5}
              value={draft}
              onChange={e => setDraft(e.target.value)}
            />
            <div className="flex items-center justify-between gap-2 text-xs text-ink-3">
              <span className="font-mono tabular-nums">
                {draft.length} / {PROMPT_MAX}
              </span>
              <Button
                disabled={!modified || pending}
                size="sm"
                variant="ghost"
                onClick={() => setDraft(settings.systemPrompt)}
              >
                Reset to saved
              </Button>
            </div>
            <p className="text-xs text-ink-3">
              The draft is never saved. The intro, input format and emoji
              dictionary are always appended, as in production.
            </p>
          </div>
        </details>
      </div>

      {turns.length === 0 && !pending ? (
        <div className="rounded-lg border border-line bg-surface">
          <EmptyState
            body="Ask the model something and see whether it reaches for the server’s emojis."
            title="No messages yet"
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="playground-thread">
          {turns.map(turn =>
            turn.role === 'user' ? (
              <UserBubble key={turn.id} lookup={lookup} turn={turn} />
            ) : turn.role === 'assistant' ? (
              <AssistantBubble key={turn.id} lookup={lookup} turn={turn} />
            ) : (
              <ErrorBubble
                key={turn.id}
                retryDisabled={busy}
                turn={turn}
                onRetry={() => retry(turn)}
              />
            ),
          )}
          {pending && <PendingBubble model={model} />}
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-end gap-3">
          <Textarea
            aria-label="Message"
            className="flex-1"
            placeholder="Message tdr-bot…"
            rows={2}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send()
              }
            }}
          />
          <Button
            className="pointer-coarse:min-h-11"
            disabled={!canSend}
            variant="accent"
            onClick={send}
          >
            Send
          </Button>
        </div>
        <p className="flex items-center gap-1.5 text-cap text-ink-3">
          <Kbd>Enter</Kbd>
          to send ·<Kbd>Shift</Kbd>+<Kbd>Enter</Kbd>
          for a newline
        </p>
      </div>

      <EvalPanel
        disabled={pending}
        lookup={lookup}
        savedModel={settings.models.chat}
        systemPromptDraft={draftOverride(draft, settings.systemPrompt)}
        onRunningChange={setEvalRunning}
      />

      <ConfirmDialog
        body="The thread is cleared and the model starts fresh. The system prompt draft stays."
        cancelLabel="Keep it"
        confirmLabel="Reset conversation"
        open={confirmOpen}
        title="Reset the conversation?"
        onConfirm={reset}
        onOpenChange={setConfirmOpen}
      />
    </>
  )
}

export default function PlaygroundPage() {
  const { data, isLoading, error } = useSettings()

  return (
    <div className="mx-auto flex w-full max-w-[1136px] flex-col gap-6 px-4 py-5 md:px-8 md:py-8">
      <header className="flex flex-col gap-1">
        <h1 className="text-h1">Playground</h1>
        <p className="text-sm text-ink-3">
          Chat with the bot’s model outside Discord and see which emojis it
          picks. The model writes :shortcodes:, which are resolved to real
          emojis before display, as in Discord; repaired and hallucinated ones
          are counted against the raw output.
        </p>
      </header>

      {isLoading && (
        <div
          aria-label="Loading playground"
          className="flex flex-col gap-3"
          role="status"
        >
          <Skeleton className="h-16 w-full max-w-md rounded-md" />
          <Skeleton className="h-10 w-full rounded-lg" />
          <Skeleton className="h-40 w-full rounded-lg" />
        </div>
      )}
      {error && (
        <Note
          icon={<Icon name="alert" />}
          lead="Couldn’t load settings."
          tone="bad"
        >
          The API didn’t answer. Reload the page to try again.
        </Note>
      )}
      {data && <Playground settings={data} />}
    </div>
  )
}
