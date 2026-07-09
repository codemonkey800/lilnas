---
date: 2026-06-27
topic: tdr-code-typing-images
---

# tdr-code Typing Indicator & Image Support

## Problem Frame

`@lilnas/tdr-code` is a Discord bot that runs an ACP-driven coding agent (`claude`) per channel, driven by @mentions. Two UX gaps limit it today:

- **No liveness feedback during work.** Between an @mention and the first streamed output there is pure dead air — worst on the *first* turn of a channel, where `prompt()` must spawn the `claude` process and run ACP `initialize` + `newSession` before anything happens (`apps/tdr-code/src/agent/session-manager.service.ts:53-68`, `163-228`). The only current signal is the "⏳ …queued" reply (and only when a turn is already running).
- **No image support, either direction.** Inbound, `onMessage` reads only `message.content` and ignores `message.attachments` (`apps/tdr-code/src/discord/discord-handler.service.ts:120`); the prompt is a single text block (`apps/tdr-code/src/agent/session-manager.service.ts:103-106`). Outbound, the ACP client only handles text chunks (`apps/tdr-code/src/agent/acp-client.ts:30-34`) — image content blocks are dropped.

This work adds a **Discord typing indicator** for the duration of each turn, **inbound image support** (attach images to an @mention; the agent receives them), and **outbound image support** (agent-emitted images are posted to the channel). The `acp-discord` project (`~/dev/acp-discord`) already implements all three and is the reference; this is an adaptation to tdr-code's NestJS/Necord shape, not a copy-paste.

---

## Actors

- A1. **Channel participant** — any human in a channel where the bot is active. Drives the agent via @mentions, optionally attaching images.
- A2. **tdr-code agent session** — the per-channel `claude` ACP process managed by `SessionManagerService`. Receives text + image prompt blocks, streams output, and may emit image content blocks.

---

## Key Flows

- F1. **Liveness feedback while the agent works**
  - **Trigger:** A1 @mentions the bot.
  - **Actors:** A1, A2
  - **Steps:** The @mention is accepted → the bot starts Discord typing immediately (covering the spawn/init delay on a first turn) → typing re-fires on the interval Discord requires and persists across streamed text and tool calls → typing stops when the turn ends.
  - **Outcome:** The channel shows "Bot is typing…" during otherwise-silent work instead of dead air.
  - **Covered by:** R1, R2, R3, R4, R5

- F2. **Send images to the agent (inbound)**
  - **Trigger:** A1 @mentions the bot with one or more image attachments, with or without text.
  - **Actors:** A1, A2
  - **Steps:** Handler extracts attachments → keeps images, enforces the size cap, fetches bytes as base64 → builds an ACP prompt with a text block (if any) plus one image block per image → agent receives them.
  - **Outcome:** The agent can "see" attached images as part of the prompt (e.g. a bug screenshot or UI mockup).
  - **Covered by:** R6, R7, R8, R9, R10, R11, R12

- F3. **Receive images from the agent (outbound)**
  - **Trigger:** A2 emits an image content block during a turn.
  - **Actors:** A2, A1
  - **Steps:** ACP client maps the image block → handler flushes any buffered text first → posts the image to the channel as a file attachment.
  - **Outcome:** Agent-produced images appear inline, in order with surrounding text.
  - **Covered by:** R13, R14

---

## Requirements

**Typing indicator**
- R1. While the agent is working a turn in a channel, Discord shows the bot's typing indicator in that channel.
- R2. Typing starts as soon as a triggering @mention is accepted — before/while the session is spawned and initialized — so the first-turn spawn/init gap is covered, not just the post-first-output window.
- R3. Typing is sustained for the full turn (re-fired on the ~8s interval Discord's indicator requires) and persists across streamed text and tool-call activity.
- R4. Typing stops when the turn ends — by completion, error, or `/clear`/teardown — and on process shutdown.
- R5. Concurrent triggers for the same channel do not create duplicate typing loops (one typing loop per channel).

**Image support — inbound (user → agent)**
- R6. A participant can attach one or more images to an @mention; the agent receives them alongside any text.
- R7. An @mention with image(s) and no text is valid and is no longer rejected with "Please provide a message."
- R8. Only image attachments are forwarded; non-image attachments are ignored.
- R9. Images above a size cap (default 10 MB) are skipped rather than forwarded.
- R10. If an image cannot be fetched or is skipped, the turn still proceeds with the text and any remaining images; if nothing usable remains (no text and no usable image), the bot asks for a message or image.
- R11. Forwarded images are sent to the agent as ACP image content blocks in the same prompt as the text.
- R12. Queued messages preserve their attached images, so a message that waited behind a running turn still delivers its images when it runs.

**Image support — outbound (agent → channel)**
- R13. When the agent emits an image content block, the bot posts it to the channel as a file attachment.
- R14. Agent text buffered before an image is flushed first, so the image appears in order relative to surrounding text.

---

## Acceptance Examples

- AE1. **Covers R1, R2.** Given a channel with no active session, when a user sends the first @mention, then the typing indicator appears during the spawn/init delay, before any output is produced.
- AE2. **Covers R3, R4.** Given a long turn that calls several tools, when it runs, then typing persists throughout and disappears once the turn finishes.
- AE3. **Covers R6, R7, R11.** Given a user @mentions the bot with a screenshot and no text, then the agent receives the image as prompt content and can respond about it.
- AE4. **Covers R8, R9.** Given an @mention with a 20 MB image and a `.txt` file plus the text "fix this", when it runs, then both attachments are skipped and the turn proceeds on the text alone.
- AE5. **Covers R12.** Given an image message is queued behind a running turn, when that turn finishes and the queued message runs, then its image is still delivered to the agent.
- AE6. **Covers R13, R14.** Given the agent emits some text and then an image, then the channel shows the text first and the image after it, in order.

---

## Success Criteria

- During any turn, the channel visibly indicates the agent is working — including the first-turn spawn gap that produces the longest silence today.
- A user can drive the agent with images (e.g. "fix this UI" + a screenshot), with text only, or with both.
- Agent-produced images render inline in the channel, in order with surrounding text.
- A downstream implementer can wire all three features onto existing seams: `onMessage` → image extraction → `prompt(…, images)`; content-block assembly in `executePrompt`; an `onAgentMessageImage` handler plus an image branch in the ACP client; and a per-channel typing loop started in `onMessage`.

---

## Scope Boundaries

- No `/ask` or any new slash command for image upload — inbound images are via @mention attachments only. (`/clear` is the separate stop/clear effort.)
- No DM image handling — the handler targets guild text channels; DMs stay as-is.
- No persistent storage of images — they are forwarded in memory, not saved.
- No image transformation, resizing, or format conversion — images pass through as-is within the size cap.
- No replacement of the "working…" status message planned in the stop/clear brainstorm — the typing indicator is complementary, not a substitute.
- No per-user or role gating on who can attach images or trigger typing — anyone in the channel (consistent with the stop/clear decision).
- No ingestion of non-image files (PDFs, text files, documents, etc.).

---

## Key Decisions

- **Both directions for images (round-trip).** Outbound is only a few lines and gives parity with the reference plus future-proofing, even though the `claude` agent rarely emits image content blocks today. (Chose this over inbound-only after weighing that the outbound path may seldom fire with the current agent.) [user-decided]
- **Inbound via @mention attachments only.** tdr-code has no slash commands and adding `/ask` is unnecessary scope; Discord already allows attachments on @mention messages.
- **10 MB size cap; silently skip non-image and oversized attachments.** Mirrors the reference and bounds memory and agent token usage. (Chose silent skip over rejecting the whole message, so a useful text prompt isn't lost to one bad attachment.)
- **Image-only messages are valid.** The empty-text guard (`discord-handler.service.ts:121-124`) must be relaxed, since "here's a screenshot" with no text is a primary use case.
- **Native Discord typing indicator, started at @mention time, complementary to the planned status message.** Native typing appears instantly with no post latency and no channel clutter — it covers the pre-first-output gap that a posted "working…" message cannot. The reference keeps both surfaces.
- **Typing lifecycle keyed by channelId on the handler service, separate from `ChannelState`.** Typing must start in `onMessage`, before any ACP event creates the lazily-built `ChannelState` (`discord-handler.service.ts:155-170`), so it cannot live on that object.

---

## Dependencies / Assumptions

- **Required intents are already present** [verified]: `app.module.ts:35-41` declares `MessageContent` and `GuildMessages`, so message text and attachment metadata are available.
- **The inbound injection seam is `SessionManagerService.prompt()`** [verified]: today `(channelId, text, userId)` (`apps/tdr-code/src/agent/session-manager.service.ts:53`) → `executePrompt` sends `prompt: [{ type: 'text', text }]` (`session-manager.service.ts:103-106`). Both need an `images` parameter and content-block assembly, exactly as the reference does (`~/dev/acp-discord/src/daemon/session-manager.ts:125-156`).
- **The queue must carry images** [verified]: it currently holds `{ text, userId }` (`session-manager.service.ts:26`); it must also hold `images` so queued image messages survive the wait (reference: `session-manager.ts:33`).
- **The outbound seam is the ACP client's `agent_message_chunk` case** [verified]: `apps/tdr-code/src/agent/acp-client.ts:30-34` handles only `content.type === 'text'`. It needs an `image` branch (reference: `acp-client.ts:65-67`), plus a new `onAgentMessageImage` on `AcpEventHandlers` (`apps/tdr-code/src/agent/agent.types.ts`) implemented by `DiscordHandlerService`.
- **Display state is a single per-channel object** [verified]: `ChannelState` is built lazily in `getOrCreateChannelState` (`discord-handler.service.ts:155-170`); typing state must be managed separately because it starts before that object exists.
- **The `claude` ACP agent accepts image prompt content** [assumption]: the reference sends `{ type: 'image', data, mimeType }` blocks unconditionally and the shared `@agentclientprotocol/sdk` `ContentBlock` type supports them. Confirm in planning that the tdr-code `claude` build advertises image prompt capability (`promptCapabilities.image`); if not, inbound images need a graceful fallback.

---

## Outstanding Questions

### Resolve Before Planning

- _(none — all product decisions are resolved)_

### Deferred to Planning

- [Affects R3, R4][Technical] Typing across back-to-back queued turns: keep typing continuous between a completed turn and an immediately-dequeued next turn, or accept a brief flicker as `onPromptComplete` stops typing and the next chunk/tool event re-arms it.
- [Affects R5][Technical] Exact dedupe mechanism for the typing loop in the NestJS service — adapting the reference's synchronous placeholder-timer guard (`~/dev/acp-discord/src/daemon/discord-bot.ts:49-68`) to a `Map<channelId, NodeJS.Timeout>` on the handler.
- [Affects R11][Needs research] Confirm `claude`-over-ACP image prompt support and the exact `ContentBlock` image shape for the `@agentclientprotocol/sdk` version pinned in tdr-code.
- [Affects R13, R14][Technical] Outbound ordering when an image arrives mid-stream: the reference does a *final* `flushReply` (sends buffered text as new messages and resets the streaming placeholder) before sending the image. Confirm this interacts cleanly with tdr-code's `flushReply`/`finalizeTurn` and the `replyMessage` streaming placeholder (`discord-handler.service.ts:249-321`).
- [Affects R10][Technical] Whether to surface skipped or failed images to the user (silent vs. a brief note) — the reference is silent.

---

## Next Steps

-> `/ce-plan` for structured implementation planning
