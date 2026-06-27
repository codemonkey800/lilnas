---
date: 2026-06-27
topic: tdr-code-stop-clear
---

# tdr-code Stop Control & `/clear` Command

## Problem Frame

`@lilnas/tdr-code` is a Discord bot that runs an ACP-driven coding agent (`claude`) per channel. Today the only way to interact is by @mentioning the bot. Messages sent while the agent is working are queued and run sequentially against the same context (session-manager.ts:62-65, 119-128).

This leaves two gaps:

- **No way to interrupt a turn that's going the wrong way.** A correction like "no, stop, do X instead" just queues behind the bad turn and runs *after* it finishes, against the same context.
- **No way to reset a channel's agent to a clean slate.**

This work adds a **Stop control** to halt the current turn (and drop queued work) and a **`/clear` command** to wipe a channel's agent context. The underlying cancel/teardown machinery already exists in `SessionManagerService` but is not wired to any user-facing trigger — so this is primarily a wiring task, not a from-scratch build.

---

## Actors

- A1. **Channel participant** — any human in a channel where the bot is active. Drives the agent via @mentions, and may click Stop or run `/clear`. All participants have equal control; there is no requestor-only gating.
- A2. **tdr-code agent session** — the per-channel `claude` process managed by `SessionManagerService`. Receives prompts, streams output, honors ACP cancel, and is torn down by `/clear`.

---

## Key Flows

- F1. **Stop the current turn**
  - **Trigger:** A1 clicks the Stop control while the agent is working.
  - **Actors:** A1, A2
  - **Steps:** Agent is mid-turn (Stop control visible) → user clicks Stop → ACP cancel is sent to the session → queued messages for the channel are discarded → turn ends with `cancelled` status → partial output is finalized and marked stopped → Stop control is removed.
  - **Outcome:** The channel is idle, the session and its context are preserved, and nothing queued runs. The user can @mention again to continue or redirect.
  - **Escape path:** If the agent does not honor cancel promptly, the turn is still expected to terminate via the normal ACP `cancelled` stop reason (cancel reliability is a deferred planning question).
  - **Covered by:** R1, R2, R3, R4, R5, R6, R7, R15

- F2. **Clear the channel's session**
  - **Trigger:** A1 runs `/clear`.
  - **Actors:** A1, A2
  - **Steps:** User runs `/clear` → if a turn is running it is force-stopped → the agent process tree is terminated → queued messages and channel display state are discarded → confirmation reply is posted.
  - **Outcome:** No session exists for the channel; the next @mention spawns a fresh agent with empty context.
  - **Covered by:** R8, R9, R10, R11, R12, R13, R14

---

## Requirements

**Stop control**
- R1. While the agent is actively working a turn in a channel, a Stop control is visible in that channel.
- R2. Clicking Stop cancels the in-progress agent turn via a graceful ACP cancel (not a process kill).
- R3. Clicking Stop also discards any messages queued behind the current turn in that channel.
- R4. After Stop, the session and its agent process remain alive — context is preserved and the next @mention continues the same conversation.
- R5. Any participant in the channel can click Stop, regardless of who started the turn.
- R6. Partial output already streamed before Stop is kept and visibly marked as stopped (e.g. a "⏹ Stopped" indicator).
- R7. The Stop control is removed once the turn ends, whether it ended by completion, error, or Stop.
- R15. The Stop control appears for every turn, including turns that produce only text and call no tools.

**`/clear` command**
- R8. A `/clear` slash command is available in any channel where the bot operates.
- R9. `/clear` tears down the channel's agent session — terminating the agent process tree and discarding its conversation context.
- R10. `/clear` discards any queued messages and resets the channel's streaming/display state.
- R11. If `/clear` runs while the agent is mid-turn, it force-stops the agent rather than waiting for the turn to finish.
- R12. After `/clear`, the next @mention starts a brand-new session with empty context.
- R13. Any participant in the channel can run `/clear`.
- R14. `/clear` replies with a confirmation (e.g. "Session cleared — next @mention starts fresh.").

---

## Acceptance Examples

- AE1. **Covers R2, R3, R4.** Given the agent is working turn A and message B is queued behind it, when a user clicks Stop, then turn A halts, B is discarded and never runs, and the session stays alive so a later @mention continues the same conversation.
- AE2. **Covers R6.** Given the agent has streamed a partial reply, when a user clicks Stop, then the partial reply remains in the channel marked as stopped (not deleted).
- AE3. **Covers R9, R11, R12.** Given the agent is mid-turn, when a user runs `/clear`, then the agent process is force-killed and the next @mention starts a fresh session with no memory of prior turns.
- AE4. **Covers R15.** Given a turn that only produces text and calls no tools, when it is running, then a Stop control is still visible for that turn.
- AE5. **Covers R5, R13.** Given user X started the current turn, when user Y (a different participant) clicks Stop or runs `/clear`, then the action succeeds with no permission rejection.

---

## Success Criteria

- A user can halt a turn that's going wrong and immediately redirect, without waiting for it to finish or for queued corrections to run first.
- A user can reset a channel to a clean-context agent on demand.
- The Stop control reliably appears during every turn (including text-only turns) and reliably disappears when the turn ends.
- A downstream implementer can wire both features onto the existing `cancel()` / `teardown()` methods, with the only behavioral additions being: queue-clearing on Stop, `cancelled`-aware finalization, an always-present Stop control, and the `/clear` command surface.

---

## Scope Boundaries

- No persistent conversation history or transcript storage — the empty `db/schema.ts` stub stays as-is; "context" lives only in the running agent process.
- No pause/resume of a turn — Stop is terminal for the turn.
- No "steer the running turn" / mid-turn editing — to redirect, Stop then send a new message.
- No per-user or role-based permissions for Stop or `/clear` (explicitly decided: anyone in the channel).
- No global / cross-channel controls (e.g. "stop all sessions").
- No change to the existing @mention trigger or queue-while-busy behavior, other than Stop and `/clear` clearing the queue.

---

## Key Decisions

- **Stop = graceful ACP cancel + clear queue, session preserved; `/clear` = full teardown.** Keeps the two actions cleanly distinct: Stop halts a turn, `/clear` wipes context. (Chose this over "Stop is the same as Clear," which would make the two surfaces redundant.)
- **Anyone in the channel can Stop and `/clear`.** This is a small/trusted self-hosted deployment; requestor-only gating (as in the acp-discord reference) adds ceremony and would prevent a bystander from halting a runaway agent.
- **Keep partial output on Stop, marked stopped.** Discarding streamed work is worse UX, and `stopReason === 'cancelled'` is already delivered to `onPromptComplete` (agent.types.ts:27), so finalizing differently is nearly free.
- **`/clear` force-kills mid-run.** No conversation state is persisted (verified: `db/schema.ts` is an empty stub), so there is nothing to lose by force-killing — it is both safe and simplest.
- **Stop control lives on a dedicated "working" status message**, not the tool-summary message, so it also appears on turns that call no tools (closing a gap the acp-discord reference has, where the button rides the tool-summary message).

---

## Dependencies / Assumptions

- **The cancel/teardown plumbing already exists and is unwired** [verified]: `SessionManagerService.cancel()` (session-manager.ts:70-75) sends ACP `session/cancel`; `teardown()` (session-manager.ts:77-83) kills the detached process tree and drops the session. Today nothing user-facing calls either.
- **No conversation history is persisted** [verified]: `apps/tdr-code/src/db/schema.ts` is an empty stub, so "clearing context" means terminating the agent process — there are no DB rows to wipe.
- **Necord is already configured for slash commands** [verified]: dev-guild registration is set up (app.module.ts:32-42). `/clear` would be the bot's first slash command and the Stop button its first interaction component — both are standard Necord additions, no new framework wiring.
- **`stopReason` is already plumbed but ignored** [verified]: `onPromptComplete(channelId, stopReason)` (agent.types.ts:27) receives the reason; the handler currently drops it (discord-handler.service.ts:90). Stop's "marked stopped" finalization keys off `stopReason === 'cancelled'`.
- **Assumes `connection.cancel()` reliably ends the turn** with `stopReason 'cancelled'` — it is already used in-tree, but exact cancel timing and any tail of streamed events are to be confirmed in planning.

---

## Outstanding Questions

### Resolve Before Planning

- _(none — all product decisions are resolved)_

### Deferred to Planning

- [Affects R1, R7, R15][Technical] Exact mechanism and lifecycle for the always-present Stop control — a dedicated "working…" status message posted at turn start and removed at turn end vs. another placement — and how its components are attached/stripped on completion, error, and Stop.
- [Affects R2, R3][Technical] `cancel()` must also empty `session.queue`, because `executePrompt`'s `finally` block auto-drains the queue (session-manager.ts:119-128); otherwise the next queued message starts the instant the cancelled turn returns. Confirm there is no race between cancel and the in-flight `finally` drain.
- [Affects R1, R7][Technical] Stale-button handling: clicking Stop after the turn ended (button on an older message) — scope the interaction to the current turn (e.g. encode a turn id in the button `customId`) or accept that it cancels whatever is currently running in that channel.
- [Affects R2][Needs research] ACP cancel timing — does streaming stop promptly, and is there a tail of tool/chunk events after cancel that the handler must ignore when finalizing?

---

## Next Steps

-> `/ce-plan` for structured implementation planning
