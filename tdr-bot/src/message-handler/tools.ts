import { tool } from '@langchain/core/tools'

export const dateTool = tool(() => new Date().toISOString(), {
  name: 'get_date',
  description: 'Gets the current date in ISO format',
})
