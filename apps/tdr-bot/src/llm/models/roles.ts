export const MODEL_ROLES = ['chat', 'reasoning', 'image'] as const
export type ModelRole = (typeof MODEL_ROLES)[number]
