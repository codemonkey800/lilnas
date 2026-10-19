'use client'

import Box from '@mui/material/Box'
import MenuItem from '@mui/material/MenuItem'
import type { SxProps, Theme } from '@mui/material/styles'
import TextField from '@mui/material/TextField'
import Typography from '@mui/material/Typography'

import type { ModelSpec } from 'src/llm/models/catalog'
import type { ModelRole } from 'src/llm/models/roles'
import { useModels } from 'src/queries/useModels'

const usd = (n: number) => `$${n.toFixed(n < 1 ? 3 : 2).replace(/\.?0+$/, '')}`

export function priceLabel(model: ModelSpec): string {
  if (!model.pricing) return 'per-image pricing'
  const { inputPer1M, outputPer1M } = model.pricing
  return `${usd(inputPer1M)} in / ${usd(outputPer1M)} out per 1M`
}

export function ModelOption({ model }: { model: ModelSpec }) {
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

export function ModelSelect({
  role,
  label,
  value,
  error,
  disabled,
  size,
  sx,
  onChange,
}: {
  role: ModelRole
  label: string
  value: string
  error?: string
  disabled?: boolean
  size?: 'small' | 'medium'
  sx?: SxProps<Theme>
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
      size={size}
      sx={sx}
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
