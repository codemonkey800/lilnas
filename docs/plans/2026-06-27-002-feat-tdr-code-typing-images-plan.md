---
title: "feat: tdr-code typing indicator & image support"
type: feat
status: active
date: 2026-06-27
deepened: 2026-06-27
origin: docs/brainstorms/2026-06-27-tdr-code-typing-images-requirements.md
---

# feat: tdr-code typing indicator & image support

## Overview

Add three UX features to `@lilnas/tdr-code` (the per-channel ACP coding-agent Discord bot), each adapted from the proven `~/dev/acp-discord` reference into tdr-code's NestJS/Necord shape:

1. **Discord typing indicator** — the bot shows "Bot is typing…" for the full duration of each agent turn, started the moment an @mention is accepted (covering the long first-turn spawn/init gap), re-fired on Discord's ~8s cadence, and stopped on every turn-end path.
2. **Inbound image support** — a participant can attach image(s) to an @mention; the bot fetches them, base64-encodes them, and sends them to the agent as ACP `image` content blocks alongside any text. Image-only messages become valid.
3. **Outbound image support** — when the agent emits an `image` content block, the bot flushes buffered text first, then posts the image to the channel as a file attachment, preserving order.

This is an adaptation, not a copy-paste: the reference is a flat daemon (`src/daemon/*.ts` with module-scope `Map`s and free functions); tdr-code is a NestJS app with injected services, a typed `AcpEventHandlers` callback contract, and a lazily-built per-channel `ChannelState`.

---

## Problem Frame

Two UX gaps limit tdr-code today (see origin: `docs/brainstorms/2026-06-27-tdr-code-typing-images-requirements.md`):

- **Dead air during work.** Between an @mention and the first streamed output there is no feedback — worst on the *first* turn of a channel, where `SessionManagerService.prompt()` must spawn the `claude` process and run ACP `initialize` + `newSession` before anything happens (`apps/tdr-code/src/agent/session-manager.service.ts`). The only current signal is the "⏳ …queued" reply, and only when a turn is already running.
- **No images, either direction.** Inbound, `onMessage` reads only `message.content` and rejects empty text (`apps/tdr-code/src/discord/discord-handler.service.ts`); the prompt is a single text block. Outbound, the ACP client handles only `content.type === 'text'` (`apps/tdr-code/src/agent/acp-client.ts`) and drops image blocks.

The reference implements all three and is the authority for shapes and lifecycle. The work here is wiring them onto tdr-code's existing seams without disturbing the text path.

---

## Requirements Trace

**Typing indicator**
- R1. While the agent works a turn in a channel, Discord shows the bot's typing indicator there. → U1
- R2. Typing starts as soon as a triggering @mention is accepted — before/while the session spawns and initializes — covering the first-turn gap. → U1
- R3. Typing is sustained for the full turn (re-fired on the ~8s interval) and persists across streamed text and tool-call activity. → U1
- R4. Typing stops when the turn ends — completion, error, or `/clear`/teardown — and on process shutdown. → U1
- R5. Concurrent triggers for the same channel do not create duplicate typing loops (one loop per channel). → U1

**Inbound images (user → agent)**
- R6. A participant can attach one or more images to an @mention; the agent receives them alongside any text. → U2, U3, U4
- R7. An @mention with image(s) and no text is valid; no longer rejected with "Please provide a message." → U4
- R8. Only image attachments are forwarded; non-image attachments are ignored. → U2
- R9. Images above a size cap (default 10 MB) are skipped, not forwarded. → U2
- R10. If an image can't be fetched or is skipped, the turn proceeds with text + remaining images; if nothing usable remains (no text, no usable image), the bot asks for a message or image. → U2, U3, U4
- R11. Forwarded images are sent to the agent as ACP `image` content blocks in the same prompt as the text. → U3
- R12. Queued messages preserve their attached images, so a message that waited behind a running turn still delivers them. → U3

**Outbound images (agent → channel)**
- R13. When the agent emits an `image` content block, the bot posts it to the channel as a file attachment. → U5
- R14. Agent text buffered before an image is flushed first, so the image appears in order. → U5

**Origin actors:** A1 (channel participant — drives the agent via @mentions, may attach images; all participants equal), A2 (tdr-code agent session — the per-channel `claude` ACP process managed by `SessionManagerService`).
**Origin flows:** F1 (liveness feedback while the agent works → U1), F2 (send images to the agent → U2, U3, U4), F3 (receive images from the agent → U5).
**Origin acceptance examples:** AE1 (covers R1, R2 → U1), AE2 (covers R3, R4 → U1), AE3 (covers R6, R7, R11 → U3, U4), AE4 (covers R8, R9 → U2, U4), AE5 (covers R12 → U3), AE6 (covers R13, R14 → U5).

---

## Scope Boundaries

Carried from the origin doc (these are explicit non-goals):

- No `/ask` or any new slash command for image upload — inbound images are via @mention attachments only.
- No DM image handling — the handler targets guild text channels; DMs stay as-is.
- No persistent storage of images — forwarded in memory, never saved.
- No image transformation, resizing, or format conversion — images pass through as-is within the size cap.
- No replacement of the "working…" status message planned in the stop/clear effort — the typing indicator is complementary, not a substitute.
- No per-user or role gating on who can attach images or trigger typing — anyone in the channel.
- No ingestion of non-image files (PDFs, text files, documents, etc.).

### Deferred to Follow-Up Work

- Eliminating the brief typing flicker between back-to-back queued turns by re-arming typing in `onPromptStart` — depends on the stop/clear plan's `onPromptStart` callback landing (`docs/plans/2026-06-27-001-feat-tdr-code-stop-clear-plan.md`). Until then the flicker is accepted (see Key Technical Decisions).

---

## Context & Research

### Relevant Code and Patterns

- **Discord seam — `apps/tdr-code/src/discord/discord-handler.service.ts`:**
  - `onMessage` (`@On(Events.MessageCreate)`) accepts @mentions, strips the mention, **rejects empty text** ("Please provide a message."), resolves `SessionManagerService` via `ModuleRef`, replies "queued" when already prompting, and calls `prompt(channelId, text, authorId)`.
  - `ChannelState` is per-channel display state built lazily in `getOrCreateChannelState`; holds `replyBuffer`, `replyMessage`, `flushTimer`, tool state. Typing must live **separate** from this object because typing starts before the first ACP event creates it.
  - `flushReply(channelId, final)` — with `final=true`, deletes the streaming placeholder, sends the buffer as final chunk(s), resets `replyMessage`/`replyBuffer`. This is the exact primitive the outbound image path needs to flush text before an image (R14).
  - `fetchChannel(channelId): Promise<TextChannel | null>` — cache-first, async fetch fallback. The typing `startTyping` async-gap guard must account for this.
  - The ACP event handlers (`onAgentMessageChunk`, `onToolCall`, `onToolCallUpdate`) are the re-arm points for typing; `onPromptComplete` is the stop point.
- **Inbound injection seam — `apps/tdr-code/src/agent/session-manager.service.ts`:**
  - `prompt(channelId, text, userId)` → `executePrompt` sends `prompt: [{ type: 'text', text }]`. Queue holds `{ text, userId }` and is drained in `executePrompt`'s `finally`.
  - `createSession` spawns `claude`, calls `connection.initialize(...)` (**result currently discarded**), then `newSession`. The discarded result carries `agentCapabilities`.
  - `ManagedSession` is the per-channel record; `OnApplicationShutdown` already implemented here (pattern to mirror for the handler's typing sweep).
- **Outbound seam — `apps/tdr-code/src/agent/acp-client.ts`:** the `agent_message_chunk` case handles only `content.type === 'text'`. Needs an `image` branch calling a new handler.
- **Callback contract — `apps/tdr-code/src/agent/agent.types.ts`:** `AcpEventHandlers` interface. Needs `onAgentMessageImage`. Also home for the shared `ImageAttachment` type.
- **Pure helpers — `apps/tdr-code/src/agent/message-bridge.ts`:** existing pure formatting helpers (`splitMessage`, `formatToolSummary`, `formatDiff`). Right home for a pure `buildPromptBlocks(text, images)` so content-block assembly is unit-testable without spawning `claude`.
- **Intents — `apps/tdr-code/src/app.module.ts`:** `MessageContent` + `GuildMessages` already declared, so attachment metadata is available. No change needed. [verified]

### Reference Implementation (`~/dev/acp-discord`, authoritative)

- **Typing** (`src/daemon/discord-bot.ts`): module-scope `Map<string, NodeJS.Timeout>`; `startTyping` uses a synchronous `has()` guard **plus a placeholder timer** set before the async `fetchChannel` to close the concurrent-start race; `setInterval(8000)` re-fires `channel.sendTyping()`; `stopTyping` clears + deletes; stop is called on `onPromptComplete`, on the prompt-exception path, and in both SIGTERM/SIGINT loops. Start is also re-fired (idempotently) in `onToolCall`/`onToolCallUpdate`/`onAgentMessageChunk` and at @mention time.
- **Inbound** (`src/daemon/session-manager.ts`, `discord-bot.ts`): `ImageAttachment { data, mimeType }`; `extractMessageImages` filters `contentType?.startsWith("image/")`, skips `size > MAX_IMAGE_BYTES` (10 MB), fetches bytes, re-checks `byteLength`, base64-encodes; queue carries `images?`; `prompt(...)` gains an `images?` param; content blocks assembled as `text` block (if any) then one `{ type: "image", data, mimeType }` per image.
- **Outbound** (`src/daemon/acp-client.ts`, `discord-bot.ts`): `agent_message_chunk` adds `else if (content.type === "image")` → `onAgentMessageImage(channelId, data, mimeType)`; handler does `await flushReply(channelId, true)` then `new AttachmentBuilder(Buffer.from(data, "base64"), { name: \`image.\${ext}\` })` and `channel.send({ files: [attachment] })`.
- **Capability:** the reference sends image blocks **unconditionally** — it never checks `promptCapabilities.image` — and works in production against the same `claude` agent over `@agentclientprotocol/sdk@^0.15.0`.

### SDK Shapes — verified against installed `@agentclientprotocol/sdk@0.15.0`

- **Image content block** (`dist/schema/types.gen.d.ts`): `ContentBlock` is a discriminated union; the image variant is `ImageContent & { type: "image" }` where `ImageContent = { data: string; mimeType: string; annotations?; uri?; _meta? }`. So `{ type: 'image', data, mimeType }` type-checks both for the outbound parse and the inbound prompt. [verified]
- **Capability flag**: `InitializeResponse.agentCapabilities?: AgentCapabilities`; `AgentCapabilities.promptCapabilities?: PromptCapabilities`; `PromptCapabilities.image?: boolean`. Read path: `initResult.agentCapabilities?.promptCapabilities?.image`. [verified]
- tdr-code pins the **same** SDK version (`^0.15.0`) as the reference, and `discord.js@^14.25.1` exports `AttachmentBuilder` and `TextChannel.sendTyping(): Promise<void>`. [verified]

### Institutional Learnings

- `docs/solutions/ui-bugs/drawer-history-marker-repush-on-keystroke-2026-05-30.md` — the transferable principle: a side-effecting subscription/timer must be created **once** (keyed, guarded against overwrite without clearing the old handle) and **released on every exit path**, not just the happy one. Directly shapes the typing-loop dedupe (R5) and teardown (R4): centralize stop, never overwrite a live `Map` entry without `clearInterval`, sweep the whole `Map` on shutdown.
- `docs/solutions/conventions/atomicity-tests-must-reach-the-write-phase-2026-06-03.md` — race tests must inject the contended event *inside* the real window or they pass vacuously. Shapes the U1 dedupe/teardown race tests (e.g. fire `stopTyping` after `startTyping` but before `fetchChannel` resolves).
- No prior tdr-code/Discord/ACP learning exists; this is greenfield for the knowledge base. tdr-code has `jest.config.js` + test scripts but **zero test files yet** — these will be the first. Mirror tdr-bot's test infra (`apps/tdr-bot/src/__tests__/setup.ts`, `test-utils.ts`, `Test.createTestingModule`, decorator/Client mocks; `__tests__/*.test.ts` and `*.spec.ts` both match `jest.config.js`) — but **extend the `discord.js` mock, do not copy it verbatim**: tdr-bot's mock omits `IntentsBitField` (imported by `app.module.ts`) and exposes `sendTyping` only on the per-channel factory in `test-utils.ts`. U1's fake-timer race tests must enter the `setInterval(8000)` window correctly so they do not pass vacuously (per the atomicity-tests learning).

### External References

- ACP content/prompt docs: <https://agentclientprotocol.com/protocol/content> (referenced in the SDK type comments).

---

## Key Technical Decisions

- **Typing state keyed by `channelId` in a `Map<string, NodeJS.Timeout>` on `DiscordHandlerService`, separate from `ChannelState`.** Typing must start in `onMessage` before any ACP event lazily builds `ChannelState`, so it cannot live on that object. (see origin)
- **Port the reference's synchronous placeholder-timer guard for dedupe (R5), with an ownership check.** `startTyping` checks `has(channelId)` synchronously, immediately reserves the slot with a throwaway timer captured in a local, then awaits `fetchChannel`; after the await it installs the real interval **only if the slot still holds this call's placeholder** (identity check, not mere existence), and `clearInterval`s any handle it would replace. Existence-only re-checking is insufficient: a `stop`-then-`start` interleave across the await can leave the slot holding a *different* call's handle, and overwriting it without clearing leaks the old interval — the exact overwrite-without-clear the drawer-learning warns against (flagged P2 in review). If the slot no longer holds this call's placeholder, clear the just-created interval and return. Chosen over a naive `has()` check, which races across the async `fetchChannel` gap.
- **Re-arm typing on every agent event (`onAgentMessageChunk`, `onToolCall`, `onToolCallUpdate`); stop only on `onPromptComplete`, the `onMessage` catch, and shutdown.** `startTyping` is idempotent, so re-arming is free and keeps typing alive across long tool sequences (R3).
- **Accept a brief typing flicker between back-to-back queued turns.** `onPromptComplete` stops typing per-turn; the next dequeued turn re-arms on its first agent event, leaving a sub-second gap. The clean fix (re-arm in the stop/clear plan's `onPromptStart`) is deferred to follow-up to avoid coupling to an unmerged plan. (resolves origin deferred question on R3/R4)
- **Stop typing on *every* `onMessage` exit path, not just success.** Typing starts before `await prompt(...)`; if session creation throws (spawn failure, "all sessions busy") there is **no** `onPromptComplete`, so the `onMessage` catch must call `stopTyping` or the loop leaks. The success path needs no explicit stop — `onPromptComplete` already fired inside `executePrompt` before `prompt()` resolves. The `'queued'` return leaves typing running (owned by the active turn). (applies the drawer-learning release-on-every-path principle)
- **Teardown must stop typing explicitly — it does *not* happen transitively.** A force-kill (`killProcessTree` on `/clear`, idle-timeout, or eviction) orphans the in-flight `connection.prompt`: the installed SDK's receive loop closes the stream without rejecting pending responses, so `executePrompt` never resumes and `onPromptComplete` never fires. Therefore `teardown(channelId)`, when it aborts a *prompting* session, must signal the handler to stop typing (and finalize the partial turn) before deleting the session — reusing `onPromptComplete(channelId, 'aborted')`. The `executePrompt` error path already fires `onPromptComplete('error')` before calling `teardown`, so it must mark the turn no-longer-prompting first, ensuring the abort signal fires exactly once. Graceful `cancel()` (Stop) is unaffected — the agent stays alive and resolves the prompt with `'cancelled'`, funneling through `onPromptComplete` normally. The handler's shutdown sweep covers process exit. (resolves origin deferred question on R4; **corrects the original "transitive stop" assumption — this was the wrong mechanism, flagged P1 in review**)
- **Gate inbound images on the agent's `promptCapabilities.image` flag; degrade gracefully when absent.** Capture the `initialize` result, store `imageCapable` on the session, and when it is `false`, skip image blocks rather than send them. Rationale: `executePrompt` tears the session down on *any* prompt error, so sending images to an agent that rejects them would destroy the conversation — and the natural user retry re-sends the image, producing a teardown loop (flagged P1 in review). The downside is asymmetric: if `claude` under-reports image support, gating merely drops images with a user-facing note (benign), whereas sending into a rejection is catastrophic (session loss). The capability is known at session creation, before any prompt, so the gate is reliable. This satisfies the origin's required graceful fallback for R11 and gives the captured flag a real purpose (it is consulted, not just logged). Trade-off weighed: the `acp-discord` reference sends unconditionally and works against the same `claude` — but it lacks tdr-code's teardown-on-error, so the unconditional bet is cheaper there than here. (resolves origin R11 "needs research")
- **Assemble content blocks in a pure `buildPromptBlocks(text, images)` helper in `message-bridge.ts`.** Isolates the riskiest inbound logic (text-block-if-present, then one image block each) so it is unit-testable without spawning `claude` or mocking the ACP connection.
- **Image extraction in a standalone `src/discord/image-attachments.ts` module operating over attachment-like objects.** Keeps the size cap / MIME filter / fetch logic pure and testable by mocking global `fetch`, decoupled from discord.js `Message` plumbing.
- **Silently skip non-image and oversized/failed attachments (log only); surface a message only when nothing usable remains.** Mirrors the reference and preserves a useful text prompt when one attachment is bad. The "nothing usable" guard (no text AND zero usable images) lives in `onMessage` because the handler did the extraction and knows the survivor count. A second "nothing usable" case — an image-only message to an image-incapable agent — is caught in `prompt()` (capability gate) and surfaced via a `'no_image_support'` reply. Cap the number of images per message (`MAX_IMAGES_PER_MESSAGE`, default 4) to bound peak memory, and log attachment `name`/`size` rather than the signed CDN `url`. (resolves origin deferred question on R10)
- **Outbound ordering: `onAgentMessageImage` calls `flushReply(channelId, true)` before posting the image.** tdr-code's `flushReply(final=true)` already deletes the streaming placeholder and sends buffered text as final messages, so the image lands after the text and subsequent chunks start a fresh placeholder (R14). (resolves origin deferred question on R13/R14)

---

## Open Questions

### Resolved During Planning

- **ACP image content-block shape & capability flag (origin: "Needs research").** Verified against installed SDK 0.15.0 — block is `{ type: 'image', data, mimeType }`; capability is `agentCapabilities.promptCapabilities.image`. See Context & Research.
- **Typing dedupe mechanism (origin deferred).** Reference's synchronous placeholder-timer guard, adapted to a `Map<channelId, NodeJS.Timeout>` on the handler. See Key Technical Decisions.
- **Back-to-back queued-turn typing (origin deferred).** Accept brief flicker now; re-arm in `onPromptStart` later. See Scope Boundaries → Deferred.
- **Outbound mid-stream ordering (origin deferred).** `flushReply(true)` before the image; confirmed compatible with tdr-code's `flushReply`/`finalizeTurn`. See U5.
- **Surfacing skipped/failed images (origin deferred).** Silent skip + log; "nothing usable" guard in `onMessage`, plus a capability-gate `'no_image_support'` reply in `prompt()`. See U2/U3/U4.
- **Image capability handling (review P1).** Gate inbound images on `imageCapable`; skip + notify when the agent can't read images, so an image never triggers `executePrompt`'s teardown-on-error. See Key Technical Decisions.

### Deferred to Implementation

- **Runtime value of `promptCapabilities.image` for the pinned `claude` build.** The capability gate makes either value correct: `true` → images flow; `false` → images are skipped with a user note. Observe the logged flag on the first session to confirm `claude` advertises support as expected.
- **Exact discord.js mock shapes for the first tests in tdr-code.** Mirror tdr-bot's `Test.createTestingModule` + Client/Channel mocks; finalized when writing the tests, not in the plan.
- **Whether agent-emitted images can exceed the channel upload cap.** The agent rarely emits images today; the outbound `channel.send` is wrapped in a `.catch` so an oversized attachment fails gracefully rather than crashing the turn. Revisit only if it occurs in practice.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Image round-trip across the existing seams:**

```
INBOUND (A1 → A2)
  Discord message (@mention + attachments)
    └─ onMessage [U1 starts typing here] [U4]
         └─ extractImages(message.attachments) ──────────────► ImageAttachment[]   [U2]
              (filter image/*, skip >10MB, fetch→base64)
         └─ guard: no text && 0 usable images → "provide a message or image"        [U4]
         └─ SessionManagerService.prompt(channelId, text, userId, images)           [U3]
              └─ queue {text,userId,images} if prompting   (R12)                     [U3]
              └─ executePrompt → buildPromptBlocks(text, images)                     [U3]
                   └─ [ {type:'text'}?, {type:'image',data,mimeType}... ]
                   └─ connection.prompt({ sessionId, prompt: blocks })  ───────────► claude

OUTBOUND (A2 → A1)
  claude → session/update { agent_message_chunk, content }
    └─ acp-client: content.type === 'image' ──► onAgentMessageImage(ch,data,mime)    [U5]
         └─ flushReply(ch, true)   (send buffered text first, R14)                   [U5]
         └─ channel.send({ files: [AttachmentBuilder(base64)] })   (R13)             [U5]

TYPING (spans the whole turn)                                                        [U1]
  onMessage ─start→  [spawn/init gap]  ─re-arm on chunk/tool→ … ─onPromptComplete→ stop
                                                              └─ onMessage catch ──→ stop
                                                              └─ shutdown sweep ───→ stop
```

**Implementation unit dependency graph:**

```
U1 (typing)        ── independent ──┐
U2 (type + helper) ── independent ──┤
U3 (session thread) ── needs U2 ────┤
U4 (onMessage wire) ── needs U1,U2,U3
U5 (outbound)      ── independent (shares agent.types.ts + handler edits)
```

Suggested order: U1 and U2 first (independent), then U3, then U4 (integrates U1+U2+U3 in `onMessage`). U5 can land any time.

---

## Implementation Units

- U1. **Discord typing indicator lifecycle on `DiscordHandlerService`**

**Goal:** Show the bot typing for the full duration of each turn, started at @mention time, sustained across streamed text and tool calls, stopped on every end path — with one loop per channel.

**Requirements:** R1, R2, R3, R4, R5 (covers F1, AE1, AE2)

**Dependencies:** None

**Files:**
- Modify: `apps/tdr-code/src/discord/discord-handler.service.ts`
- Modify: `apps/tdr-code/src/agent/session-manager.service.ts` (teardown signals typing-stop when aborting a prompting session)
- Test: `apps/tdr-code/src/discord/__tests__/discord-handler.service.spec.ts`
- Test: `apps/tdr-code/src/agent/__tests__/session-manager.service.spec.ts` (teardown of a prompting session fires the abort signal)

**Approach:**
- Add `private readonly typingIntervals = new Map<string, NodeJS.Timeout>()` and private `startTyping(channelId)` / `stopTyping(channelId)`.
- `startTyping`: synchronous `has()` guard; reserve the slot with a placeholder timer **captured in a local** before awaiting `fetchChannel`; after the await, install the real interval **only if the slot still holds this call's placeholder** (identity check) and the channel resolved — `clearInterval` any handle being replaced; then `channel.sendTyping()` once and `setInterval(() => channel.sendTyping().catch(()=>{}), 8000)`, storing the real handle. If the slot no longer holds this call's placeholder, clear the just-created interval and return. Clean up the map entry if `fetchChannel` returns null/throws.
- `stopTyping`: `clearInterval` + `delete`. Centralize so completion, error, teardown-abort, and shutdown all funnel through it.
- Call `startTyping(channelId)` in `onMessage` immediately before `await prompt(...)` (placed in U4's revised `onMessage`; U1 introduces the methods and the call site). Call `stopTyping(channelId)` in the `onMessage` catch.
- Re-arm (`startTyping`) at the top of `onAgentMessageChunk`, `onToolCall`, `onToolCallUpdate`.
- Stop in `onPromptComplete` (covers normal completion, the `executePrompt` error path, and the teardown-abort signal below).
- **Teardown signal (in `session-manager.service.ts`):** `teardown(channelId)`, when the session is `prompting`, must call `this.handlers.onPromptComplete(channelId, 'aborted')` before `sessions.delete` — a force-killed process orphans the in-flight `connection.prompt`, so without this the handler never learns the turn ended and typing leaks (review P1). Mark the turn no-longer-prompting in the `executePrompt` error path *before* it calls `teardown`, so the abort signal fires exactly once (not doubled with the catch's `onPromptComplete('error')`).
- Implement `OnApplicationShutdown` on the handler: iterate `typingIntervals` and `stopTyping` each (mirror `SessionManagerService.onApplicationShutdown`). Add `OnApplicationShutdown` to the class `implements` list and import from `@nestjs/common`.

**Patterns to follow:** reference `startTyping`/`stopTyping` in `~/dev/acp-discord/src/daemon/discord-bot.ts`; `SessionManagerService.onApplicationShutdown` for the shutdown sweep; existing `fetchChannel` for channel resolution.

**Test scenarios:**
- Covers AE1. Happy path: a first @mention with no existing session calls `startTyping` and fires `sendTyping()` before any agent output (assert `sendTyping` called once synchronously-after-fetch, while the session is still "spawning" — i.e. before any `onAgentMessageChunk`).
- Covers AE2. Happy path: across a turn that emits several `onToolCall`/`onAgentMessageChunk` events then `onPromptComplete`, typing persists (no `clearInterval` mid-turn) and is cleared exactly once at completion.
- Edge case (R3, fake timers): advancing time by 8s with an active loop fires `sendTyping()` again.
- Edge case (R5, dedupe): two near-simultaneous `startTyping(channelId)` calls create exactly one interval (assert one live timer; the placeholder guard prevents a second).
- Edge case (R5, async-gap race): `startTyping` then `stopTyping` before `fetchChannel` resolves leaves zero live intervals (no orphaned interval armed after the await).
- Edge case (R5, ownership leak): a `start → stop → start` interleave across the `fetchChannel` await leaves exactly one live interval — the first call must not overwrite the second's handle without clearing it.
- Error path (R4): when `prompt()` rejects (session-busy / spawn error) the `onMessage` catch calls `stopTyping`; assert zero live intervals afterward.
- Error path (R4): `onPromptComplete(channelId, 'error')` and `onPromptComplete(channelId, 'cancelled')` both stop typing.
- Error path (R4, orphaned prompt): tearing down a *prompting* session (idle-timeout / eviction / `/clear`) stops typing — assert `teardown` fires `onPromptComplete(channelId, 'aborted')` and zero intervals remain, since the in-flight prompt never settles on its own.
- Edge case (R4, shutdown): with N active channel loops, `onApplicationShutdown()` clears all N and empties the map.
- Edge case (leak regression): a multi-chunk turn does not grow the live-interval count beyond one per channel.

**Verification:** During a real turn the channel shows "Bot is typing…" from @mention through completion; it disappears at turn end; no interval survives an error, a `/clear`, or shutdown.

---

- U2. **`ImageAttachment` type + inbound image extraction helper**

**Goal:** Turn a Discord message's attachments into a list of fetched, base64-encoded images, enforcing the image-only filter and the 10 MB cap, skipping anything unusable.

**Requirements:** R6 (partial), R8, R9, R10 (skip half) (covers F2, AE4)

**Dependencies:** None

**Files:**
- Modify: `apps/tdr-code/src/agent/agent.types.ts` (add `ImageAttachment`)
- Create: `apps/tdr-code/src/discord/image-attachments.ts`
- Test: `apps/tdr-code/src/discord/__tests__/image-attachments.spec.ts`

**Approach:**
- Add `export interface ImageAttachment { data: string; mimeType: string }` to `agent.types.ts` (shared agent contract — also consumed by U3).
- `image-attachments.ts` exports `MAX_IMAGE_BYTES = 10 * 1024 * 1024`, `MAX_IMAGES_PER_MESSAGE = 4`, and `async function extractImages(attachments: Iterable<{ contentType: string | null; size: number; url: string; name: string }>): Promise<ImageAttachment[]>`.
- **Cap the image count at `MAX_IMAGES_PER_MESSAGE` before fetching.** Discord allows up to 10 attachments; without a count cap, 10 × 10 MB → ~133 MB of base64 held at once on the long-running bot, triggerable by any participant (no per-user gating, by design — review P2). Take only the first `MAX_IMAGES_PER_MESSAGE` image attachments; log how many were dropped.
- For each kept attachment: skip unless `contentType?.startsWith('image/')` (R8); skip if `size > MAX_IMAGE_BYTES` before fetching (R9); `fetch(url)`, skip if `!res.ok`; `Buffer.from(await res.arrayBuffer())`, re-check `byteLength > MAX_IMAGE_BYTES` (defends against a lying `size`); push `{ data: buf.toString('base64'), mimeType: contentType }`. Wrap each fetch in try/catch and log+skip on error (R10). Accepting an `Iterable` of attachment-like objects (not a discord.js `Message`) keeps the unit testable; the handler passes `message.attachments.values()` in U4.
- Use `fetch` (global in the Node runtime). Log skips with the same console-based approach used in `session-manager.service.ts` — log the attachment `name` and `size`, **never the full `url`** (Discord CDN URLs carry signed access tokens in their query string that would otherwise land in persisted logs).

**Patterns to follow:** reference `extractMessageImages` + `fetchImage` in `~/dev/acp-discord/src/daemon/discord-bot.ts`.

**Test scenarios:**
- Happy path: a single `image/png` attachment under the cap yields one `{ data: <base64>, mimeType: 'image/png' }` (mock `fetch` to return known bytes; assert base64 round-trips).
- Edge case (R8): a `text/plain` / `application/pdf` / `contentType: null` attachment is skipped (returns `[]`).
- Edge case (R9): an attachment with `size` above the cap is skipped without `fetch` being called.
- Edge case (R9): an attachment whose reported `size` is under cap but whose fetched `byteLength` exceeds it is skipped post-fetch.
- Error path (R10): `fetch` resolving `!ok` (404) → skipped; `fetch` throwing → skipped; neither aborts processing of other attachments.
- Covers AE4. Edge case: a mix of one 20 MB image + one `.txt` returns `[]` (both skipped), proving the text-only fallback in U4.
- Happy path: two valid images return both, order preserved; empty input returns `[]`.
- Edge case (count cap): more than `MAX_IMAGES_PER_MESSAGE` images returns only the first `MAX_IMAGES_PER_MESSAGE` and logs the dropped count.

**Verification:** `extractImages` returns exactly the usable images for any attachment mix, never throws, and never returns a non-image or oversized entry.

---

- U3. **Thread images through `SessionManagerService.prompt` / queue / content blocks**

**Goal:** Carry images from `prompt()` into the ACP prompt as `image` content blocks, preserve them across queueing, and gate them on the agent's image capability so an unsupported image never tears the session down.

**Requirements:** R6 (partial), R10 (capability fallback), R11, R12 (covers AE3 block-assembly, AE5)

**Dependencies:** U2 (`ImageAttachment`)

**Files:**
- Modify: `apps/tdr-code/src/agent/session-manager.service.ts`
- Modify: `apps/tdr-code/src/agent/message-bridge.ts` (add `buildPromptBlocks`)
- Test: `apps/tdr-code/src/agent/__tests__/message-bridge.spec.ts`

**Approach:**
- Add a pure `buildPromptBlocks(text: string, images: ImageAttachment[]): ContentBlock[]` to `message-bridge.ts`: declare `const blocks: ContentBlock[] = []`, push a `{ type: 'text', text }` block only when `text` is non-empty, then one `{ type: 'image', data, mimeType }` per image, and return `blocks`. (Declaring the accumulator as `ContentBlock[]` preserves the union discriminant so `connection.prompt({ prompt: blocks })` type-checks — a bare inferred-literal array widens `type` to `string`.) Import `ContentBlock` from `@agentclientprotocol/sdk` and `ImageAttachment` from `agent.types`.
- In `createSession`, capture the initialize result: `const initResult = await connection.initialize(...)`; store `imageCapable: initResult.agentCapabilities?.promptCapabilities?.image ?? false` on `ManagedSession` and log it once at creation. Add `imageCapable: boolean` to the `ManagedSession` interface.
- `prompt(channelId, text, userId, images: ImageAttachment[] = [])`: after `getOrCreate`, **gate on capability** — `const usableImages = session.imageCapable ? images : []`; if images were supplied but dropped, log it. If `!text && usableImages.length === 0` (image-only message to an image-incapable agent), return the sentinel `'no_image_support'` so the handler (U4) can tell the user — check this *before* the prompting/queue branch so it also covers the queued path. Otherwise thread `usableImages` into the queue push (`{ text, userId, images: usableImages }`) and into `executePrompt`.
- Widen the queue type to `Array<{ text: string; userId: string; images: ImageAttachment[] }>` and the dequeue call in the `finally` to pass `next.images`.
- `executePrompt(session, text, userId, images)`: replace the hardcoded `prompt: [{ type: 'text', text }]` with `prompt: buildPromptBlocks(text, images)`. Because the capability gate runs in `prompt()` before enqueue, `buildPromptBlocks` never receives an empty `text` + empty `images` pair.

**Patterns to follow:** reference `prompt(...)` signature + content-block assembly in `~/dev/acp-discord/src/daemon/session-manager.ts`; existing `executePrompt`/queue/`ManagedSession` in `session-manager.service.ts`.

**Test scenarios (all against the pure `buildPromptBlocks`):**
- Happy path (regression, R11): text only → `[{ type: 'text', text }]` (unchanged from today).
- Covers AE3. Happy path (R11): empty text + one image (capable session) → `[{ type: 'image', data, mimeType }]`.
- Happy path (R11): text + two images → `[text, image, image]` in that order.
- Edge case: empty text + empty images → `[]` (the `prompt()` capability gate and the U4 `onMessage` guard ensure this never reaches `executePrompt`; documented here as the boundary).
- Edge case (R10, capability gate): with `imageCapable = false`, `prompt(text + images)` drops the images (text turn proceeds, blocks carry no image), and `prompt(images-only)` returns `'no_image_support'` without enqueueing or sending.
- Integration (R12): a focused session-manager test asserting that a `prompt()` made while `prompting` enqueues `{ text, userId, images }` with images intact, and that draining the queue forwards those images to `executePrompt` (mock the connection's `prompt` to capture the blocks). If full session mocking proves heavy, assert R12 at the queue-shape level and rely on `buildPromptBlocks` tests for block correctness.

**Verification:** A text+image prompt reaches `connection.prompt` as text + image blocks; a queued image message delivers its images when it runs; the capability flag is logged at session creation.

---

- U4. **Wire inbound images into `onMessage` and relax the empty-text guard**

**Goal:** Extract images on @mention, allow image-only messages, forward text + images to the session, and ask for input only when nothing usable was provided.

**Requirements:** R6, R7, R10 (guard half) (covers F2, AE3, AE4)

**Dependencies:** U1 (typing call site in `onMessage`), U2 (`extractImages`), U3 (`prompt` images param)

**Files:**
- Modify: `apps/tdr-code/src/discord/discord-handler.service.ts`
- Test: `apps/tdr-code/src/discord/__tests__/discord-handler.service.spec.ts` (same file as U1)

**Approach:**
- In `onMessage`, after stripping the mention text, call `const images = await extractImages(message.attachments.values())`.
- Replace the `if (!text)` rejection with `if (!text && images.length === 0) { await message.reply('Please provide a message or image.'); return }` (R7, R10).
- Keep the existing "queued" reply and `ModuleRef` resolution. Start typing (U1) before `prompt`. Call `sessionManager.prompt(channelId, text, message.author.id, images)`.
- If `prompt` returns the `'no_image_support'` sentinel (U3 — image-only message to an image-incapable agent), reply with a brief note (e.g. "This agent can't read images, and no text was provided.") and stop typing (no turn ran).
- Leave the existing catch (busy/error replies) intact; U1 adds the `stopTyping` call inside it.

**Patterns to follow:** existing `onMessage` structure; reference `~/dev/acp-discord/src/daemon/discord-bot.ts` mention handler.

**Test scenarios:**
- Covers AE3. Happy path (R6, R7): an @mention with an image and **no text** is accepted (not rejected) and calls `prompt` with `text === ''` and one image.
- Happy path (R6): @mention with text + image calls `prompt` with both.
- Edge case (R7/R10): @mention with neither usable text nor images replies "Please provide a message or image." and does **not** call `prompt`.
- Covers AE4. Edge case (R10): @mention "fix this" + a 20 MB image + a `.txt` → `extractImages` returns `[]`, `prompt` is called with the text and an empty image list (turn proceeds on text alone).
- Edge case (R10, capability fallback): when `prompt` returns `'no_image_support'`, the user gets the images-unsupported note and typing is stopped.
- Integration: typing is started before `prompt` is awaited (assert ordering against the U1 `startTyping`).

**Verification:** Users can drive the agent with image-only, text-only, or text+image @mentions; a junk-only message is gently rejected; a bad attachment never costs the text prompt.

---

- U5. **Outbound image content blocks → channel file attachments**

**Goal:** When the agent emits an `image` content block, post it to the channel as a file attachment after flushing any buffered text.

**Requirements:** R13, R14 (covers F3, AE6)

**Dependencies:** None (shares the `agent.types.ts` edit with other units; can land independently)

**Files:**
- Modify: `apps/tdr-code/src/agent/agent.types.ts` (add `onAgentMessageImage` to `AcpEventHandlers`)
- Modify: `apps/tdr-code/src/agent/acp-client.ts` (image branch)
- Modify: `apps/tdr-code/src/discord/discord-handler.service.ts` (implement handler)
- Test: `apps/tdr-code/src/discord/__tests__/discord-handler.service.spec.ts`; optionally `apps/tdr-code/src/agent/__tests__/acp-client.spec.ts`

**Approach:**
- Add `onAgentMessageImage(channelId: string, data: string, mimeType: string): void` to the `AcpEventHandlers` interface.
- In `acp-client.ts`'s `agent_message_chunk` case, add `else if (update.content.type === 'image') { handlers.onAgentMessageImage(channelId, update.content.data, update.content.mimeType) }`.
- Implement `onAgentMessageImage` on `DiscordHandlerService`: `await this.flushReply(channelId, true)` (sends buffered text first, R14); resolve the channel via `fetchChannel` and **null-guard it** (it returns `TextChannel | null`, and `onAgentMessageImage` is `void`/fire-and-forget, so a null must be handled, not thrown past the trailing `.catch` — mirror every other `fetchChannel` call site); derive `ext = mimeType.split('/')[1] ?? 'png'`; build `new AttachmentBuilder(Buffer.from(data, 'base64'), { name: \`image.\${ext}\` })`; `await channel.send({ files: [attachment] }).catch(() => {})` (graceful on oversized/upload failure). Import `AttachmentBuilder` from `discord.js`.
- **Land all three edits in a single commit.** `DiscordHandlerService` is the sole implementer of `AcpEventHandlers`, so committing the interface widening + `acp-client.ts` branch without the handler impl produces a TS2420 ("class incorrectly implements interface") on an intermediate build.

**Patterns to follow:** reference `onAgentMessageImage` in `~/dev/acp-discord/src/daemon/discord-bot.ts`; existing `flushReply`/`fetchChannel` and the text branch in `acp-client.ts`.

**Test scenarios:**
- Happy path (R13): `acp-client` receiving an `agent_message_chunk` with `content.type === 'image'` calls `onAgentMessageImage` with the right `data`/`mimeType`; a `text` chunk still calls `onAgentMessageChunk` (regression).
- Covers AE6. Integration (R14): with buffered reply text present, `onAgentMessageImage` calls `flushReply(channelId, true)` **before** `channel.send({ files })` (assert call order — text message sent first, image second).
- Happy path: file extension derived from mimeType (`image/jpeg` → `image.jpeg`; unknown/odd mimeType → `image.png`).
- Error path: `channel.send` rejecting (e.g. oversized) is caught and does not throw out of the handler.
- Edge case: a non-image, non-text content type in `agent_message_chunk` is ignored (no handler call), as today.

**Verification:** When the agent emits an image, the channel shows preceding text first, then the image as a file attachment, and a send failure degrades quietly.

---

## System-Wide Impact

- **Interaction graph:** All three features hang off existing seams — `onMessage` (typing start + image extraction), the ACP event handlers `onAgentMessageChunk`/`onToolCall`/`onToolCallUpdate` (typing re-arm), `onAgentMessageImage` (new; flush + post), `onPromptComplete` (typing stop), and `OnApplicationShutdown` (typing sweep). `executePrompt`/queue carry images.
- **Error propagation:** A `prompt` throw → `onPromptComplete('error')` → typing stop + finalize; a force-kill `teardown` of a *prompting* session → `onPromptComplete('aborted')` → typing stop (the orphaned prompt never settles on its own); the `onMessage` catch independently stops typing for pre-turn failures. Image fetch failures are swallowed (logged) and never abort a turn. Inbound images are gated on capability so they never trigger a prompt-rejection teardown. Outbound `channel.send` failures are caught.
- **State lifecycle risks:** The typing `Map` is the new long-lived resource — it must be released on completion, error, force-kill teardown, and shutdown (drawer learning). It is intentionally *not* on `ChannelState` (which is deleted in `onPromptComplete`), so it has its own sweep and its own ownership-checked dedupe (overwrite-without-clear would leak). In-memory base64 images are bounded by both the 10 MB per-image cap and the `MAX_IMAGES_PER_MESSAGE` count cap, and never persisted.
- **API surface parity:** `AcpEventHandlers` gains `onAgentMessageImage` — `acp-client.ts` must call it and `DiscordHandlerService` must implement it (TypeScript enforces the latter); the three edits land in one commit. `prompt()` gains a 4th param and a `'no_image_support'` return; its sole call site in `onMessage` is updated. The queue record gains `images`.
- **Integration coverage:** Block assembly is unit-tested via `buildPromptBlocks`; typing leak/lifecycle and outbound ordering are tested at the handler level (mocks alone wouldn't prove ordering or interval cleanup).
- **Unchanged invariants:** The text-only prompt path is byte-for-byte equivalent (`buildPromptBlocks('hi', [])` → `[{type:'text',text:'hi'}]`). Tool-call/diff handling, idle timer, session eviction, and `killProcessTree` are untouched. DM behavior is unchanged.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Typing interval leak (loop survives an error, a force-kill teardown, shutdown, or an overwrite-without-clear). | Centralized `stopTyping`; stop on `onPromptComplete`, the `onMessage` catch, the `OnApplicationShutdown` sweep, **and an explicit `teardown`→`onPromptComplete('aborted')` signal for force-kill paths where the orphaned prompt never settles**; ownership-checked placeholder dedupe (identity, not existence); explicit leak/teardown/interleave tests (drawer learning). |
| **Merge coordination with the active stop/clear plan** (`docs/plans/2026-06-27-001`, unmerged). This is a **line-level** conflict, not a clean append: both plans rewrite the *same* `executePrompt` body, the `prompt()` signature, the queue record shape, `ChannelState`, and `onPromptComplete`. | The behaviors are orthogonal, but the rebaser must hand-merge those specific spans. Critically, the combined `executePrompt` must stay synchronous between the `await connection.prompt` resume and the queue drain (stop/clear's C1 invariant) — `buildPromptBlocks` is synchronous so image-threading does not break C1, but the rebaser must confirm it. Whichever lands first, the second rebases. |
| `claude` rejects image blocks (or reports `image:false`), and `executePrompt`'s teardown-on-any-error destroys the session on every image message (teardown loop). | Gate inbound images on `imageCapable` (Key Technical Decisions): never send images the agent can't accept; degrade with a `'no_image_support'` user note instead. |
| Unbounded image count per message exhausts memory (10 × 10 MB → ~133 MB base64). | `MAX_IMAGES_PER_MESSAGE` cap (default 4) in `image-attachments.ts`, applied before fetching; dropped count logged. |
| Agent-emitted image exceeds the Discord upload cap. | Outbound `channel.send` wrapped in `.catch`; failure degrades quietly. Rare with the current agent. |
| Brief typing flicker between back-to-back queued turns. | Accepted; clean fix (re-arm in `onPromptStart`) deferred to follow-up once stop/clear lands. |
| First tests in tdr-code — no existing test scaffolding in the app. | Mirror tdr-bot's `__tests__` setup (`Test.createTestingModule`, Client/Channel mocks, fake timers). `jest.config.js` already present and configured. |

---

## Documentation / Operational Notes

- No new env vars, deploy, or infra changes — purely in-process behavior on the existing tdr-code service.
- After landing, run `/ce-compound` to capture two first-of-their-kind learnings for the knowledge base: per-channel timer lifecycle in a long-running Necord bot, and the ACP image content-block round-trip.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-06-27-tdr-code-typing-images-requirements.md](docs/brainstorms/2026-06-27-tdr-code-typing-images-requirements.md)
- **Reference implementation:** `~/dev/acp-discord` — `src/daemon/discord-bot.ts` (typing, image extraction, outbound handler), `src/daemon/session-manager.ts` (prompt/queue/blocks), `src/daemon/acp-client.ts` (image branch).
- **Sibling plan (coordination):** `docs/plans/2026-06-27-001-feat-tdr-code-stop-clear-plan.md`
- **SDK types:** `apps/tdr-code/node_modules/@agentclientprotocol/sdk/dist/schema/types.gen.d.ts` (`ContentBlock`, `ImageContent`, `InitializeResponse`, `PromptCapabilities`).
- **Learnings:** `docs/solutions/ui-bugs/drawer-history-marker-repush-on-keystroke-2026-05-30.md`, `docs/solutions/conventions/atomicity-tests-must-reach-the-write-phase-2026-06-03.md`
- **Touched files:** `apps/tdr-code/src/discord/discord-handler.service.ts`, `apps/tdr-code/src/discord/image-attachments.ts` (new), `apps/tdr-code/src/agent/session-manager.service.ts`, `apps/tdr-code/src/agent/message-bridge.ts`, `apps/tdr-code/src/agent/acp-client.ts`, `apps/tdr-code/src/agent/agent.types.ts`
