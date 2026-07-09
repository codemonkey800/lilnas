---
date: 2026-07-05
topic: tdr-code-sse-push
---

# tdr-code — Replace UI Polling with Notify-Driven SSE Push

## Problem Frame

The `@lilnas/tdr-code` web console is stale-by-design. Every live surface is React Query polling the NestJS REST API on a fixed `refetchInterval: 5_000`:

- `src/app/page.tsx` — dashboard `/live` (5s)
- `src/app/config/page.tsx` and `src/app/components/bot-status-widget.tsx` — `/bot/status` (5s, ×2)
- `src/app/sessions/[id]/page.tsx` — session detail `/sessions/:id` (5s)

The operator's own mutations already feel instant (restart/teardown/config/git-identity invalidate their queries on success — `page.tsx:125-149`, `config/page.tsx:96`). The felt latency is **ambient convergence**: state that keeps changing *after* an action, which the UI only catches on the next 5s tick — the bot booting (`starting → online`), and above all the **session page**, where the agent streams turns and tool calls into SQLite continuously and the operator watches it through a 5-second strobe.

This work replaces client polling with **server→client push over SSE**, driven by the bot **notifying** the main server when it writes. The premise in the original ask — "reuse the existing tRPC infra" — does not hold: **no app in the lilnas monorepo uses tRPC** (verified). The transport is built fresh, and SSE (not WebSockets, not tRPC) is the fit because the live data is one-directional (the console is observe-only; it never sends prompts to the agent).

---

## Actors

- A1. **Operator** — a guild member using the web console; watches live activity and controls the bot. Their browser holds the SSE connection.
- A2. **Main server (control plane)** — Next.js UI + NestJS REST API + SQLite owner + supervisor. Serves the SSE endpoint, holds per-table read cursors, and pushes deltas to connected browsers. Reads SQLite; does not write the live data.
- A3. **Discord ACP bot (data plane)** — the restartable child process. Writes live data to SQLite in its ACP fan-out (`SqliteWriterService`) and notifies A2 on write. The part that can wedge/crash.
- A4. **SQLite (WAL)** — the shared system of record and the only durable coupling between A2 and A3.

---

## Key Flows

- F1. **Watch the agent work (the core win)**
  - **Trigger:** the agent produces output during a turn.
  - **Actors:** A3, A2, A1
  - **Steps:** ACP events land in the bot's fan-out → `SqliteWriterService` appends `turn_content`/`turns` rows → the bot sends a debounced "changed" notify to the main server → the server advances the affected per-table cursor, reads the new rows, and pushes a delta over SSE → the client writes it into React Query via `setQueryData` → the session page re-renders.
  - **Outcome:** the session view tracks the agent within a fraction of a second instead of stepping every 5s.
  - **Covered by:** R1, R2, R4, R5, R7, R9

- F2. **Bot restart converges live**
  - **Trigger:** A1 clicks restart.
  - **Actors:** A1, A2, A3
  - **Steps:** restart mutation fires (unchanged) → the bot shuts down, respawns, and writes `bot_generation` rows through `starting → online` → each write notifies → the server pushes each status transition.
  - **Outcome:** the status indicator flips through its states live, not one 5s tick per step.
  - **Covered by:** R1, R2, R7

- F3. **Bot down / wedged — degrade, then catch up**
  - **Trigger:** A3 crashes or hangs; no notifies arrive.
  - **Actors:** A2, A3, A1
  - **Steps:** notifies stop → the server keeps serving last-known state and the UI shows "bot offline" (existing R3 behavior) → a slow fallback poll (the cursor loop on a long interval) keeps running → when the supervisor respawns the bot, the fallback (or the first post-restart notify) advances the cursor and pushes the accumulated delta.
  - **Outcome:** the console never lies about being connected, never errors out, and self-heals on restart without a full page reload.
  - **Covered by:** R3, R8, R10

- F4. **Reconnect loses nothing**
  - **Trigger:** the tab sleeps, the network blips, or Traefik recycles the connection.
  - **Actors:** A1, A2
  - **Steps:** `EventSource` auto-reconnects → the client sends its last-seen cursor (via `Last-Event-ID` or a query param) → the server resumes the stream from that cursor.
  - **Outcome:** a dropped connection is invisible; no gap in the transcript, no manual refresh.
  - **Covered by:** R6, R8

---

## Requirements

**Transport & delivery**
- R1. The main server exposes an SSE endpoint (NestJS `@Sse()`) that holds an open connection and pushes JSON messages to the browser. Each message identifies its topic (e.g. `live`, `bot-status`, `session:<id>`) so the client can route it.
- R2. Messages are pushed only when the underlying data has actually advanced, not on a heartbeat schedule (a low-frequency keepalive comment to hold the connection open is allowed).
- R3. The endpoint is protected by the existing cookie-based `AuthGuard`. No new auth path is introduced (`EventSource` sends same-origin cookies automatically).

**Change propagation (notify + cursor backbone)**
- R4. When the bot writes live data to SQLite in its ACP fan-out (`SqliteWriterService`), it notifies the main server that data changed. The notify is a wake-up signal, not the payload.
- R5. The notify signal covers the tables the UI streams — `turn_content`, `turns`, `live_status`, `bot_generation` — not only the coarse `events` table, so the session page streams smoothly rather than stepping between session-lifecycle events.
- R6. The main server tracks a monotonic read cursor per stream (e.g. `max(id)` / `max(updated_at)`). On a notify (or reconnect, or startup) it reads rows strictly after the cursor, pushes them, and advances the cursor. A cursor is the unit of correctness: no row is pushed twice, and no row is skipped.
- R7. Notifies are debounced/coalesced so a burst of writes produces a bounded number of pushes.

**Resilience & correctness**
- R8. A dropped or missed notify cannot lose data: because delivery is cursor-driven (R6), the next successful notify — or the fallback poll (R10) — emits everything after the last cursor. Fire-and-forget notify without cursor reconciliation is explicitly not acceptable.
- R9. The client keeps React Query as its cache/store; the SSE stream feeds it via `setQueryData`. `refetchInterval` is removed from the migrated queries. Pages migrate one at a time behind this seam.
- R10. A slow fallback poll (the same cursor read on a long interval, e.g. 30s) runs as a backstop for the window when the bot is down/silent and for reconnect gaps. It is the safety net, not the primary path.

**Coverage**
- R11. All four current poll sites move to push: dashboard `/live`, `/bot/status` (both the config page and the status widget), and session detail `/sessions/:id`.
- R12. When the bot is down, every migrated surface degrades to last-known state plus the existing offline indicator (parity with today's R3 behavior), and resumes live on respawn without a full page reload.

**Non-functional**
- R13. Response buffering is disabled for the SSE route across the whole path (Next.js `/api/*` rewrite → Traefik → nginx), so events are delivered incrementally rather than buffered.
- R14. The notify channel between the two processes stays loopback-only, consistent with the app's existing `127.0.0.1` binding and security posture; it introduces no externally reachable surface.

---

## Acceptance Examples

- AE1. **Covers R5, R9.** Given the agent is mid-turn emitting message chunks and tool calls, when those rows are written, then the open session page reflects each within ~1s without a full refetch and without a visible 5s step.
- AE2. **Covers R6, R8.** Given a notify is dropped while three `turn_content` rows were written, when the next notify (or the fallback poll) fires, then all three rows are delivered exactly once and none are duplicated.
- AE3. **Covers R3, R12.** Given the bot process is down, when the operator opens the console, then it loads, shows last-known state plus "bot offline," and does not error — and when the supervisor respawns the bot, the surfaces resume live without a page reload.
- AE4. **Covers R6.** Given the browser's `EventSource` reconnects after a network blip, when the stream resumes, then it continues from the client's last-seen cursor with no gap and no duplicate in the transcript.

---

## Success Criteria

- Watching a session tracks the agent in near-real-time; the 5s strobe on the session page is gone.
- Bot-status transitions (including restart convergence) appear live rather than one-tick-at-a-time.
- No pushed data is ever lost or duplicated, even across dropped notifies, bot restarts, and reconnects — provable by the cursor being the single source of delivery truth.
- With the bot down, the console still loads, tells the truth about being offline, and self-heals on respawn.
- Downstream handoff: `ce-plan` can sequence this without inventing product behavior — the transport (SSE), the propagation model (notify + cursor), the correctness contract, and the per-surface migration are all specified; only the enumerated technical choices below remain.

---

## Scope Boundaries

- **No WebSockets and no bidirectional channel.** The live data is one-directional; control actions remain plain POSTs. R20 of the web-ui brainstorm stands — the console does not send prompts to the agent.
- **No tRPC adoption.** The app has no tRPC; introducing it is a far larger change than the transport itself and is not pursued.
- **React Query is not removed.** It stays as the client cache/store; only its *feed* changes (SSE push instead of `refetchInterval`).
- **Existing mutation invalidation is not reworked.** Operator mutations already update instantly; push targets ambient convergence, not click feedback.
- **Pure Approach A (server-internal poll only) is not the chosen model.** A's cursor loop is retained *inside* this design as the correctness backbone (R6) and the fallback (R10), but the primary trigger is the bot's notify.
- **`relative-time.tsx`'s 30s timer is untouched** — it re-formats "5m ago" labels client-side and makes no API call.
- **No change to config-apply semantics, per-user git identity, transcript retention, or auth model** — those live in other brainstorms.

---

## Key Decisions

- **SSE over WebSockets (transport).** Data is server→client only; SSE gives native `EventSource` auto-reconnect, works with the existing cookie `AuthGuard` (cookies flow same-origin; a raw WS would re-implement auth on the upgrade), and adds ~zero dependencies (`rxjs` and NestJS `@Sse()` are already present). WS would buy bidirectionality that is never used here.
- **Approach B — notify-driven push (propagation).** The bot actively notifies the main server on write, rather than the server polling the DB on a timer (Approach A). Chosen for lowest latency and no steady-state timer. Accepted trade-off: it adds a second live coupling between the two processes, which the two-process architecture had deliberately avoided (shared SQLite as the only link).
- **Cursor reconciliation is mandatory, not optional.** Because a bare notify can be dropped or arrive while the server is mid-restart, delivery is always cursor-driven (R6/R8). A correct B therefore contains A's cursor-tailing as its backbone; the notify is a latency shortcut on top of it, and A's loop survives as the fallback (R10). This is why "A vs B" is not a fork: B is a strict superset of A's mechanism.
- **Keep React Query; migrate per-page.** Feeding `setQueryData` from SSE preserves the cache/store and lets each of the four surfaces move independently behind one seam, keeping the change incremental and reversible.

---

## Dependencies / Assumptions

- **No tRPC anywhere in the monorepo** [verified — `grep 'initTRPC|@trpc/'` across `apps/` + `packages/` returns nothing].
- **The bot is `spawn`'d, not `fork`'d** [verified — `src/supervisor/supervisor.service.ts:67` `spawn('node', [botEntry], …)`], so there is **no `child.send` IPC today**; the notify channel is net-new (see Outstanding Questions for the transport choice).
- **The bot writes live data synchronously in its ACP fan-out** [verified — `SqliteWriterService` via the composite ACP handler], giving a single, well-defined place to emit the notify.
- **The streamed tables exist** [verified — `live-status.repo.ts`, `turns.repo.ts`, `turn-content.repo.ts`, `bot-generation.repo.ts`, `events.repo.ts`], and carry a monotonic key suitable for a cursor (to confirm per table in planning).
- **Cookie auth + global `AuthGuard`** [verified — `app.module.ts` `APP_GUARD`], and `EventSource` sends same-origin cookies, so the SSE route is guarded with no new auth code.
- **`rxjs` (7.8.1) and `@nestjs/schedule` (6.0.1) are already dependencies** [verified — `package.json`]; SSE needs no new runtime deps, and the fallback poll can reuse the scheduler.
- **The path is Next.js `/api/*` rewrite → Traefik → nginx** [verified — `next.config.js`]; each hop must be checked for SSE buffering (R13).

---

## Outstanding Questions

### Resolve Before Planning

- _(none — the product decision, the transport, and the propagation model are all resolved.)_

### Deferred to Planning

- [Affects R4, R14][Technical] Notify transport between bot and main server. Options: add `ipc` to the `spawn` `stdio` (cleanest — no ports, no on-disk socket, closest to the deferred "thin internal bot API"), a Unix domain socket, or a loopback HTTP ping. Recommendation: `ipc` stdio.
- [Affects R1, R11][Technical] One multiplexed `/api/stream` endpoint with client-selected topics vs. per-view SSE endpoints. Recommendation: one multiplexed stream (matches the "one clean push model" goal); confirm against NestJS `@Sse()` ergonomics.
- [Affects R5, R6][Technical] Cursor granularity per stream — whole-DB `PRAGMA data_version` gate vs. per-table `max(id)`/`max(updated_at)`. Per-table is needed for precise session streaming; confirm each streamed table has a suitable monotonic column.
- [Affects R7][Technical] Debounce/coalesce window for notifies (e.g. ~50–100ms) balancing latency against push volume during chunk bursts.
- [Affects R13][Needs research] Exact buffering-off configuration at each hop (Next.js rewrite behavior for streaming responses, Traefik, nginx `X-Accel-Buffering: no` / `proxy_buffering off`).
- [Affects R6, R8][Technical] Reconnect resume mechanism — `Last-Event-ID` header vs. an explicit cursor query param on the SSE URL.

---

## Next Steps

-> `/ce-plan` for structured implementation planning. Suggested sequence: (1) SSE endpoint + client `EventSource`→`setQueryData` seam with the fallback poll (this alone replaces polling using A's cursor loop and is independently shippable); (2) add the bot→server notify channel to collapse latency to push; (3) migrate the four surfaces one at a time; (4) proxy buffering-off + reconnect-resume hardening.
