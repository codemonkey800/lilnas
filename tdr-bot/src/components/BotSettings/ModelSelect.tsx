'use client'

import { ChatModel } from 'openai/resources'

import { Select } from 'src/components/Select'

const MODELS: ChatModel[] = [
  'o1',
  'o1-preview',
  'o1-mini',
  'gpt-4o',
  'chatgpt-4o-latest',
  'gpt-4o-mini',
  'gpt-4-turbo',
  'gpt-4',
  'gpt-3.5-turbo',
]

const MODEL_OPTIONS = MODELS.map((model) => ({ label: model, value: model }))

export function ModelSelect({
  id,
  label,
  onChange,
  value,
}: {
  id: string
  label: string
  onChange(value: ChatModel): void
  value: ChatModel
}) {
  return (
    <Select
      id={id}
      items={MODEL_OPTIONS}
      label={label}
      onChange={(nextModel) => onChange(nextModel)}
      value={value}
    />
  )
}
