'use client'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Card from '@mui/material/Card'
import CardContent from '@mui/material/CardContent'
import CircularProgress from '@mui/material/CircularProgress'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogContentText from '@mui/material/DialogContentText'
import DialogTitle from '@mui/material/DialogTitle'
import FormControl from '@mui/material/FormControl'
import FormControlLabel from '@mui/material/FormControlLabel'
import FormLabel from '@mui/material/FormLabel'
import MenuItem from '@mui/material/MenuItem'
import Radio from '@mui/material/Radio'
import RadioGroup from '@mui/material/RadioGroup'
import Slider from '@mui/material/Slider'
import Stack from '@mui/material/Stack'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'
import { useMemo, useState } from 'react'

import { ApiRequestError } from 'src/api/api.client'
import type { SettingsResponse } from 'src/api/api.types'
import type { ModelSpec } from 'src/llm/models/catalog'
import type { ModelRole } from 'src/llm/models/roles'
import type { Settings } from 'src/llm/settings/settings.schema'
import { useModels } from 'src/queries/useModels'
import {
  useResetSettings,
  useSettings,
  useUpdateSettings,
} from 'src/queries/useSettings'

const PROMPT_MAX = 20_000
const EFFORTS = ['low', 'medium', 'high'] as const

type Draft = Settings

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2).replace(/\.?0+$/, '')}`

function priceLabel(model: ModelSpec): string {
  if (!model.pricing) return 'per-image pricing'
  const { inputPer1M, outputPer1M } = model.pricing
  return `${usd(inputPer1M)} in / ${usd(outputPer1M)} out per 1M`
}

function formatSavedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Typography variant="subtitle1" fontWeight={600}>
          {title}
        </Typography>
        {subtitle && (
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {subtitle}
          </Typography>
        )}
        {children}
      </CardContent>
    </Card>
  )
}

function ModelOption({ model }: { model: ModelSpec }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 2,
        width: '100%',
        whiteSpace: 'normal',
      }}
    >
      <Box>
        <Typography variant="body2" fontFamily="monospace">
          {model.label}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {model.description}
        </Typography>
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ flexShrink: 0, textAlign: 'right' }}
      >
        {priceLabel(model)}
      </Typography>
    </Box>
  )
}

function ModelSelect({
  role,
  label,
  value,
  error,
  disabled,
  onChange,
}: {
  role: ModelRole
  label: string
  value: string
  error?: string
  disabled?: boolean
  onChange: (id: string) => void
}) {
  const { data: models = [], isLoading } = useModels(role)
  const known = models.some(m => m.id === value)

  return (
    <TextField
      select
      fullWidth
      label={label}
      value={isLoading ? '' : value}
      disabled={disabled || isLoading}
      error={!!error}
      helperText={error}
      onChange={e => onChange(e.target.value)}
      slotProps={{
        select: {
          renderValue: selected => {
            const model = models.find(m => m.id === selected)
            return model ? <ModelOption model={model} /> : String(selected)
          },
        },
      }}
    >
      {!known && !isLoading && (
        <MenuItem value={value} disabled>
          {value}
        </MenuItem>
      )}
      {models.map(model => (
        <MenuItem key={model.id} value={model.id}>
          <ModelOption model={model} />
        </MenuItem>
      ))}
    </TextField>
  )
}

function issueFor(error: Error | null, path: string): string | undefined {
  if (!(error instanceof ApiRequestError)) return undefined
  return error.issues.find(i => i.path === path)?.message
}

function SettingsForm({ settings }: { settings: SettingsResponse }) {
  const update = useUpdateSettings()
  const reset = useResetSettings()
  const { data: chatModels = [] } = useModels('chat')

  const [draft, setDraft] = useState<Draft>({
    models: settings.models,
    temperature: settings.temperature,
    reasoningEffort: settings.reasoningEffort,
    systemPrompt: settings.systemPrompt,
  })
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [justSaved, setJustSaved] = useState(false)

  const dirty = useMemo(
    () =>
      draft.models.chat !== settings.models.chat ||
      draft.models.reasoning !== settings.models.reasoning ||
      draft.models.image !== settings.models.image ||
      draft.temperature !== settings.temperature ||
      draft.reasoningEffort !== settings.reasoningEffort ||
      draft.systemPrompt !== settings.systemPrompt,
    [draft, settings],
  )

  const chatSpec = chatModels.find(m => m.id === draft.models.chat)
  const hasTemperature = chatSpec?.capabilities.temperature ?? true
  const saving = update.isPending || reset.isPending
  const saveDisabled = !dirty || saving

  const edit = (next: Draft) => {
    setJustSaved(false)
    update.reset()
    setDraft(next)
  }

  const save = () =>
    update.mutate(draft, { onSuccess: () => setJustSaved(true) })

  const confirmReset = () => {
    setConfirmOpen(false)
    reset.mutate(undefined, { onSuccess: () => setJustSaved(true) })
  }

  const globalError =
    update.error &&
    !(update.error instanceof ApiRequestError && update.error.issues.length)
      ? update.error.message
      : null

  return (
    <Stack spacing={2}>
      <SectionCard
        title="Models"
        subtitle="One model per role. Prices are USD per 1M tokens."
      >
        <Stack spacing={2}>
          {(
            [
              ['chat', 'Chat'],
              ['reasoning', 'Reasoning'],
              ['image', 'Image'],
            ] as const
          ).map(([role, label]) => (
            <ModelSelect
              key={role}
              role={role}
              label={label}
              value={draft.models[role]}
              disabled={saving}
              error={issueFor(update.error, `models.${role}`)}
              onChange={id =>
                edit({ ...draft, models: { ...draft.models, [role]: id } })
              }
            />
          ))}
        </Stack>
      </SectionCard>

      <SectionCard
        title="Generation"
        subtitle={
          hasTemperature
            ? 'Temperature applies to this chat model.'
            : `${chatSpec?.label ?? draft.models.chat} is a reasoning model and has no temperature.`
        }
      >
        {hasTemperature ? (
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" id="temperature-label">
                Temperature
              </Typography>
              <Typography variant="caption" fontFamily="monospace">
                {draft.temperature.toFixed(1)}
              </Typography>
            </Box>
            <Slider
              aria-labelledby="temperature-label"
              min={0}
              max={2}
              step={0.1}
              value={draft.temperature}
              disabled={saving}
              onChange={(_, v) =>
                edit({ ...draft, temperature: Array.isArray(v) ? v[0] : v })
              }
            />
            <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
              <Typography variant="caption" color="text.secondary">
                0 · precise
              </Typography>
              <Typography variant="caption" color="text.secondary">
                2 · creative
              </Typography>
            </Box>
            {issueFor(update.error, 'temperature') && (
              <Typography variant="caption" color="error">
                {issueFor(update.error, 'temperature')}
              </Typography>
            )}
          </Box>
        ) : (
          <FormControl disabled={saving}>
            <FormLabel id="effort-label">Reasoning effort</FormLabel>
            <RadioGroup
              row
              aria-labelledby="effort-label"
              value={draft.reasoningEffort}
              onChange={e =>
                edit({
                  ...draft,
                  reasoningEffort: e.target.value as Draft['reasoningEffort'],
                })
              }
            >
              {EFFORTS.map(level => (
                <FormControlLabel
                  key={level}
                  value={level}
                  control={<Radio />}
                  label={level}
                />
              ))}
            </RadioGroup>
          </FormControl>
        )}
      </SectionCard>

      <SectionCard
        title="System prompt"
        subtitle="Prepended to every conversation."
      >
        <TextField
          multiline
          fullWidth
          minRows={6}
          value={draft.systemPrompt}
          disabled={saving}
          error={!!issueFor(update.error, 'systemPrompt')}
          helperText={
            issueFor(update.error, 'systemPrompt') ??
            `${draft.systemPrompt.length} / ${PROMPT_MAX}`
          }
          onChange={e => edit({ ...draft, systemPrompt: e.target.value })}
          slotProps={{
            input: { sx: { fontFamily: 'monospace', fontSize: 13 } },
            htmlInput: { 'aria-label': 'System prompt' },
          }}
        />
      </SectionCard>

      {globalError && <Alert severity="error">{globalError}</Alert>}

      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Button
          variant="contained"
          disabled={saveDisabled}
          onClick={save}
          startIcon={
            update.isPending ? <CircularProgress size={14} /> : undefined
          }
        >
          {update.isPending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          color="inherit"
          disabled={saving}
          onClick={() => setConfirmOpen(true)}
        >
          Reset
        </Button>
        <Typography
          variant="caption"
          color={
            update.isError
              ? 'error'
              : dirty
                ? 'warning.main'
                : justSaved
                  ? 'success.main'
                  : 'text.secondary'
          }
          sx={{ ml: 'auto' }}
        >
          {update.isError
            ? "Can't save — fix the highlighted field"
            : dirty
              ? 'Unsaved changes'
              : `${justSaved ? '✓ ' : ''}Saved ${formatSavedAt(settings.updatedAt)}`}
        </Typography>
      </Box>

      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>Reset settings?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This restores the default models, generation settings and system
            prompt. Your current settings will be lost.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setConfirmOpen(false)}>
            Cancel
          </Button>
          <Button color="error" onClick={confirmReset}>
            Reset
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}

export default function SettingsPage() {
  const { data, isLoading, error } = useSettings()

  return (
    <Box sx={{ maxWidth: 720, mx: 'auto', p: { xs: 2, md: 4 } }}>
      <Typography variant="h4" component="h1" fontWeight={600}>
        Settings
      </Typography>
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{ mb: 3, mt: 0.5 }}
      >
        Runtime LLM configuration.
      </Typography>

      {isLoading && <CircularProgress aria-label="Loading settings" />}
      {error && <Alert severity="error">Couldn’t load settings.</Alert>}
      {data && <SettingsForm key={data.updatedAt} settings={data} />}
    </Box>
  )
}
