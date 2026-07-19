export const ACP_EVENT_HANDLERS = 'ACP_EVENT_HANDLERS' as const
// Bound to DiscordHandlerService (src/discord/discord.module.ts) — see
// PlanApprovalPresenter in agent.types.ts for why this is a separate token
// rather than folded into ACP_EVENT_HANDLERS.
export const PLAN_APPROVAL_PRESENTER = 'PLAN_APPROVAL_PRESENTER' as const
