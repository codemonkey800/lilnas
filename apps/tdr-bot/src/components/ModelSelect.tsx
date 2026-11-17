'use client'

import { Select } from '@lilnas/ui'
import { cns } from '@lilnas/utils/cns'
import { useId } from 'react'

import type { ModelSpec } from 'src/llm/models/catalog'
import type { ModelRole } from 'src/llm/models/roles'
import { useModels } from 'src/queries/useModels'

const usd = (n: number) => `$${n.toFixed(2)}`

/** The per-1M price line: `$2.00 in · $8.00 out`, or `per image`. */
export function priceLabel(model: ModelSpec): string {
  if (!model.pricing) return 'per image'
  const { inputPer1M, outputPer1M } = model.pricing
  return `${usd(inputPer1M)} in · ${usd(outputPer1M)} out`
}

export function ModelOption({ model }: { model: ModelSpec }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5 text-left">
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-mono text-mono text-ink">{model.label}</span>
        <span className="font-mono text-mono-sm whitespace-nowrap text-ink-3 tabular-nums">
          {priceLabel(model)}
        </span>
      </span>
      <span className="text-cap text-ink-3">{model.description}</span>
    </span>
  )
}

export function ModelSelect({
  role,
  label,
  value,
  error,
  disabled,
  className,
  onChange,
}: {
  role: ModelRole
  label: string
  value: string
  error?: string
  disabled?: boolean
  className?: string
  onChange: (id: string) => void
}) {
  const { data: models = [], isLoading } = useModels(role)
  const known = models.some(m => m.id === value)
  const triggerId = useId()
  const errorId = `${triggerId}-error`
  const labels = Object.fromEntries(models.map(m => [m.id, m.label]))

  return (
    <div className={cns('flex flex-col gap-1.5', className)}>
      <label
        className="text-sm font-medium text-ink-2"
        htmlFor={triggerId}
        id={`${triggerId}-label`}
      >
        {label}
      </label>
      <Select.Root
        disabled={disabled || isLoading}
        items={labels}
        value={value}
        onValueChange={next => {
          if (typeof next === 'string') onChange(next)
        }}
      >
        <Select.Trigger
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          aria-labelledby={`${triggerId}-label`}
          className="h-auto items-start py-2.5 aria-invalid:border-bad"
          id={triggerId}
        >
          <Select.Value className="min-w-0 flex-1 whitespace-normal">
            {(selected: string) => {
              const model = models.find(m => m.id === selected)
              return model ? (
                <ModelOption model={model} />
              ) : (
                <span className="font-mono text-mono">{selected}</span>
              )
            }}
          </Select.Value>
        </Select.Trigger>
        <Select.Popup>
          {!known && !isLoading && (
            <Select.Item disabled value={value}>
              <span className="font-mono text-mono">{value}</span>
            </Select.Item>
          )}
          {models.map(model => (
            <Select.Item
              key={model.id}
              className="items-start py-2 [&>*:first-child]:overflow-visible [&>*:first-child]:whitespace-normal"
              value={model.id}
            >
              <ModelOption model={model} />
            </Select.Item>
          ))}
        </Select.Popup>
      </Select.Root>
      {error && (
        <p className="text-cap text-bad" id={errorId}>
          {error}
        </p>
      )}
    </div>
  )
}
