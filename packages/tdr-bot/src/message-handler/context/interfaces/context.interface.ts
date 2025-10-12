export interface BaseContext {
  timestamp: number
  isActive: boolean
}

export interface ContextEntry<T extends BaseContext> {
  contextType: string
  data: T
  createdAt: number
  lastAccessed: number
}
