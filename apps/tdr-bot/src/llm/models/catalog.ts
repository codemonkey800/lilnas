import { ModelRole } from 'src/llm/models/roles'

export interface ModelCapabilities {
  tools: boolean
  structuredOutput: boolean
  temperature: boolean
  reasoningEffort: boolean
  /**
   * False when the model rejects reasoning effort alongside function tools on
   * /v1/chat/completions; tool-bound calls then send `reasoning_effort: none`.
   */
  reasoningEffortWithTools?: boolean
  vision: boolean
  image: boolean
}

export interface ModelPricing {
  inputPer1M: number
  outputPer1M: number
  cachedInputPer1M?: number
}

export interface ModelSpec {
  id: string
  provider: 'openai'
  label: string
  description: string
  roles: readonly ModelRole[]
  capabilities: ModelCapabilities
  pricing: ModelPricing | null
  deprecated?: boolean
}

/** Connection settings for a model provider; consumed by the provider layer. */
export interface ModelProviderConfig {
  apiKey: string
  baseURL?: string
  organization?: string
  timeoutMs?: number
  maxRetries?: number
}

const TEXT_ROLES: readonly ModelRole[] = ['chat', 'reasoning']

const classic = (vision: boolean): ModelCapabilities => ({
  tools: true,
  structuredOutput: true,
  temperature: true,
  reasoningEffort: false,
  vision,
  image: false,
})

const reasoning = (vision: boolean): ModelCapabilities => ({
  tools: true,
  structuredOutput: true,
  temperature: false,
  reasoningEffort: true,
  vision,
  image: false,
})

const imageCaps: ModelCapabilities = {
  tools: false,
  structuredOutput: false,
  temperature: false,
  reasoningEffort: false,
  vision: false,
  image: true,
}

// Pricing in USD per 1M tokens, from OpenAI's public price list as of 2026-10-03
// (gpt-6-luna and gpt-6.1-sol checked on 2026-10-14).
export const MODEL_CATALOG: readonly ModelSpec[] = [
  {
    id: 'gpt-4-turbo',
    provider: 'openai',
    label: 'GPT-4 Turbo',
    description: 'Previous-generation flagship; the default chat model.',
    roles: TEXT_ROLES,
    capabilities: classic(true),
    pricing: { inputPer1M: 10, outputPer1M: 30 },
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    label: 'GPT-4o',
    description: 'Fast multimodal model for general chat.',
    roles: TEXT_ROLES,
    capabilities: classic(true),
    pricing: { inputPer1M: 2.5, outputPer1M: 10, cachedInputPer1M: 1.25 },
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    label: 'GPT-4o mini',
    description:
      'Small, cheap multimodal model; the default reasoning-role model.',
    roles: TEXT_ROLES,
    capabilities: classic(true),
    pricing: { inputPer1M: 0.15, outputPer1M: 0.6, cachedInputPer1M: 0.075 },
  },
  {
    id: 'gpt-4.1',
    provider: 'openai',
    label: 'GPT-4.1',
    description: 'Strong non-reasoning model with long context.',
    roles: TEXT_ROLES,
    capabilities: classic(true),
    pricing: { inputPer1M: 2, outputPer1M: 8, cachedInputPer1M: 0.5 },
  },
  {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    label: 'GPT-4.1 mini',
    description: 'Balanced speed and cost in the GPT-4.1 family.',
    roles: TEXT_ROLES,
    capabilities: classic(true),
    pricing: { inputPer1M: 0.4, outputPer1M: 1.6, cachedInputPer1M: 0.1 },
  },
  {
    id: 'gpt-4.1-nano',
    provider: 'openai',
    label: 'GPT-4.1 nano',
    description: 'Fastest and cheapest GPT-4.1 model.',
    roles: TEXT_ROLES,
    capabilities: classic(true),
    pricing: { inputPer1M: 0.1, outputPer1M: 0.4, cachedInputPer1M: 0.025 },
  },
  {
    id: 'gpt-5',
    provider: 'openai',
    label: 'GPT-5',
    description: 'Flagship reasoning model.',
    roles: TEXT_ROLES,
    capabilities: reasoning(true),
    pricing: { inputPer1M: 1.25, outputPer1M: 10, cachedInputPer1M: 0.125 },
  },
  {
    id: 'gpt-5-mini',
    provider: 'openai',
    label: 'GPT-5 mini',
    description: 'Cost-efficient GPT-5 reasoning model.',
    roles: TEXT_ROLES,
    capabilities: reasoning(true),
    pricing: { inputPer1M: 0.25, outputPer1M: 2, cachedInputPer1M: 0.025 },
  },
  {
    id: 'gpt-5-nano',
    provider: 'openai',
    label: 'GPT-5 nano',
    description: 'Fastest, cheapest GPT-5 reasoning model.',
    roles: TEXT_ROLES,
    capabilities: reasoning(true),
    pricing: { inputPer1M: 0.05, outputPer1M: 0.4, cachedInputPer1M: 0.005 },
  },
  {
    id: 'o3',
    provider: 'openai',
    label: 'o3',
    description: 'Deep reasoning model for hard problems.',
    roles: TEXT_ROLES,
    capabilities: reasoning(true),
    pricing: { inputPer1M: 2, outputPer1M: 8, cachedInputPer1M: 0.5 },
  },
  {
    id: 'o4-mini',
    provider: 'openai',
    label: 'o4-mini',
    description: 'Small, fast reasoning model.',
    roles: TEXT_ROLES,
    capabilities: reasoning(true),
    pricing: { inputPer1M: 1.1, outputPer1M: 4.4, cachedInputPer1M: 0.275 },
  },
  {
    id: 'gpt-6-luna',
    provider: 'openai',
    label: 'GPT-6 Luna',
    description: 'Cheapest GPT-6 model for focused, high-volume tasks.',
    roles: TEXT_ROLES,
    capabilities: { ...reasoning(true), reasoningEffortWithTools: false },
    pricing: { inputPer1M: 0.1, outputPer1M: 0.5, cachedInputPer1M: 0.01 },
  },
  {
    id: 'gpt-6.1-sol',
    provider: 'openai',
    label: 'GPT-6.1 Sol',
    description: 'Strong GPT-6.1 reasoning model.',
    roles: TEXT_ROLES,
    capabilities: reasoning(true),
    pricing: { inputPer1M: 2, outputPer1M: 10, cachedInputPer1M: 0.1 },
  },
  {
    id: 'dall-e-3',
    provider: 'openai',
    label: 'DALL·E 3',
    description: 'Image generation; priced per image, not per token.',
    roles: ['image'],
    capabilities: imageCaps,
    pricing: null,
  },
]

export const DEFAULT_MODELS: Record<ModelRole, string> = {
  chat: 'gpt-4-turbo',
  reasoning: 'gpt-4o-mini',
  image: 'dall-e-3',
}
