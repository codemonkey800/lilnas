---
title: "feat: tdr-code Stop control & /clear command"
type: feat
status: active
date: 2026-06-27
origin: docs/brainstorms/2026-06-27-tdr-code-stop-clear-requirements.md
deepened: 2026-06-27
---

# feat: tdr-code Stop control & /clear command

## Overview

Add two user-facing controls to `@lilnas/tdr-code` (the per-channel ACP coding-agent Discord bot):

1. **Stop control** — a button shown during every agent turn. Clicking it sends a graceful ACP cancel, discards messages queued behind the turn, keeps partial output (marked stopped), and leaves the session alive so the next @mention continues the same conversation.
2. **`/clear` command** — a slash command that force-kills the channel's agent process tree, discards its queue and display state, and replies with a confirmation. The next @mention spawns a fresh agent with empty context.

The cancel/teardown plumbing already exists in `SessionManagerService` but is unwired. This is primarily a **wiring task**: connect existing `cancel()` / `teardown()` to new Discord surfaces, add a turn-start signal so a control can appear on every turn, make `cancel()` clear the queue, finalize cancelled turns distinctly, and add the bot's first slash command + first button.

---

## Problem Frame

Today the only way to drive a tdr-code agent is by @mentioning the bot. Messages sent while the agent is working are queued and run sequentially against the same context (see origin: `docs/brainstorms/2026-06-27-tdr-code-stop-clear-requirements.md`). This leaves two gaps:

- **No way to interrupt a turn going the wrong way.** A correction like "no, stop, do X" just queues behind the bad turn and runs *after* it finishes, against the same context.
- **No way to reset a channel's agent to a clean slate.**

This is a small, trusted, self-hosted deployment, so both controls are available to any participant in the channel (no requestor-only gating).

---

## Requirements Trace

- R1. While the agent is actively working a turn, a Stop control is visible in that channel. → U2
- R2. Clicking Stop cancels the in-progress turn via a graceful ACP cancel (not a process kill). → U1, U3
- R3. Clicking Stop discards any messages queued behind the current turn. → U1
- R4. After Stop, the session and agent process remain alive — context preserved, next @mention continues. → U1, U3
- R5. Any participant can click Stop, regardless of who started the turn. → U3
- R6. Partial output streamed before Stop is kept and visibly marked stopped (e.g. "⏹ Stopped"). → U2
- R7. The Stop control is removed once the turn ends, whether by completion, error, or Stop. → U2
- R8. A `/clear` slash command is available in any channel where the bot operates. → U4
- R9. `/clear` tears down the channel's agent session (terminate process tree, discard context). → U4
- R10. `/clear` discards queued messages and resets streaming/display state. → U4
- R11. If `/clear` runs mid-turn, it force-stops the agent rather than waiting. → U4
- R12. After `/clear`, the next @mention starts a brand-new session with empty context. → U4
- R13. Any participant can run `/clear`. → U4
- R14. `/clear` replies with a confirmation. → U4
- R15. The Stop control appears for every turn, including text-only turns that call no tools. → U2

**Origin actors:** A1 (channel participant — drives the agent, may Stop or `/clear`; all participants equal), A2 (tdr-code agent session — per-channel `claude` process managed by `SessionManagerService`).
**Origin flows:** F1 (stop the current turn), F2 (clear the channel's session).
**Origin acceptance examples:** AE1 (covers R2, R3, R4), AE2 (covers R6), AE3 (covers R9, R11, R12), AE4 (covers R15), AE5 (covers R5, R13).

---

## Scope Boundaries

- No persistent conversation history or transcript storage — the empty `apps/tdr-code/src/db/schema.ts` stub stays as-is; "context" lives only in the running agent process.
- No pause/resume of a turn — Stop is terminal for the turn.
- No "steer the running turn" / mid-turn editing — to redirect, Stop then send a new message.
- No per-user or role-based permissions for Stop or `/clear` (explicitly: anyone in the channel).
- No global / cross-channel controls (e.g. "stop all sessions").
- No change to the existing @mention trigger or queue-while-busy behavior, other than Stop and `/clear` clearing the queue.

---

## Context & Research

### Relevant Code and Patterns

- **Session lifecycle — `apps/tdr-code/src/agent/session-manager.service.ts`:**
  - `cancel(channelId)` (L70-75): already calls `session.connection.cancel({ sessionId })`. Unwired; does **not** clear the queue.
  - `teardown(channelId)` (L77-83): `clearTimeout` + `killProcessTree` (SIGTERM to the negative pid / process group, escalating to SIGKILL after 5s) + `sessions.delete`. This is the force-kill path for `/clear`.
  - `executePrompt` (L95-131): sets `prompting=true`, awaits `connection.prompt(...)`, calls `onPromptComplete(channelId, result.stopReason)`; on throw calls `onPromptComplete(channelId, 'error')` + `teardown` + rethrow; **`finally` (L117-130) drains the queue** — `queue.shift()` then recursively `executePrompt`. This drain is what Stop must suppress by clearing the queue first.
  - `ManagedSession` (L18-28): in-memory per-channel state (`process`, `connection`, `sessionId`, `prompting`, `queue`, `activeUserId`). No DB backing.
- **Streaming + turn-end render — `apps/tdr-code/src/discord/discord-handler.service.ts`:**
  - `onPromptComplete(channelId)` (L90-107): **currently ignores `stopReason`** (impl takes one param though the interface declares two). Captures buffer/replyMsg/toolSummaryMsg, deletes channel state, calls `finalizeTurn`.
  - `finalizeTurn` (L296-321): already strips `components: []` from the tool-summary message ("no stop button in this impl" comment, L302) — button-removal scaffolding exists; the button itself was never added.
  - `updateToolSummaryMessage` (L182-217): create/edit-with-`toolSummaryCreating`-guard pattern to mirror for the working message.
  - `@On(Events.MessageCreate)` (L111-151): @mention entry; resolves `SessionManagerService` via `moduleRef.get(..., { strict: false })` (circular-DI workaround).
  - `ChannelState` (L19-30): per-channel display state map.
- **Callback contract — `apps/tdr-code/src/agent/agent.types.ts`:** `AcpEventHandlers` with `onPromptComplete(channelId, stopReason: string)` already in the interface. The Discord surface is the sole implementer.
- **ACP event mapping — `apps/tdr-code/src/agent/acp-client.ts`:** maps `sessionUpdate` → handlers (`agent_message_chunk`, `tool_call`, `tool_call_update`). No "turn end" event here — turn end is the resolution of the awaited `connection.prompt(...)` promise.
- **DI wiring — `apps/tdr-code/src/discord/discord.module.ts`:** the single feature module; declares `DiscordHandlerService`, the `ACP_EVENT_HANDLERS` token (`useExisting: DiscordHandlerService`), and `SessionManagerService`. New providers (button service, command service) register here.
- **Necord config — `apps/tdr-code/src/app.module.ts` (L32-42):** `development: [DISCORD_GUILD_ID]` scopes slash commands to a guild for instant registration. No new framework wiring needed for the first command/button.
- **Slash-command pattern to mirror — `apps/tdr-bot/src/commands/command.service.ts`** (`@SlashCommand`, `SlashCommandContext`; `/restart` L108-133 is the simplest example) and **`apps/tdr-bot/src/commands/commands.module.ts`** (dedicated module + `providers`). Ephemeral replies: `apps/tdr-bot/src/commands/download-command.service.ts` L100 uses `MessageFlags.Ephemeral`.
- **Test harness:** `apps/tdr-code/jest.config.js` is fully configured (`ts-jest`, `__tests__/**`, `moduleNameMapper` for `src/*`) but tdr-code has **zero tests**. Mirror tdr-bot's helpers: `apps/tdr-bot/src/__tests__/setup.ts` (mocks `necord` + `discord.js` decorators as no-ops) and `apps/tdr-bot/src/__tests__/test-utils.ts` (`createTestingModule`, mock factories). Representative: `apps/tdr-bot/src/reminders/__tests__/reminder-delivery.service.test.ts`.

### Institutional Learnings

`docs/solutions/` has **no domain-direct entries** (no Discord/Necord/ACP/child-process precedent — tdr-code is the repo's newest app). Three cross-domain analogies inform the hard parts:

- **`docs/solutions/conventions/begin-immediate-for-read-then-write-mutations-2026-05-27.md`** — read-then-write races need a serialization point taken *before* the read. Applied here: the cancel path and the `finally`-drain both touch session/queue state. The resolution is to make the synchronous queue-clear in `cancel()` provably happen-before the drain (see Key Technical Decisions #2) rather than locking — Node's single-threaded loop gives us the ordering for free.
- **`docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`** — centralize lifecycle transitions so multiple callers agree. We get the benefit cheaply by keeping `SessionManagerService` the single owner of "what turn is current" (the turn-id counter), rather than introducing a full FSM (out of scope for a wiring task).
- **`docs/solutions/ui-bugs/drawer-history-marker-repush-on-keystroke-2026-05-30.md`** + **`docs/solutions/conventions/atomicity-tests-must-reach-the-write-phase-2026-06-03.md`** — every resource acquired at turn-start must be released on *every* termination path (complete / error / stop / clear), and race tests must inject the contended event inside the real window (not before it) or they pass vacuously. Both shape U1/U2 test scenarios.

### External References

- **Necord message components** (Context7 `/necordjs/necord.org`): dynamic buttons use `@Button('stop/:channelId/:turnId')` + `@ComponentParam('channelId')` / `@ComponentParam('turnId')` (path-to-regexp matching). Buttons are built with discord.js `ButtonBuilder().setCustomId(...).setLabel(...).setStyle(ButtonStyle.Danger)` inside `ActionRowBuilder<ButtonBuilder>()`. Acknowledge with `interaction.deferUpdate()` or an ephemeral `interaction.reply(...)`. This is the bot's first button — there is no in-repo example.

---

## Key Technical Decisions

1. **New `onPromptStart(channelId, turnId)` callback → dedicated "working" status message.** `executePrompt` calls it once at turn start (before awaiting `connection.prompt`). The Discord surface posts a "🔄 Working…" message carrying the Stop button. Because this message is independent of tool calls, the control appears on **every** turn — including text-only turns (R15) and queued drains (each `executePrompt` = one turn = one `onPromptStart`). Symmetric with `onPromptComplete`, which removes it. Chosen over riding the tool-summary message (the acp-discord reference's approach), which misses text-only turns.

2. **`cancel()` clears the queue synchronously, then sends the ACP cancel — race-free via the single-threaded event loop.** The drain in `executePrompt`'s `finally` only runs *after* the awaited `connection.prompt(...)` promise resolves (a future task). A button click runs a synchronous handler; clearing `session.queue` there completes before any later promise-resolution continuation. The entire `try → onPromptComplete → finally` continuation after the await is synchronous (no interleaving point), so a click either lands before resolution (clear wins, drain sees an empty queue) or after the turn already finished (nothing to drain). **No mutex or FSM is required** — but note that this safety is *emergent, not structural*: it holds **only because there is no `await` between the prompt-await resuming and the `finally`-drain**, which in turn holds only because `onPromptComplete` is synchronous (it fires `void finalizeTurn()` and returns). A future refactor that awaits finalization in the success path (e.g. to order the "⏹ Stopped" edit before the next turn's messages) would open a suspension window and silently reintroduce exactly the race a mutex would have guarded — this is why the institutional learnings reached for a serialization primitive. The override is sound for the code as written; the safety must be protected by the explicit invariants below (C1–C4) and a deliberate, non-vacuous race test (U1), not left implicit. *(Validated by an architecture review of the executePrompt control flow and the ACP SDK resolution path.)*

3. **Turn-id-scoped Stop button: `customId = stop/<channelId>/<turnId>`, validated by `cancel(channelId, turnId)`.** `SessionManagerService` mints a monotonic turn id and surfaces it via `onPromptStart`. `cancel(channelId, turnId)` no-ops unless the session is prompting **and** `turnId` matches the current turn. Rationale: `finalizeTurn`'s button-removal edit is best-effort (`.catch(() => {})` swallows failures, L305), so a stale live button can survive a turn; turn-id scoping makes a late click a safe no-op instead of cancelling a *fresh* turn. It also makes a post-`/clear` button click a no-op (no session). The counter must be **service-global** (a single `private turnCounter` on `SessionManagerService`), **not** a per-session counter that resets on session recreate — otherwise a teardown→recreate cycle reuses low ids and a stale button for the old session's "turn 1" could match the new session's "turn 1" and cancel a fresh turn (invariant C4). `customId` stays well under Discord's 100-char cap (a ~19-digit channel snowflake + a small counter + delimiters); the id is process-local and need not survive restarts (a restart kills all sessions). This resolves the origin's stale-button question in favor of correctness at ~10 lines of cost.

4. **Keep partial output on Stop, marked via the working message.** When `stopReason === 'cancelled'`, the working message is edited to "⏹ Stopped" (button removed) and the streamed partial reply is preserved (sent as final chunks like a normal turn). `stopReason` already arrives at `onPromptComplete` (the cancelled `connection.prompt` resolves with `'cancelled'`); the impl just needs to consume the param it currently drops. Nearly free, better UX than deleting streamed work.

5. **`/clear` = `teardown()` (force-kill) + `resetChannel()` (display reset) + confirmation.** Force-killing mid-turn is safe because no conversation state is persisted (`db/schema.ts` is empty). `teardown` kills the process tree and deletes the session (taking its queue with it); a new `resetChannel(channelId)` on the Discord surface clears `channelStates` (and best-effort strips a live Stop button). `resetChannel` deletes channel state **synchronously**, so the killed process's error-path `onPromptComplete` finds no state and posts no partial output. *Caveat (from review):* `onAgentMessageChunk`/`onToolCall` call `getOrCreateChannelState`, so a **late** ACP event arriving after the wipe would resurrect state and could post orphaned output into the just-cleared channel — defeating the clean wipe. `resetChannel` therefore also sets a short-lived **cleared-channel guard** that makes `getOrCreateChannelState` refuse to resurrect state for a recently-cleared channel (see U4 and Risks). The confirmation reply is **public** (see Decision #8).

6. **Stop preserves the session; `/clear` destroys it.** The two surfaces stay distinct: `cancel()` never tears down; `/clear` always does. (Chosen over making Stop == Clear, which would make the surfaces redundant.)

7. **`/clear` lives in tdr-code's `DiscordModule` as a new `ClearCommandService`**, mirroring tdr-bot's `@SlashCommand`. It is the bot's first slash command; dev-guild registration is already configured, so it registers instantly for testing.

8. **`/clear` confirmation is public, not ephemeral.** Because `/clear` silently discards every participant's queued messages and wipes the session, a public confirmation is the only way other channel members learn why their pending messages were dropped and that context was reset. An ephemeral reply (visible only to the runner) would leave bystanders confused. (Decided during review; was previously deferred.)

---

## Open Questions

### Resolved During Planning

- **How does a control appear on every turn (incl. text-only)?** → New `onPromptStart(channelId, turnId)` callback posts a dedicated working-status message independent of tool calls (Decision #1).
- **Does clearing the queue race the `finally` drain?** → No. A synchronous clear in `cancel()` happens-before the post-await drain continuation on Node's single-threaded loop (Decision #2).
- **How are stale Stop clicks handled?** → Turn-id-scoped `customId` + `cancel(channelId, turnId)` validation; a non-current click no-ops (Decision #3).
- **Is there a tail of ACP events after cancel that finalization must ignore?** → Finalization is driven by the `connection.prompt(...)` resolution (`stopReason: 'cancelled'`). Per the ACP SDK, the agent delivers any final updates and *then* resolves the turn; those tail chunks/tool-updates arrive while channel state still exists and render as legitimate final output, so no separate "ignore tail" mechanism is needed. (Late events *after* `onPromptComplete` deletes state are a pre-existing edge — see Risks.)
- **Can a user Stop the agent while it is still spinning up (process spawn + ACP handshake)?** → No, and this is accepted. The Stop control is only minted at `onPromptStart`, which runs inside `executePrompt` *after* `createSession` resolves; during spin-up the session isn't in the `sessions` map yet, so a Stop would be a no-op regardless. A hung spawn is recoverable via `/clear` (the reliable escape — `teardown` force-kills the process tree). Note the idle timer is reset by the inbound @mention *before* spin-up begins and `createSession` has no timeout, so the idle timer is not a dependable rescue for a stuck `initialize`/`newSession`; treat `/clear` as the primary recovery. Surfaced as an explicit limitation, not a surprise.
- **Should the `/clear` confirmation be public or ephemeral?** → Public (Decision #8) — `/clear` silently drops other participants' queued messages, so a public reply is the only way they learn why and that context was reset.

### Deferred to Implementation

- **Necord two-segment `@ComponentParam` extraction.** Docs confirm `stop/:channelId/:turnId` + two `@ComponentParam` decorators; verify the path-to-regexp match works with a numeric snowflake + numeric turn id during impl (first button in the repo).
- **Happy-path working message: delete vs. edit-to-remove-button.** Cosmetic; both satisfy R7. Lean toward delete on normal completion, edit to "⏹ Stopped" only on cancel.
- **Does `--dangerously-skip-permissions` guarantee the agent never calls `requestPermission`?** [Affects R2/R3] The cancel→`'cancelled'` premise assumes the in-flight `connection.prompt(...)` resolves on cancel. But the ACP SDK requires the *client's* `requestPermission` to return `'cancelled'` when a cancel is in flight, and tdr-code's `acp-client.ts` auto-selects the first option unconditionally — so if the agent is blocked awaiting a permission decision when Stop is clicked, the cancel could be swallowed and the turn proceeds. With `--dangerously-skip-permissions` set, `requestPermission` is *likely* never invoked (making this unreachable), but implementation must **verify** it. If it can still fire, `requestPermission` must observe a per-session cancellation flag (set by `cancel()`) and return `{ outcome: { outcome: 'cancelled' } }` per the SDK MUST-clause.
- **`onPromptStart` send: await vs. fire-and-forget with a `creating` guard.** Lean fire-and-forget mirroring `toolSummaryCreating`, with the post-helper re-checking `channelStates` after `send` so a fast-completing turn never leaves a dangling working message.
- **Observed cancel latency / late-event behavior.** Confirm by manual test that streaming stops promptly after Stop and no orphan state is recreated post-finalize.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Turn lifecycle (per channel):**

```
idle ──@mention/drain──▶ working ──┬─ end_turn/max_tokens ─▶ control removed ─▶ idle (session kept)
   ▲                  (Stop button)  ├─ cancelled (Stop)     ─▶ "⏹ Stopped", partial kept ─▶ idle (session kept)
   │                                 └─ error                ─▶ "⚠ Error" (button removed) + teardown ─▶ idle (session gone)
   └────────────────────────── /clear (any state) ─▶ process tree killed, queue + display wiped ─▶ idle (session gone)
```

**Stop flow (F1), showing the race-free ordering:**

```mermaid
sequenceDiagram
    participant U as Participant
    participant D as Discord
    participant H as DiscordHandlerService
    participant S as SessionManagerService
    participant A as claude (ACP)

    U->>D: @mention
    D->>H: onMessage
    H->>S: prompt(channelId, text, userId)
    activate S
    S->>S: executePrompt — mint turnId, prompting=true
    S->>H: onPromptStart(channelId, turnId)
    H->>D: post "🔄 Working…" + Stop button (stop/<ch>/<turnId>)
    S->>A: connection.prompt(...)
    A-->>H: sessionUpdate (chunks / tool calls)
    U->>D: click Stop
    D->>H: @Button stop/:channelId/:turnId
    H->>S: cancel(channelId, turnId)
    S->>S: validate turnId == current & prompting → clear queue (sync)
    S->>A: connection.cancel({ sessionId })
    H-->>D: deferUpdate (ack)
    A-->>S: connection.prompt(...) resolves stopReason='cancelled'
    S->>H: onPromptComplete(channelId, 'cancelled')
    H->>D: edit working msg → "⏹ Stopped" (button removed); keep partial reply
    S->>S: finally: prompting=false; queue empty → no drain
    deactivate S
```

---

## Stop-Correctness Invariants

These four invariants are what make Decision #2 ("no mutex needed") actually hold. They are emergent properties of the current control flow, not enforced by any type or structure, so the implementer must honor them deliberately and guard them with a short code comment at each load-bearing line. U1 and U2 reference these by id.

- **C1 — No suspension between prompt-resume and the queue drain.** `executePrompt` must not introduce any `await` (or other suspension) between `await connection.prompt(...)` resuming and the `finally`-block drain. `onPromptComplete` must stay synchronous (fire-and-forget async finalization via `void finalizeTurn()`, as today). If finalization is ever awaited in the success path before the drain, a Stop click's `queue.length = 0` can land *after* the drain has already shifted and relaunched the next item — and the queued message runs after Stop. Add a guard-rail comment at the `await connection.prompt(...)` line: *"Do not add `await` before the `finally` drain — Stop-cancel race safety depends on this synchronous span (see plan Decision #2 / C1)."*
- **C2 — `cancel()` is await-free up to the queue clear, with ordered short-circuits.** Evaluate guards in one synchronous block, in order: (1) no session → return false; (2) `!session.prompting` → false; (3) `turnId !== session.currentTurnId` → false; (4) else `session.queue.length = 0`, then `connection.cancel(...)` (fire-and-forget), return true. Because `cancel()` runs synchronously from the discord.js interaction dispatch with no `await` before the clear, all reads and the clear observe one consistent snapshot — nothing can mutate `prompting`/`currentTurnId` mid-call.
- **C3 — Mint the turn id at the top of `executePrompt`, assign before emit.** Set `session.currentTurnId = ++this.turnCounter` and pass *that exact local* to `onPromptStart(channelId, turnId)`, before `await connection.prompt(...)`. Mint inside `executePrompt`, **never** in the public `prompt()` method — queued items bypass `executePrompt` on enqueue and only reach it on drain, so the recursive `finally` relaunch auto-mints a fresh id for the next turn only if minting lives in `executePrompt`.
- **C4 — The turn counter is service-global, not per-session.** A single `private turnCounter` on `SessionManagerService`, incremented per `executePrompt`. This prevents a teardown→recreate cycle from reusing low ids that a stale button could match (see Decision #3).

*Out of scope for this plan — documented as a future option, do NOT implement as part of this work:* a `session.cancelledTurnId` watermark checked by the `finally`-drain could defend C1 even if a future edit violates it (and could also help bound the late-event channel-state resurrection noted in Risks). The C1 guard-rail comment plus the non-vacuous U1 race test already cover the in-scope regression, so this stays a noted option, not a work item — it is not part of the four required invariants above.

---

## Implementation Units

- U1. **Wire Stop into `SessionManagerService`: turn ids, queue-clearing cancel, turn-start signal**

**Goal:** Make the session manager mint a per-turn id, emit a turn-start callback, and turn `cancel()` into a queue-clearing, turn-scoped graceful cancel — the manager-side foundation for both the Stop control and the race-free behavior.

**Requirements:** R2, R3, R4 (and enables R1/R7/R15 via the turn-start signal).

**Dependencies:** None.

**Files:**
- Modify: `apps/tdr-code/src/agent/agent.types.ts` — add `onPromptStart(channelId: string, turnId: number): void` to `AcpEventHandlers`.
- Modify: `apps/tdr-code/src/agent/session-manager.service.ts` — add a **service-global** `private turnCounter` field (C4) and a per-session `currentTurnId` on `ManagedSession`; in `executePrompt`, mint `currentTurnId = ++turnCounter` and call `handlers.onPromptStart(channelId, currentTurnId)` before awaiting `connection.prompt` (C3); change `cancel(channelId, turnId?)` to the ordered, await-free guard (C2) that clears `session.queue` synchronously then `connection.cancel(...)`, returning a boolean; add the C1 guard-rail comment at the `await connection.prompt(...)` line.
- Modify: `apps/tdr-code/src/discord/discord-handler.service.ts` — add a temporary no-op `onPromptStart(): void {}` so the sole implementer satisfies the widened interface and the build stays green (real impl lands in U2).
- Create: `apps/tdr-code/src/__tests__/setup.ts` — first tdr-code test scaffolding; mirror `apps/tdr-bot/src/__tests__/setup.ts` (mock `necord` + `discord.js` decorators).
- Create: `apps/tdr-code/src/__tests__/test-utils.ts` — every unit's test scenarios use a NestJS `createTestingModule` helper + Discord mock factories, which in tdr-bot live in `test-utils.ts` (not `setup.ts`). Mirror tdr-bot's, **trimmed to tdr-code's providers** — tdr-bot's version pulls in services tdr-code doesn't have, so don't copy it wholesale.
- Modify: `apps/tdr-code/jest.config.js` — add `setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts']` (this key does not yet exist in tdr-code's config; copy the line from `apps/tdr-bot/jest.config.js`).
- Create: `apps/tdr-code/src/agent/__tests__/session-manager.service.test.ts`.

**Approach:**
- Turn id is a service-global monotonic counter (C4); each `executePrompt` mints `currentTurnId = ++turnCounter`, assigns it to the session, and passes that exact value to `onPromptStart` *before* the await (C3). Mint inside `executePrompt`, never in the public `prompt()` — the recursive `finally` relaunch then auto-mints a fresh id per drained turn. The manager stays the single owner of "what turn is current."
- `cancel(channelId, turnId?)` follows the C2 ordered, await-free guard: no session → `false`; `!prompting` → `false`; `turnId` given and `!== currentTurnId` → `false`; else `session.queue.length = 0`, `connection.cancel({ sessionId })` (fire-and-forget), `true`. Do **not** teardown (R4).
- The queue clear must be synchronous and precede nothing async — this is what guarantees the `finally`-drain sees an empty queue (Decision #2 / C1). Add the C1 guard-rail comment at the `await connection.prompt(...)` line so a later refactor doesn't insert an `await` before the drain.
- Do **not** add queue-draining that ignores the existing `this.sessions.has(channelId)` guard in the `finally` — on the error/teardown path the session is deleted, so the orphaned queue correctly dies with it.

**Execution note:** Write the cancel-vs-drain race test first and make it non-vacuous — the queued item must be present *and* the in-flight prompt must resolve *after* the cancel, so the test would fail if the synchronous clear were removed (per `atomicity-tests-must-reach-the-write-phase`).

**Patterns to follow:** existing `cancel`/`teardown`/`executePrompt` and `ManagedSession` in `session-manager.service.ts`; tdr-bot test helpers (`createTestingModule`, decorator mocks).

**Test scenarios:**
- Happy path: `executePrompt` calls `handlers.onPromptStart(channelId, turnId)` exactly once, before the prompt resolves, with a fresh id per turn.
- Happy path: a queued drain runs `executePrompt` again and emits a new `onPromptStart` with a new turn id (every turn gets a control — manager side of R15).
- Happy path: `cancel(channelId, matchingTurnId)` clears `session.queue` and calls `connection.cancel({ sessionId })`, returns `true`.
- Edge case: `cancel(channelId, staleTurnId)` (≠ current) → no queue clear, no `connection.cancel`, returns `false`.
- Edge case (C2): `cancel(channelId, turnId)` when the session is not `prompting` → `false` with no side effects (the `!prompting` guard short-circuits before the turn-id check).
- Edge case: `cancel(channelId)` with no session → returns `false`, no throw.
- Edge case (C4): turn ids are monotonic across a teardown→recreate cycle — after a session is torn down and a new one is created, a stale `turnId` from the old session does **not** match the new session's `currentTurnId`, so `cancel(channelId, oldTurnId)` returns `false` and does not cancel the fresh turn.
- Edge case (R4): after a successful `cancel`, `sessions.get(channelId)` still exists and the process is not killed.
- Integration / race (R3, AE1): given a queued item, when `cancel()` clears the queue and the in-flight prompt then resolves, `executePrompt` is **not** re-invoked for the queued item (inject the cancel inside the contended window; assert the drain no-ops).
- Regression: `onPromptComplete` still receives `result.stopReason` on normal completion and `'error'` on throw.

**Verification:** Manager emits a turn id per turn; Stop clears the queue and gracefully cancels without tearing down; the race test fails if the synchronous clear is removed; `type-check`, `lint`, `build:backend` pass. Note: the U1 `onPromptStart` stub is a deliberate no-op — between U1 and U2 no Stop control renders, and the turn-id scoping (Decision #3 / C4) plus R1/R15 are only verifiable end-to-end once U2 (render) and U3 (handler) land. Land U1+U2 together, or mark the stub with a tracked `// TODO(U2)` so the temporary state stays visible; U1's own tests cover only the manager-side behavior.

---

- U2. **Stop control UI: working status message, Stop button, cancelled-aware finalize**

**Goal:** Render the always-present Stop control on a dedicated working-status message at turn start, and finalize turns so the control is removed on every ending — with cancelled turns marked "⏹ Stopped" and partial output preserved.

**Requirements:** R1, R6, R7, R15.

**Dependencies:** U1 (the `onPromptStart` contract + turn id).

**Files:**
- Modify: `apps/tdr-code/src/discord/discord-handler.service.ts` — extend `ChannelState` with `workingMessage`, `workingMessageCreating`, and the current `turnId`; replace the U1 no-op `onPromptStart` with the real impl (post "🔄 Working…" + an `ActionRow` Stop button, `customId = stop/<channelId>/<turnId>`); change `onPromptComplete` to consume `stopReason`; update `finalizeTurn` to handle the working message per ending.
- Modify (optional): `apps/tdr-code/src/agent/message-bridge.ts` — a small `formatWorkingStatus` / status-icon helper if it keeps the handler clean.
- Create: `apps/tdr-code/src/discord/__tests__/discord-handler.service.test.ts`.

**Approach:**
- `onPromptStart`: post a new message (separate from `toolSummaryMessage` and `replyMessage`) with a single `ActionRow<ButtonBuilder>` containing a `ButtonStyle.Danger` "Stop" button. Mirror the `toolSummaryCreating` create-guard; after `send`, re-check `channelStates.has(channelId)` and, if the turn already ended, strip the button / clean up rather than leaving a dangling control.
- Message ordering within a turn: the working status message is posted **first** at turn start and acts as the turn's visual anchor; the streaming reply (`replyMessage`) and the tool-summary message appear below it as they arrive. Keep this order so the Stop button has a stable position. (If `onPromptStart` is fire-and-forget and the first chunk wins the race, the working message may land just after the first reply chunk — acceptable; the post-`send` re-check still prevents a dangling control.)
- `onPromptComplete(channelId, stopReason)`: thread `stopReason` into `finalizeTurn`. **Keep this method synchronous — it must return `void` and fire-and-forget async finalization (`void finalizeTurn(...)`), exactly as today.** This is what lets `executePrompt` (U1) call it without `await`, preserving invariant C1. Do not make `onPromptComplete` something the caller would be tempted to await.
- `finalizeTurn`: remove the Stop control in all cases (R7). On `stopReason === 'cancelled'`, edit the working message to "⏹ Stopped" (button removed) and still emit the buffered partial reply (R6). On normal completion, delete/clear the working message. On `'error'`, edit the working message to "⚠ Error" (button removed) — a human-readable signal before teardown removes the session, not a silent delete.

**Technical design:** *(directional)* working message host is independent of tools, so a text-only turn (no `onToolCall`) still shows a control — closing the gap the tool-summary-only approach would have.

**Patterns to follow:** `updateToolSummaryMessage` create/edit + `toolSummaryCreating` guard; the existing `finalizeTurn` `components: []` strip (L302-307); discord.js `ButtonBuilder` / `ActionRowBuilder` / `ButtonStyle`.

**Test scenarios:**
- Happy path: `onPromptStart` posts a message with one `ActionRow` containing a Stop button whose `customId` encodes `channelId` and `turnId`.
- Happy path (R15, AE4): `onPromptStart` posts the working message even when no `onToolCall` ever fires — assert it exists independently of `toolSummaryMessage`.
- Happy path (R7): `onPromptComplete('end_turn')` removes the Stop control (working message deleted or components stripped).
- Error path (R7): `onPromptComplete('error')` edits the working message to "⚠ Error" with the button removed (not a silent delete).
- Edge case (R6, AE2): `onPromptComplete('cancelled')` edits the working message to "⏹ Stopped" with the button removed, and the buffered partial reply is still sent (not dropped).
- Edge case (race): if `onPromptComplete` fires before the working-message `send` resolves, no dangling working message with a live button remains.
- Integration: `stopReason` flows `executePrompt → onPromptComplete → finalizeTurn` (the dropped param is now consumed).

**Verification:** A Stop button appears at the start of every turn (incl. text-only), disappears on completion/error, and on Stop the partial reply remains with a "⏹ Stopped" marker; `type-check`, `lint`, `build:backend` pass.

---

- U3. **Stop button interaction handler**

**Goal:** Make the Stop button functional — route the click to a graceful, turn-scoped cancel that any participant can trigger.

**Requirements:** R2, R4, R5.

**Dependencies:** U1 (`cancel(channelId, turnId)`), U2 (button rendered + `customId` scheme).

**Files:**
- Create: `apps/tdr-code/src/discord/stop-button.service.ts` — `@Injectable` Necord component service with `@Button('stop/:channelId/:turnId')`, `@ComponentParam('channelId')` + `@ComponentParam('turnId')`, injecting `SessionManagerService`.
- Modify: `apps/tdr-code/src/discord/discord.module.ts` — register `StopButtonService` in `providers`.
- Create: `apps/tdr-code/src/discord/__tests__/stop-button.service.test.ts`.

**Approach:**
- Parse `channelId` + `turnId` from the `customId`, call `sessionManager.cancel(channelId, Number(turnId))`. No permission check — any participant (R5). Acknowledge within Discord's 3s window: `deferUpdate()` on a successful cancel (the working message already updates via `onPromptComplete`), or an ephemeral "That turn already ended." when `cancel` returns `false` (stale/no-op).
- Validate the parsed `customId` before acting: coerce `turnId` and require `Number.isInteger(turnId)` (a `NaN` from a malformed id must be treated as a non-match, never as equal); assert the parsed `channelId` equals `interaction.channelId` and, if not, reply ephemerally and return without calling `cancel` — defends against a button firing from a different channel context than the one its `customId` encodes. These guards keep the C2 turn-id check clean.
- Keep this handler separate from `DiscordHandlerService` (which is the ACP event sink) so interaction routing and ACP rendering stay distinct concerns. Necord discovers any decorated `@Injectable` provider in the module.

**Patterns to follow:** Necord `@Button` / `@ComponentParam` / `ButtonContext` (Context7 docs — see External References); tdr-bot ephemeral reply via `MessageFlags.Ephemeral` (`download-command.service.ts`).

**Test scenarios:**
- Happy path (R2): clicking Stop (`stop/<channelId>/<turnId>`) calls `sessionManager.cancel(channelId, turnId)` and acknowledges the interaction.
- Edge case (customId parsing): `@ComponentParam` extracts `channelId` and `turnId` correctly from the path-to-regexp pattern (numeric snowflake + numeric id).
- Edge case (stale): when `cancel` returns `false`, the handler acks with an ephemeral "already ended" and does not affect any running turn.
- Edge case (channel mismatch): a click whose `customId` channelId ≠ `interaction.channelId` → handler replies ephemerally and does NOT call `cancel`.
- Edge case (malformed turnId): a non-integer `turnId` is treated as a non-match — the current turn is not cancelled.
- Integration (R5, AE5): a different user than the turn starter clicks Stop → `cancel` is invoked with no permission rejection.
- Edge case (ack): the interaction is acknowledged (no "interaction failed" in Discord) even when the cancel is a no-op.

**Verification:** Clicking Stop halts the current turn gracefully; a non-starter can stop it; a stale click is a harmless ephemeral no-op; `type-check`, `lint`, `build:backend` pass.

---

- U4. **`/clear` slash command**

**Goal:** Add the bot's first slash command to force-kill a channel's agent, wipe its queue and display state, and confirm — so the next @mention starts fresh.

**Requirements:** R8, R9, R10, R11, R12, R13, R14.

**Dependencies:** U2 (`resetChannel` cleans the working message added in U2; uses the `channelStates` shape) — **must land after U2**. Uses pre-existing `SessionManagerService.teardown`. Independent of U3.

**Files:**
- Create: `apps/tdr-code/src/discord/clear-command.service.ts` — `@Injectable` with `@SlashCommand({ name: 'clear', description: '...' })`, injecting `SessionManagerService` and `DiscordHandlerService`.
- Modify: `apps/tdr-code/src/discord/discord-handler.service.ts` — add `resetChannel(channelId)` that clears `flushTimer`, best-effort strips a live Stop/working button, deletes the `channelStates` entry, and sets a short-lived cleared-channel guard so a late ACP chunk/tool event cannot resurrect state (see Risks).
- Modify: `apps/tdr-code/src/discord/discord.module.ts` — register `ClearCommandService` in `providers`.
- Create: `apps/tdr-code/src/discord/__tests__/clear-command.service.test.ts`.

**Approach:**
- Handler: `const channelId = interaction.channelId`; `sessionManager.teardown(channelId)` (kills process tree + deletes session + queue; no-op if none); `discordHandler.resetChannel(channelId)` (display wipe); `await interaction.reply('Session cleared — next @mention starts fresh.')` — **public** (Decision #8), so participants whose queued messages were dropped learn why.
- Order matters: `resetChannel` deletes `channelStates` **synchronously**, so when the force-killed process's in-flight prompt rejects (async) and the error-path `onPromptComplete` runs, it finds no state and posts no partial output. The cleared-channel guard `resetChannel` sets also blocks a late ACP chunk from resurrecting state and posting orphaned output (Decision #5 caveat).
- Inject both services directly (leaf consumer; no circular dependency back to the command service). If a cycle nonetheless surfaces at bootstrap, fall back to the in-repo `moduleRef.get(SessionManagerService, { strict: false })` pattern the handler already uses.

**Patterns to follow:** tdr-bot `@SlashCommand` / `SlashCommandContext` (`command.service.ts` `/restart`) and `CommandsModule` registration; `MessageFlags.Ephemeral` if an ephemeral confirmation is preferred.

**Test scenarios:**
- Happy path (AE3 — R9, R11, R12): `/clear` mid-turn calls `teardown(channelId)` (process tree killed, session deleted) and `resetChannel(channelId)`; afterward `sessions` has no entry, so a later prompt creates a brand-new session.
- Happy path (R10): `/clear` removes the `channelStates` entry and clears `flushTimer`; the deleted session takes its queue with it.
- Edge case: `/clear` with no active session still replies with the confirmation and does not throw.
- Edge case (display): after `/clear` mid-turn, the killed process's error-path `onPromptComplete` finds no channel state and posts no partial output.
- Edge case (late event): a late `agent_message_chunk`/`tool_call` arriving after `/clear` does not resurrect `channelStates` or post orphaned output (cleared-channel guard).
- Integration (R13, AE5): a participant who didn't start the turn runs `/clear` successfully (no permission gate).
- Happy path (R14): the command replies with a confirmation message.

**Verification:** `/clear` force-kills the agent, wipes queue + display, replies with a confirmation, and the next @mention spawns a fresh session; any participant can run it; `type-check`, `lint`, `build:backend` pass.

---

## System-Wide Impact

- **Interaction graph:** `onPromptStart` is added to `AcpEventHandlers` — caller (`executePrompt`) and sole implementer (`DiscordHandlerService`) change together (U1 adds the no-op stub; U2 fills it). The new `@Button` handler and `@SlashCommand` enter Necord's interaction routing (first of each in this app).
- **Error propagation:** `/clear` mid-turn → process kill → in-flight prompt rejects → error-path `onPromptComplete` no-ops because `resetChannel` already deleted channel state. Stop's cancel resolves the prompt with `'cancelled'` through the normal success path.
- **State lifecycle risks:** (a) working-message creation race on fast turns — mitigated by a `creating` guard + post-`send` state re-check; (b) queue-clear ordering — guaranteed by the synchronous clear and invariants C1–C4; (c) late ACP events after `onPromptComplete` deletes state can recreate a `ChannelState` via `getOrCreateChannelState` (pre-existing) — see Risks; (d) the spin-up window (`createSession` in flight) has no Stop control by design — recover via `/clear` or idle timer (see Open Questions).
- **API surface parity:** Stop (button) and `/clear` (command) are the two surfaces; both must be reachable by any participant with no permission gate (R5, R13).
- **Unchanged invariants:** the @mention trigger and queue-while-busy behavior are unchanged except that Stop and `/clear` empty the queue; idle-timeout teardown, session eviction, and `killProcessTree` are untouched; the empty `db/schema.ts` stub stays.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| ACP `cancel` doesn't resolve promptly / never returns `'cancelled'` → turn appears stuck with a Stop button. | The session's idle timer still tears it down; `/clear` force-kills as the ultimate escape; verify real cancel latency during impl. |
| Agent blocked on a `requestPermission` call when Stop is clicked → the auto-approving `acp-client.ts` handler ignores the cancel, so the prompt never resolves `'cancelled'` and the turn proceeds (violates R2/R3). | Verify `--dangerously-skip-permissions` means `requestPermission` is never invoked (deferred-to-impl item). If it can still fire, the handler must return `{ outcome: 'cancelled' }` when a per-session cancel flag is set, per the SDK MUST-clause. |
| Widening `AcpEventHandlers` breaks the build between U1 and U2 (sole implementer missing the method). | U1 adds a temporary no-op `onPromptStart` so each unit type-checks; `type-check`/`build:backend` gate every unit. |
| Fast turn completes before the working-message `send` resolves → dangling "🔄 Working…" with a live button. | `workingMessageCreating` guard + post-`send` `channelStates` re-check; turn-id scoping makes the stray button a no-op anyway. |
| First Necord button in the repo — `@Button`/`@ComponentParam` wiring unknowns. | Grounded by Context7 Necord docs (path-to-regexp `stop/:channelId/:turnId`); U3 carries the external-doc reference and an isolated test. |
| Late ACP events after finalize **or `/clear`** recreate channel state via `getOrCreateChannelState` → an orphaned never-finalized message, or partial output posted into a just-cleared channel (breaks Decision #5's clean wipe). | For `/clear`, `resetChannel` sets a short-lived cleared-channel guard (U4) that blocks resurrection. For the normal finalize path it stays low-impact — noted for manual verification; turn-id scoping limits the Stop-path blast radius. |
| A future refactor inserts an `await` before the `finally`-drain (e.g. awaiting finalization to order the "⏹ Stopped" edit) → silently reopens the cancel-vs-drain race (C1 safety is emergent, not structural). | Documented invariants C1–C4 + a guard-rail comment at the `await connection.prompt(...)` line and atop `cancel()`; the non-vacuous U1 race test would catch a regression. (A documented `cancelledTurnId` watermark could further defend C1 even if violated, but is out of scope for this plan.) |

---

## Documentation / Operational Notes

- No env, deploy, or schema changes. Slash command auto-registers to the dev guild via the existing `NecordModule` `development` config; no global-command propagation wait.
- This is the first test suite in tdr-code — U1 establishes `src/__tests__/setup.ts` + `jest.config.js` wiring mirrored from tdr-bot; later units reuse it.
- Capture the Discord/Necord interaction + ACP cancel lifecycle learnings via `/ce-compound` once landed — this is net-new institutional knowledge for the repo (no prior tdr-code/Discord/ACP solutions documented).

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-27-tdr-code-stop-clear-requirements.md](docs/brainstorms/2026-06-27-tdr-code-stop-clear-requirements.md)
- Session lifecycle: `apps/tdr-code/src/agent/session-manager.service.ts`
- Streaming + finalize: `apps/tdr-code/src/discord/discord-handler.service.ts`
- Callback contract: `apps/tdr-code/src/agent/agent.types.ts`
- ACP event mapping: `apps/tdr-code/src/agent/acp-client.ts`
- DI wiring + Necord config: `apps/tdr-code/src/discord/discord.module.ts`, `apps/tdr-code/src/app.module.ts`
- Slash-command pattern: `apps/tdr-bot/src/commands/command.service.ts`, `apps/tdr-bot/src/commands/commands.module.ts`
- Test helpers to mirror: `apps/tdr-bot/src/__tests__/setup.ts`, `apps/tdr-bot/src/__tests__/test-utils.ts`
- Necord message components: Context7 `/necordjs/necord.org` (`@Button`, `@ComponentParam`, `ButtonBuilder`/`ActionRowBuilder`)
