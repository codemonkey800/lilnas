'use client'

import { Button, TextField } from '@mui/material'
import _ from 'lodash'
import { useState } from 'react'

import { EditableAppState } from 'src/api/api.types'
import { NumberInput } from 'src/components/NumberInput'

import { ModelSelect } from './ModelSelect'

export function BotSettingsForm({
  initialState,
  updateState,
}: {
  initialState: EditableAppState
  updateState(data: EditableAppState): void
}) {
  const [state, setState] = useState<EditableAppState>(initialState)

  function update(state: Partial<EditableAppState>) {
    setState((prev) => ({ ...prev, ...state }))
  }

  return (
    <form onSubmit={() => updateState(state)}>
      <div className="flex flex-col items-center">
        <div className="flex flex-col gap-4 w-full md:max-w-[600px]">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <ModelSelect
              id="chat-model-select"
              label="Chat Model"
              onChange={(nextModel) => update({ chatModel: nextModel })}
              value={state.chatModel}
            />

            <ModelSelect
              id="reasoning-model-select"
              label="Reasoning Model"
              onChange={(reasoningModel) => update({ reasoningModel })}
              value={state.reasoningModel}
            />

            <NumberInput
              id="max-tokens-input"
              label="Max Tokens"
              onChange={(value) => update({ maxTokens: +value })}
              value={`${state.maxTokens}`}
            />

            <NumberInput
              id="temperature-input"
              label="Temperature"
              onChange={(value) => update({ temperature: +value })}
              value={`${state.temperature}`}
            />
          </div>

          <TextField
            id="prompt-input"
            label="Prompt"
            multiline
            onChange={(event) => update({ prompt: event.target.value })}
            value={state.prompt}
          />

          <Button
            className="!mt-4"
            type="submit"
            variant="contained"
            disabled={_.isEqual(state, initialState)}
          >
            Submit
          </Button>
        </div>
      </div>
    </form>
  )
}
