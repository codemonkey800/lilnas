import { ApiClient } from 'src/api/api.client'
import { EditableAppState } from 'src/api/api.types'

import { BotSettingsForm } from './BotSettingsForm'

const apiClient = ApiClient.getInstance()

export async function BotSettings() {
  const state = await apiClient.getState()

  async function updateState(nextState: EditableAppState) {
    'use server'

    const payload = { ...nextState }
    let shouldUpdate = false

    for (const key of Object.keys(state)) {
      const stateKey = key as keyof EditableAppState

      if (state[stateKey] === payload[stateKey]) {
        delete payload[stateKey]
      } else {
        shouldUpdate = true
      }
    }

    if (shouldUpdate) {
      await apiClient.updateState(payload)
    }
  }

  return <BotSettingsForm initialState={state} updateState={updateState} />
}
