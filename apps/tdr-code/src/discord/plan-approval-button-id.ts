import type { PlanApprovalDecision } from 'src/agent/agent.types'

export const PLAN_APPROVAL_ID_PREFIX = 'plan'

export const planApprovalButtonId = (
  channelId: string,
  toolCallId: string,
  decision: PlanApprovalDecision,
): string => `${PLAN_APPROVAL_ID_PREFIX}/${channelId}/${toolCallId}/${decision}`
