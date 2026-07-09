---
date: 2026-07-05
topic: tdr-code-logs-page
---

# tdr-code — Live, Searchable, Virtualized Logs Page

## Problem Frame

The `@lilnas/tdr-code` console can show you *what the bot is doing* (live sessions, status, events) but not *what any process actually logged*. Today the only way to read the app's logs is to shell into the host and `tail`/`grep` three pino JSON-lines files under `/tmp/tdr-code/`:

- `backend.{dev,prod}.log` — the **main** and **bot** processes, interleaved in one file and distinguished by the `process` field. Already 3.5 MB in a dev session and growing.
- `frontend-server.{dev,prod}.log` — Next.js server code (0 call sites today; empty/absent).
- `frontend-browser.{dev,prod}.log` — browser telemetry shipped via `POST /logs/browser` (exists, empty today).

Two facts make a naive viewer inadequate. First, **there is no log rotation** — `pino/file` appends forever, so these files grow without bound and any viewer must treat "arbitrarily large file" as the steady state, not an edge case. Second, the lines are **structured JSON** (numeric pino level, epoch-ms `time`, kebab `event` slug, `msg`, plus arbitrary context), so a raw text dump wastes the structure that makes the logs queryable.

This work adds a first-class **Logs page** to the console: a live tail you can watch, scroll back through to the beginning of the file, search honestly across the *whole* file, filter by the structured fields, and read pretty-printed — all without the UI slowing down as the file grows. It is the local/live, per-file operator view; it is complementary to (not a replacement for) the prod Loki/Grafana aggregate stack.

---

## Actors

- A1. **Operator** — a guild member using the web console. Watches the bot's logs live while developing, and digs back through history when something breaks. Their browser holds the tail connection and issues the read/search requests.
- A2. **Logs backend (main process)** — the NestJS main server, the only process that can read the log files (loopback-bound, files on its host). Serves three read paths: a live append-tail push, a windowed byte-offset read, and a whole-file search. Reads files only; never writes them.
- A3. **The log files** — three append-only pino JSON-lines files resolved through `src/logging/log-paths.ts`, written by four sources (main, bot, Next server, browser) across the three files, unbounded in size, secrets already masked at write time.

---

## Key Flows

- F1. **Watch live (the default)**
  - **Trigger:** the operator opens `/logs` (or a new line is appended while they watch).
  - **Actors:** A3, A2, A1
  - **Steps:** the page opens on a source tab with follow **on** → A2 watches the file and pushes each newly-appended line from the last offset → the browser appends it to the virtualized list and auto-scrolls to the newest line.
  - **Outcome:** the operator watches the bot's log stream in near-real-time, like `tail -f`, inside the console.
  - **Covered by:** R3, R5, R12, R13

- F2. **Scroll back, pause follow**
  - **Trigger:** the operator scrolls up, away from the bottom.
  - **Actors:** A1, A2
  - **Steps:** scrolling up auto-pauses follow and shows a "N new lines" badge as lines keep arriving below → the operator scrolls further and the viewer fetches earlier byte windows on demand, all the way back to the start of the file → clicking "jump to latest" resumes follow and snaps to the newest line.
  - **Outcome:** history is fully reachable without losing your place, and following never yanks the viewport while you're reading.
  - **Covered by:** R4, R6, R7, R8

- F3. **Search the whole file and jump to a hit**
  - **Trigger:** the operator types a search query.
  - **Actors:** A1, A2, A3
  - **Steps:** A2 searches the *entire* file server-side and returns an honest total count plus every match location → the operator steps through matches ("hit i of N") → selecting a match loads the window around it and highlights the matched text in place. Active structured filters compose with the search.
  - **Outcome:** search tells the truth about a file far larger than the browser could ever hold, and every hit is reachable.
  - **Covered by:** R9, R10, R11

- F4. **Inspect one line**
  - **Trigger:** the operator clicks a log row.
  - **Actors:** A1
  - **Steps:** a detail panel opens with the full, syntax-highlighted, pretty-printed JSON of that entry, a copy action, and "filter by this field/value" actions → the panel is dismissible to return to a pure uniform-line scan.
  - **Outcome:** the structured payload is fully legible on demand without bloating every row in the firehose.
  - **Covered by:** R12, R14

---

## Requirements

**Page & navigation**
- R1. A new authenticated `/logs` page, linked from the console nav, matching the existing dark / dense / monospace aesthetic and hand-built component idiom (`cns()`, the shared status/empty/error/loading components). It should feel like a native part of the console, not a bolted-on panel.
- R2. Source selection is **per-file tabs with equal footing**: `backend`, `frontend-server`, `frontend-browser`. Each tab is an independent view with its own follow/scroll/search/filter/selection state, preserved when switching away and back within a session. A tab whose file is empty or absent shows a clear empty state, not an error.

**Live tail & follow**
- R3. Follow mode is **on by default**: newly appended lines stream in via server push and the view auto-scrolls to the newest line.
- R4. Scrolling up (away from the bottom) **auto-pauses** follow; a badge reports how many new lines arrived while paused; a "jump to latest" affordance resumes follow and snaps to the newest line.
- R5. New lines arrive as a **true append delta** — the actual new line text pushed from the last known offset — not a signal telling the client to re-fetch the tail. A burst of writes renders incrementally.

**History & virtualized scrolling**
- R6. The viewer can scroll back through the **entire** file to its first line, loading earlier content on demand in bounded windows rather than all at once.
- R7. The rendered list is **virtualized**: only visible rows exist in the DOM. Combined with uniform row height (R12), a file of arbitrary size scrolls smoothly and never freezes the main thread.
- R8. The client holds a **bounded window** of lines in memory, independent of total file size: far-offscreen content is evicted and reloaded when scrolled back to. Memory does not grow with the file.

**Search & filters**
- R9. Free-text search runs **server-side over the entire file** and returns an honest total match count plus the location of every match — never limited to the lines currently loaded in the browser.
- R10. The operator can navigate matches (next / previous, with "hit i of N"); selecting a match loads the window around it and highlights the matched text in place.
- R11. Structured filters — **level** (e.g. errors-only, ≥ warn), **source/process** (including a `main` / `bot` / both sub-filter within the `backend` tab, since that file interleaves both), and **`event` slug** — are evaluated completely over the whole file (server-side) and **compose** with free-text search.

**Structured rendering**
- R12. Each entry renders as a single, **uniform-height** line: timestamp, **level color-coded by severity** (trace/debug dim, info default, warn amber, error/fatal red), a source/process badge, the `event` slug, the `msg`, and remaining context as dim `key=val` chips. Content that overflows one line is truncated; the full content lives in the detail panel.
- R13. Selecting a line opens a **detail panel** with the full, syntax-highlighted, pretty-printed JSON of that entry, a copy-to-clipboard action, and "filter by this field/value" actions. The panel is dismissible so a pure-scan session stays all uniform lines.
- R14. **Malformed / non-JSON lines** (a half-written final tail line, or a stray non-pino line) render as raw text without breaking JSON parsing, virtualization, or search; the next complete line parses normally.

**Transport & large-file backbone**
- R15. A **windowed byte-offset read** endpoint serves both scroll-back (R6) and jump-to-hit (R10): it returns a bounded, line-aligned window around a requested offset. No operation — read, tail, or search — ever loads a whole file into memory; all three are streaming / seek-based.
- R16. Live tail is delivered by a **dedicated push endpoint** that watches the file and emits appended lines from the last offset. It is **separate from the existing `/api/stream` DB-signal SSE** and does not reuse its signal-refetch model (that model was built for in-place-updated DB rows; append-only log files are a different shape).
- R17. All file access is **confined to the known log paths** resolved through `log-paths.ts`. The client selects a stream by **name** (`backend` / `frontend-server` / `frontend-browser`), never by path; there is no arbitrary-path read surface.

**Non-functional**
- R18. The page and all three endpoints are covered by the existing **global cookie `AuthGuard`** — no new auth path (`EventSource` and `fetch` send the same-origin cookie). Response buffering is disabled across the proxy path for the tail endpoint (the same concern the DB SSE already handles).
- R19. The viewer introduces **no new secret-leak path**: it relies on the existing write-time redaction (secrets are already masked on disk) plus the path confinement of R17. Any log lines the viewer's own backend emits follow the structured-logging convention (a registered `event` slug per `info`+ line).
- R20. Rendering, scroll-back, search-jump, and tail bursts stay responsive on a large file (target: smooth on files at least in the hundreds of MB). No operation blocks the event loop or the main thread in proportion to total file size.

---

## Acceptance Examples

- AE1. **Covers R3, R4.** Given follow is on and the operator is at the bottom, when new lines are appended, the view auto-scrolls to them; when the operator scrolls up, follow pauses and a "N new" badge appears and increments; clicking "jump to latest" resumes follow and snaps to the newest line.
- AE2. **Covers R9, R10.** Given a 200 MB file whose only match for a term sits near the very top (never loaded into the browser), when the operator searches for it, the count includes that match and selecting it loads and highlights the correct window — search does not report "0 results" for content that isn't currently loaded.
- AE3. **Covers R7, R8, R20.** Given a file in the hundreds of MB, when the operator opens the tab and scrolls, only the visible rows exist in the DOM, scrolling stays smooth, and browser memory does not grow proportionally to file size.
- AE4. **Covers R5.** Given the agent emits a burst of log lines, when they are appended, the tail renders each incrementally (append delta) rather than re-fetching and re-rendering the whole tail window.
- AE5. **Covers R14.** Given the tail reads a final line that is only half-written, when it renders, it appears as raw text and the list keeps working; when the rest of that line is flushed, the completed line parses and renders as structured.
- AE6. **Covers R9, R11.** Given source = `backend`, process = `bot`, level ≥ warn, and a search term, the match count and results reflect only bot warn+ lines matching that term across the whole file — filters and search apply together and completely.

---

## Success Criteria

- The operator can answer "what is the bot doing right now?" and "what happened when X broke?" entirely from the console, without shelling into the host to `tail`/`grep`.
- Search never lies: a reported count and match set reflect the whole file, not a loaded window — even on a file far larger than the browser could hold.
- The UI stays smooth (scroll, follow, search-jump) on an unbounded, actively-growing file; opening a huge tab does not freeze the tab.
- Structured lines are scannable at a glance (severity color, event, message) and fully legible on demand (detail panel) — the JSON structure is an asset, not noise.
- The page reads as a first-class, polished part of the console (matches the existing aesthetic), not an afterthought.
- Downstream handoff: `/ce-plan` can sequence this without inventing product behavior — sources, live/scroll/search/filter semantics, the row + panel model, the transport split (dedicated append-tail vs. windowed read vs. whole-file search), and the correctness/perf contracts are all specified; only the enumerated technical choices remain.

---

## Scope Boundaries

- **No cross-source time-merged timeline in v1.** Sources are per-file tabs (equal footing); a unified, timestamp-interleaved view across the three files is deferred — pulled forward only if/when the frontend streams gain volume worth correlating against the backend. (Backend main+bot are already correlated for free, being one physical file.)
- **No log rotation or retention management** is added here. The viewer reads whatever is on disk; bounding file growth is a separate ops concern. (Its absence is exactly why large-file handling is a hard requirement.)
- **Read-only.** No editing, deleting, clearing, or truncating logs from the UI.
- **No download/export** of log slices in v1 (a plausible later add).
- **No time-range / jump-to-timestamp navigation** in v1 — search + scroll cover investigation; a timestamp jump is a later enhancement.
- **No enrichment of what gets logged.** The viewer renders whatever the four sources already write; growing browser/Next-server log coverage is a separate effort. `frontend-server`/`frontend-browser` tabs may be sparse or empty at launch, and that is expected.
- **Not a reuse of `/api/stream`.** The DB-signal SSE stays as-is; the log tail is a purpose-fit endpoint (see R16).
- **Not an alerting/metrics surface.** Prod aggregate querying/alerting is Loki/Grafana's job; this is the local/live per-file operator viewer.

---

## Key Decisions

- **Balanced split-purpose, follow-on-by-default** (Q1). The page opens tailing live, but search, filters, and scroll-back are always-present first-class controls, not a mode you switch into — matching how the operator bounces between "watch it stream" and "why did that fail."
- **Whole-file, server-side search** (Q2). One honest search scope. Grep-on-the-server stays fast via streaming reads even on large files, and it can't "lie" the way a loaded-window client search does on an unbounded file. Structured filters are likewise evaluated completely server-side.
- **Per-source tabs, equal footing** (Q3). Every operation stays single-file (simple tail, simple scroll, simple search), and the backend file already gives main+bot correlation for free. The 3× complexity of a cross-file merge is deferred until its payoff (frontend correlation) is real.
- **Uniform single-line rows + detail panel** (Q4). Uniform row height is the single biggest virtualization win (no measurement, no layout thrash, trivial jump-to-offset), and moving the rich pretty-print into a panel reconciles "pretty-print the structure" with "render huge files fast." Collapsed rows truncate; the panel holds the full JSON.
- **Dedicated append-delta tail endpoint, not `/api/stream` reuse** (Q5). Log files are append-only, so the delta (push the new lines) is trivial and correct here — precisely the model the DB SSE deliberately *deferred* because DB rows update in place. Reusing the signal-refetch hub would bolt the wrong shape onto it; a small dedicated watch→push endpoint is both simpler and more live.
- **Windowed byte-offset read is the shared backbone.** Both scroll-back and jump-to-search-hit fetch a bounded line-aligned window around an offset; whole-file search returns match offsets that feed the same windowed read. This one primitive keeps client memory bounded regardless of file size.

---

## Dependencies / Assumptions

- **Three pino JSON-lines files under `/tmp/tdr-code/` via `log-paths.ts`** [verified — `src/logging/log-paths.ts`]. `backend` interleaves `main` + `bot`, split by the `process` field [verified from real `backend.dev.log` lines]. `frontend-server` has zero call sites (empty/absent) and `frontend-browser` exists but is empty today [verified].
- **No log rotation exists** — `pino/file` appends unbounded; `backend.dev.log` is already ~3.5 MB in one dev session [verified]. "Whole file" is therefore the addressable range and can grow large.
- **Secrets are already masked at write time** (`redactionCensor` on every backend/browser sink) [verified — `backend-logger.ts`, `browser-logs.service.ts`], so displaying file content is safe; the viewer must not add a path-traversal read surface (R17).
- **Global `AuthGuard` covers new routes** [verified — `app.module.ts` `APP_GUARD`]; same-origin cookie flows to `EventSource`/`fetch`, so no new auth code.
- **The proxy path is browser → Traefik → nginx → Next `/api/*` rewrite → NestJS (loopback)** [verified via the SSE plan]; the tail endpoint must have buffering disabled across it (same R13 concern the DB SSE already solved).
- **No virtualization or search library is installed** — only `@tanstack/react-query` [verified `package.json`]. A virtualization approach (e.g. TanStack Virtual, same family) and the search implementation are planning choices.
- **The existing `/api/stream` SSE is signal→refetch-snapshot; delta-push was deferred** [verified — the SSE plan]. The log tail is intentionally a separate endpoint.
- **Structured-logging convention applies** [verified — `docs/solutions/conventions/tdr-code-structured-logging-convention-2026-07-03.md`]: every `info`+ backend log needs a registered `event` slug in `src/logging/log-events.ts`, and that registry is plane-neutral (no framework imports). The viewer's own backend logs must register slugs.
- **Frontend-design intent.** The user invoked this alongside `/frontend-design`; implementation should run the frontend-design quality pass (composition, typography, motion, copy) against the console's existing aesthetic — the design bar is part of the deliverable, not a follow-up.

---

## Outstanding Questions

### Resolve Before Planning

- _(none — the product decisions are resolved: purpose/default mode, search scope, source model, row/panel model, and tail transport.)_

### Deferred to Planning

- [Affects R5, R16][Technical] Tail mechanism — `fs.watch` vs. `fs.watchFile`/interval vs. a `tail`-style reader; partial-final-line buffering; behavior if a file is ever truncated/replaced (future rotation).
- [Affects R6, R15][Technical] Windowed-read scheme — page/window size, and how to snap an arbitrary byte offset to a line boundary (backwards scan for the preceding newline) so windows never split a JSON line.
- [Affects R7, R8][Technical] Virtualization approach — library vs. hand-rolled, and how on-demand byte windows map to virtual row indices when the total line count is unknown and growing (uniform height helps but the count is still open).
- [Affects R9, R10][Technical / Needs research] Search implementation — streaming grep vs. read-scan, substring vs. regex support, mapping match byte-offsets to line windows, and whether counts/results stream progressively for very large files vs. return one-shot. (v1 requires at least substring; regex is a desirable stretch.)
- [Affects R18, R20][Needs research] Exact buffering-off configuration for the tail endpoint across the Next rewrite / nginx / Traefik hops (reuse the DB-SSE findings).
- [Affects R12][Technical] Timestamp presentation — epoch-ms → local vs. UTC, sub-second precision, and how the source/process badge and `event` are laid out in the fixed single-line grid.

---

## Next Steps

-> `/ce-plan` for structured implementation planning. Suggested sequence: (1) the windowed byte-offset read endpoint + a virtualized uniform-height list rendering one static source tab (this alone replaces `tail`/`less` for a static file and is independently shippable); (2) the dedicated append-tail push endpoint + follow/pause/jump-to-latest; (3) whole-file server-side search + structured filters + jump-to-hit; (4) the detail panel, level color-coding, and the frontend-design polish pass; (5) proxy buffering-off + large-file hardening.
