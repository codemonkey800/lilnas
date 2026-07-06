---
title: 'feat: tdr-code Logs page — Phase 2: live tail, whole-file search, filters, polish'
type: feat
status: active
date: 2026-07-05
origin: docs/brainstorms/2026-07-05-tdr-code-logs-page-requirements.md
deepened: 2026-07-05
---

# feat: tdr-code Logs page — Phase 2: live tail, whole-file search, filters, polish

## Overview

This is **Phase 2 of 2** for the tdr-code Logs page (see origin: `docs/brainstorms/2026-07-05-tdr-code-logs-page-requirements.md`). Phase 1 (`docs/plans/2026-07-05-003-feat-tdr-code-logs-viewer-phase-1-plan.md`) shipped a static, seek-based, virtualized viewer — the windowed byte-offset read (R15), the bounded-window virtualized list (R7, R8), uniform row rendering (R12), and the read-only detail panel (R13, read half). Phase 2 makes that viewer **live and honestly searchable**, then polishes it to a first-class finish.

Phase 2 adds three server capabilities and the interactions that consume them:

1. A **dedicated append-delta tail push endpoint** (R5, R16) — a `fs.watch`-driven stream that pushes the *actual new line text* from the last offset, deliberately **separate** from the existing `/api/stream` DB-signal SSE (whose signal-refetch model is the wrong shape for append-only files). Leak-safe by construction, modeled on the `sse-hub.service.ts` one-handle-per-key lifecycle.
2. A **whole-file, server-side streaming scan engine** (R9, R10, R11) — one streaming pass produces an **honest exact count**; match locations are returned **cursor-paginated** so a term with millions of hits never materializes. Structured filters (level / process / event) and free-text compose into a single predicate evaluated completely over the whole file.
3. The **client interactions**: follow-on-by-default with scroll-up-pause, "N new" badge, and jump-to-latest (F1, F2); search with "hit i of N" and jump-to-hit-in-context (F3); structured filters that compose with search (AE6); and the detail panel's "filter by this field/value" actions (the rest of R13).

It closes with **transport hardening** for the tail path across the proxy hops (R18), a **frontend-design polish pass** (the origin's "reads as a first-class part of the console" bar), and **large-file perf + test hardening** validating the origin's acceptance examples (AE2, AE3, AE4, AE6).

U-IDs continue from Phase 1: Phase 1 owns **U1–U7**, Phase 2 owns **U8–U15**. References like "U2" and "U5" below point at Phase 1 units.

---

## Problem Frame

Phase 1's viewer can read the whole on-disk history but only as a static snapshot: it cannot show what the bot is doing *right now*, and it cannot answer "did this ever happen?" for a file far larger than the browser could hold. Both are core operator needs the origin frames — watching the stream live like `tail -f`, and searching honestly across a 200 MB file where the only match sits near the top and was never loaded into the browser.

Two facts make the naive approaches wrong. Live updates must be a **true append delta** (push the new bytes), not a signal-to-refetch — the existing DB-SSE deliberately *deferred* delta-push because DB rows update in place, whereas append-only log files are the one shape where delta is trivially correct (origin Q5, R16). And search must run **server-side over the whole file** via streaming reads, because a loaded-window client search structurally *lies* on an unbounded file — it can only "see" what's in the browser. Phase 2 builds both correctly, composes filters into search, and polishes the result.

---

## Requirements Trace

Phase 2 fully or partially advances:

- R3. Follow mode **on by default**: newly appended lines stream in via server push and the view auto-scrolls to the newest line. — U8, U10
- R4. Scrolling up **auto-pauses** follow; a badge reports how many new lines arrived while paused; "jump to latest" resumes and snaps to the newest line. — U10
- R5. New lines arrive as a **true append delta** — the actual new line text pushed from the last offset, not a refetch signal; a burst renders incrementally. — U8, U10
- R9. Free-text search runs **server-side over the entire file** and returns an honest total match count plus the location of every match. — U9, U11
- R10. Navigate matches (next / previous, "hit i of N"); selecting a match loads the window around it and highlights the matched text in place. — U9, U11
- R11. Structured filters — **level**, **source/process** (incl. `main`/`bot`/both within `backend`), and **`event` slug** — evaluated completely over the whole file (server-side) and **compose** with free-text search. — U9, U12
- R13. (Filter-actions half) The detail panel's "filter by this field/value" actions. (Read half shipped in Phase 1 U7.) — U12
- R16. Live tail delivered by a **dedicated push endpoint** that watches the file and emits appended lines from the last offset — **separate** from `/api/stream`, not reusing its signal-refetch model. — U8
- R18. (Tail half) Response buffering is disabled across the proxy path for the tail endpoint (same concern the DB-SSE already solved). — U13
- R20. Rendering, scroll-back, search-jump, and tail bursts stay responsive on a large file (hundreds of MB); no operation blocks the event loop or main thread in proportion to file size. — U8, U9, U15

**Origin actors:** A1 Operator (holds the tail connection + issues search/filter requests), A2 Logs backend (main process — serves the append-tail push, the windowed read, and the whole-file scan; reads files only), A3 the three append-only pino JSON-lines log files.

**Origin flows:** F1 Watch live (default) — U8 + U10; F2 Scroll back, pause follow — U10 (builds on Phase 1 U5); F3 Search the whole file and jump to a hit — U9 + U11; F4 Inspect one line — U12 completes the filter-actions half (Phase 1 U7 shipped the read half).

**Origin acceptance examples:** AE1 (covers R3, R4 — follow auto-scroll, scroll-up pause + "N new" badge, jump-to-latest); AE2 (covers R9, R10 — a 200 MB file whose only match is near the top is found and jumped-to, count includes it); AE4 (covers R5 — a burst renders incrementally as append delta, not a whole-tail refetch); AE5 (R14 — partial-final-line handling: on the live tail the partial is held and emitted once complete; the "renders raw, then upgrades to structured" behavior is delivered by the windowed-read rendering of on-disk partial/malformed lines (Phase 1 U6) — see the AE5 confirmation in Open Questions); AE6 (covers R9, R11 — source=backend, process=bot, level≥warn, and a term all compose completely over the whole file).

---

## Scope Boundaries

- **Builds strictly on Phase 1.** Phase 2 does not re-implement the windowed read (U2), the virtualized list (U5), row rendering (U6), or the detail panel shell (U7); it extends them.
- **Not a reuse of `/api/stream`.** The DB-signal SSE stays exactly as-is; the log tail is a purpose-fit, separate endpoint (R16, origin Q5). Phase 2 does not touch `SseHubService`/`NotifyBusService`.
- **No cross-source time-merged timeline, no log rotation/retention, no editing/clearing, no download/export, no time-range jump** — all carried from origin scope; unchanged.
- **Substring search is the v1 requirement; regex is a stretch.** The scan engine is designed so regex slots in as an alternate predicate, but regex ships only if it lands cheaply within the streaming model (origin [R9, R10]).
- **Not an alerting/metrics surface.** Prod aggregate querying/alerting is Loki/Grafana's job; this remains the local/live per-file operator viewer.

### Deferred to Follow-Up Work

- Regex search, if it does not land within the streaming scan without risking the R20 perf target — a plausible follow-up.
- Progressive/streaming search *results* to the client (count and offsets streamed as the scan runs) if one-shot count + cursor-paged offsets proves insufficient on the very largest files — noted as a scaling escape hatch, not built unless measured to be needed.

---

## Context & Research

### Relevant Code and Patterns

- **`apps/tdr-code/src/sse/sse.controller.ts`** — the `@Sse('stream')` reference for the tail transport: explicit per-message `id:` (never Nest's auto-id), merged keepalive `timer()`, `finalize()` teardown, `@Headers('last-event-id')` resume, and **no auth code** (global guard covers it). The tail is a *separate controller/route* but mirrors this shape.
- **`apps/tdr-code/src/sse/sse-hub.service.ts`** — the **leak-safe lifecycle template** both external researchers independently flagged: one handle per key, created on the 0→1 transition, cleared exactly once on 1→0, watermarks reset on teardown (`startFallbackTimersIfNeeded`/`stopFallbackTimers`). The tail watcher applies the same discipline **per connection**. Also the source of REVIEW.md finding #1 (the `groupBy`-without-`duration` leak) — the exact class of bug the `fs.watch` tail must avoid.
- **`apps/tdr-code/src/app/lib/use-live-stream.ts`** — the correct-lifecycle `EventSource` client: one source per mount, per-topic listeners, re-invalidate on `onopen` (reconnect resync), and the **`CONSECUTIVE_ERROR_THRESHOLD` fallback** that fires one authenticated `request()` after N `onerror`s so a 401 can trigger the `/login` latch (EventSource retries a 401 forever otherwise). The tail hook reuses this mitigation (U13).
- **`apps/tdr-code/src/console/reconcile.service.ts`** — the block-read + trim-to-newline + skip-malformed pattern the scan engine's streaming pass mirrors (carry-over remainder instead of a single bounded read).
- **`apps/tdr-code/deploy/nginx.conf`** — the `location /api/stream` buffering-off block (`proxy_buffering off; proxy_cache off; chunked_transfer_encoding off; proxy_read_timeout 3600s; proxy_set_header Connection '';`) to clone for the tail path (U13).
- **`apps/tdr-code/next.config.js`** — `X-Accel-Buffering: no` already scoped to all `/api/:path*` (so the Next leg covers the tail for free) and the `/api/*` → NestJS rewrite.
- **`apps/tdr-code/src/env.ts`** — `EnvKeys` for tail debounce / poll-interval / watcher knobs (main-process-only, like `SSE_*`).
- **Phase 1 units:** `log-view.types.ts` (U1 — extend with the tail-message + scan-predicate + search-response shapes), `logs.controller.ts`/`log-reader.service.ts` (U2 — jump-to-hit reuses the windowed read), `log-viewer.tsx` (U5 — follow/search/filter extend it), `log-row.tsx` (U6 — highlight), `log-detail-panel.tsx` (U7 — filter actions), `api.ts` (U4 — add tail URL + search method).

### Institutional Learnings

- **`REVIEW.md`** (review of the shipped SSE work) — a pre-written checklist of the tail endpoint's likely bugs: **#1** the `groupBy`/handle-per-key leak (every long-lived handle created once per key must be torn down on *every* path); **#4** `onModuleDestroy`/teardown must be tested; the **Coverage** notes: no test asserts `/api/stream` returns **401 unauthenticated** (add for the tail + search routes), `streamUrl()` omits `encodeURIComponent` (encode all tail/search params), and cross-plane duplicated constants (e.g. keepalive event type) are a desync trap (put shared constants in the U1 module).
- **`docs/solutions/conventions/tdr-code-structured-logging-convention-2026-07-03.md`** — the tail/scan services' own `info`+ logs need registered `event` slugs (add to the `LOGS_*` group from Phase 1 U1). The scan's structured filters key on numeric pino `level` (≥ warn = `level >= 40`), the `process` field (`main`/`bot`, backend only), and `event`; a line with **no `event`** (a `debug` line) is valid, not malformed, and is simply excluded by an `event`-slug filter.
- **`docs/solutions/architecture-patterns/pure-fsm-core-for-stateful-domain-logic-2026-05-27.md`** — keep the tail-message shape, the scan predicate, and the search-response shape in the plane-neutral U1 module so the tail server, scan server, and browser client cannot drift.
- **Auto-memory `tdr-code-node-version-mismatch`** — run tail/scan specs and `tsc` with the Node 24 PATH override (`env PATH="$HOME/.local/share/nvm/v24.15.0/bin:$PATH" pnpm jest …`); verify the installed v24 ABI is 137 first. CI unaffected.

### External References

- **Node.js `fs` / `string_decoder`** — [fs.watch / filehandle.read / stat](https://nodejs.org/api/fs.html), [string_decoder](https://nodejs.org/api/string_decoder.html). Tail: `fs.watch` is a *change signal only* (inotify/kqueue) — `stat` for the new size, positioned `read` for the new bytes; the kernel fires **duplicate `change` events per write** (nodejs/node#3042 — debounce ~20–50 ms, drive reads off offset-vs-size idempotently); hold a `pendingPartial` line + a persistent `StringDecoder` across reads (partial-final-line + multi-byte UTF-8); `readline` **must not** be used for the tail (it emits the newline-less final line prematurely). Truncation: `size < lastOffset` → reset to 0. Rotation: `fs.watch` pins the **inode** and goes deaf on rename+recreate — compare `ino` and reopen; keep an `fs.watchFile` polling fallback behind an env flag for NFS/exotic mounts.
- **Streaming search** — [ripgrep engineering write-up](https://burntsushi.net/ripgrep/) ("Thou Shalt Not Search Line By Line": constant-sized buffer + partial-line carry-over; counting is cheap enough to do in the streaming pass), [ripgrep #566](https://github.com/BurntSushi/ripgrep/issues/566) (`--count-matches` = occurrences, the honest count model vs `grep -c` line-count), [less(1)](https://www.man7.org/linux/man-pages/man1/less.1.html) (reads forward on demand — the model for cursor-paginated hit fetching). Byte offsets must be computed in **bytes** (`Buffer.byteLength`), never string `.length`.
- **TanStack Virtual** — [Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer): with the Phase 1 bump to `3.14.5`/core `3.17.3`, use `followOnAppend` (auto-scroll on append *only* if already pinned — free follow/pause behavior), `isAtEnd`/`getDistanceFromEnd` (detect "scrolled away" for the jump-to-latest button), `scrollToEnd()` (pin to newest), and `scrollToIndex(i, {align:'center'})` in a window-keyed `useLayoutEffect` for jump-to-hit. Bug #1218 (streaming in-place line growth drift) — keep appended lines **immutable** to sidestep it.

---

## Key Technical Decisions

- **Dedicated `fs.watch` append-tail endpoint, separate from `/api/stream` (resolves origin [R5, R16]).** A new route on `@Controller('logs')` + `@Sse('tail')` — served as `GET /logs/tail` → `/api/logs/tail` through the Next rewrite, matching U13's nginx block (**not** `@Sse('logs/tail')`, which would yield `/logs/logs/tail` and 404 the nginx location). Own controller/service; **does not** import `SseHubService`/`NotifyBusService`. `fs.watch` is a signal only: on a debounced `change`, `fs.stat` the size; if grown, positioned-`read` `[lastOffset, EOF)` into an owned buffer, decode through a persistent `StringDecoder`, prepend `pendingPartial`, split on `\n`, emit **complete lines only** as append-delta SSE messages, retain the trailing partial. Each message `id` = the new byte offset; the server resumes from **`last-event-id` first, then the `?from=` query, else current EOF** — native `EventSource` auto-reconnect re-sends the `Last-Event-ID` header to the same URL and cannot change the query, so the header is the authoritative resume channel and `?from=` only seeds the first connect. It attaches the watcher **before** reading the backlog and re-`stat`s + drains once after attach, closing the race where a line appended in the read→attach window would be missed. Keepalive merged (~25 s, under nginx's 3600 s read timeout). Truncation (`size < lastOffset`) → reset to 0 + clear `pendingPartial`/decoder; inode change → close + reopen + reset. An `fs.watchFile` polling path sits behind an env flag for exotic mounts.
- **Leak-safe watcher lifecycle — one handle per connection, torn down on every path.** Create the watcher (and debounce timer, and open `FileHandle`) **inside** the returned Observable (`defer`-style), pass an `AbortController` `signal` to `fs.watch`, and bind an idempotent `cleanup()` to `finalize()` **and** the watcher `'error'` event **and** `OnModuleDestroy`. This is the direct fix for the REVIEW.md #1 leak class applied per-connection; a teardown test asserting **zero `fs.watch` handles and zero timers after disconnect** is mandatory (U15) — the exact test the DB hub was missing.
- **Two-phase whole-file scan engine (resolves origin [R9, R10, R11]).** A single streaming pass over the file (block read + carry-over remainder, ripgrep-style — never `readFile`) applies a **composed predicate** (structured filters ∧ optional text) to each complete line and computes the **exact total count** (occurrences, `--count-matches`-style). Match **line byte-offsets** are returned **cursor-paginated** (opaque cursor = a resume byte offset), never all at once — a common term in a 200 MB file must not materialize millions of offsets. Byte offsets are computed in bytes. An `AbortController` cancels an in-flight scan when the query changes. Malformed lines (`JSON.parse` throws) are text-searchable but excluded by any structured filter (they have no `level`/`process`/`event`) (R14).
- **Filters and search unify through the scan predicate; two client view modes (resolves the origin's filter/search composition, [R11]/AE6).**
  - **Raw mode** (no filter, no text): the Phase 1 windowed byte view (all lines in file order) + live tail.
  - **Search-navigator** (text query, no structured filter): the full-file windowed view stays; the scan yields exact count + paginated hit offsets; "hit i of N" steps through; selecting a hit loads the windowed **context around** that offset (`direction: around`) and highlights the matched substring **in place** (literal R10/F3).
  - **Filtered projection** (any structured filter active): the list shows **only matching lines**, paged via the scan cursor — because "errors-only" must actually hide noise to be useful, and AE6's "results reflect only bot warn+ lines" reads as a restricted set. Free-text composes as an added predicate; count stays honest and complete.
  - *Open sub-decision, resolved toward literal R10:* a lone text search **navigates in full-file context** rather than hiding non-matches. If the team prefers "text search also hides non-matches," it is a small client-mode change; noted in Open Questions.
- **Tail-path buffering-off via a dedicated nginx `location` (resolves [R18]).** The tail gets a clean `/api/logs/tail` path with its **own nginx `location` block** cloning the `/api/stream` directives (keeps the logs API cohesive under `/api/logs/*` rather than overloading the `stream` prefix). The Next `/api/*` `X-Accel-Buffering: no` header already covers it, and `@Sse()` emits `Cache-Control: no-transform` + `X-Accel-Buffering: no` itself — defense-in-depth. **Verified through the real `tdr-code.lilnas.io` chain with `curl -N`**, not just the bare NestJS endpoint (chained-proxy header-stripping was the highest-risk item in the shipped SSE work). Dev uses no nginx, so dev relies on the Next header + `@Sse()` headers.
- **EventSource-never-stops-on-401 mitigation on the tail (part of [R18]).** Removing polling removed the only guaranteed periodic authenticated request, so an idle operator whose session expires would sit forever while `EventSource` retries a 401. The tail hook reuses `use-live-stream.ts`'s consecutive-`onerror` fallback (fire one authenticated `request()` after N failures → existing 401→`/login` latch).
- **Shared constants live in the U1 module.** The keepalive event type, the tail message `type`, and the scan predicate shape go in `log-view.types.ts` (imported by both planes), per the REVIEW.md cross-plane-desync note.

---

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for review, not implementation specification. The implementing agent should treat it as context, not code to reproduce.*

**Append-tail lifecycle (U8) — `fs.watch` as signal, positioned read as data, one handle per connection:**

```
client EventSource(/api/logs/tail?stream=backend&from=<lastByteOffset>)
  → LogTailService (inside the returned Observable / defer):
       fh = open(logFilePath(stream)); lastOffset = from ?? fileSize
       emit backlog: read [lastOffset, EOF) → complete lines as append-delta (id = new offset)
       watcher = fs.watch(path, { signal: abort.signal })
       on change (debounced ~30ms):
         size = stat().size
         if size < lastOffset:  lastOffset = 0; pendingPartial = ''; decoder.reset()   // truncation
         if inode changed:      close(fh); fh = reopen(); lastOffset = 0                 // rotation
         if size > lastOffset:
           buf = read [lastOffset, size); lastOffset = size
           text = pendingPartial + decoder.write(buf)
           lines = text.split('\n'); pendingPartial = lines.pop()      // hold incomplete tail
           for each complete line: emit { data: line, id: offset, type: 'log-append' }
       keepalive: merge timer(25s) → { type: 'keepalive' }
       cleanup() [finalize + watcher 'error' + OnModuleDestroy, idempotent]:
         abort.abort(); clearTimeout(debounce); await fh.close()
```

**Scan engine + view modes (U9 / U11 / U12):**

```
predicate = { text?: substring, level?: >=n, process?: main|bot, event?: slug }   // U1 shared shape

GET /api/logs/search?stream&<predicate>&cursor?
  → LogSearchService: stream file in blocks, carry-over remainder,
       for each complete line: parse → apply structured filters → apply text match
       → count++ ; collect this page's match line-offsets (bounded); stop page at N offsets
  → { total: <exact>, matches: [{ byteOffset }], nextCursor }

              ┌─ raw mode (no predicate) ──────────► Phase 1 windowed byte view + live tail
 view mode ───┤─ search-navigator (text only) ─────► full view; hit i/N; select → window `around` offset + highlight
              └─ filtered projection (any filter) ─► list = matching offsets (scan-paged); each line via windowed read
```

**Follow / pause / jump (U10), built on TanStack Virtual `followOnAppend` + `isAtEnd`:**

```
tail append while isAtEnd  → followOnAppend auto-scrolls to newest (F1, R3)
user scrolls up (!isAtEnd) → follow auto-pauses; tail events only increment a bounded "N new" counter (R4)
"jump to latest"           → re-fetch tail window (before from fileSize), scrollToEnd(), resume live append (R4)
burst of appends           → each complete line appended incrementally, immutable (R5, AE4; avoids bug #1218)
```

---

## Implementation Units

- U8. **Append-delta tail push endpoint (`fs.watch` → SSE)**

**Goal:** A dedicated, leak-safe push endpoint that watches a named stream's file and emits the actual newly-appended complete lines from the last offset — separate from `/api/stream`, correct on partial final lines, truncation, and rotation.

**Requirements:** R3, R5, R16, R20

**Dependencies:** Phase 1 U1 (extend shared types with the tail-message shape + keepalive constant), U2 (shares `log-reader` helpers/path confinement)

**Files:**
- Create: `apps/tdr-code/src/logging/log-tail.controller.ts`
- Create: `apps/tdr-code/src/logging/log-tail.controller.spec.ts`
- Create: `apps/tdr-code/src/logging/log-tail.service.ts`
- Create: `apps/tdr-code/src/logging/log-tail.service.spec.ts`
- Modify: `apps/tdr-code/src/logging/log-view.types.ts` (tail message `{ line, byteOffset }`, `type` + keepalive constants)
- Modify: `apps/tdr-code/src/logging/logs.dto.ts` (tail query: `stream`, `from`)
- Modify: `apps/tdr-code/src/logging/logs.module.ts` (declare the tail controller/service)
- Modify: `apps/tdr-code/src/logging/log-events.ts` (slugs: `'log-tail-started'`, `'log-tail-watch-failed'`, `'log-tail-reopened'`)
- Modify: `apps/tdr-code/src/env.ts` (`LOG_TAIL_DEBOUNCE_MS`, `LOG_TAIL_KEEPALIVE_MS`, `LOG_TAIL_POLL_FALLBACK` flag — main-only)

**Approach:**
- **New** controller `@Controller('logs')` + `@Sse('tail')` (own file) → route `/logs/tail` (reached at `/api/logs/tail`); resolve `logFilePath(assertLogStream(stream))` (R17). Return an Observable created via `defer` so the watcher/handle start only on subscription and tear down on `finalize()`.
- On subscribe: read the resume offset from `@Headers('last-event-id')` first, then the `?from=` query, else current EOF (`lastOffset = lastEventId ?? from ?? currentSize`; coerce non-negative and clamp to `[0, fileSize]`, mirroring U2's `anchor` clamp). Attach `fs.watch` **first**, then read+emit the backlog `[lastOffset, EOF)` as append-delta messages, then re-`stat` and drain `[lastOffset, newEOF)` once more — so a line appended between the backlog read and the watcher attach is not lost (the watcher only signals *future* changes). The debounced offset-vs-size idempotency makes the extra drain a no-op when nothing arrived.
- On debounced `change`: `stat`; handle `size < lastOffset` (truncation → reset) and inode change (rotation → reopen); positioned-read `[lastOffset, size)`; decode via persistent `StringDecoder`; prepend `pendingPartial`; split on `\n`; emit complete lines with `id = byteOffset`; retain trailing partial.
- Idempotent `cleanup()` bound to `finalize()`, watcher `'error'`, and `OnModuleDestroy`: abort the `fs.watch` `signal`, clear the debounce timer, close the handle.
- `fs.watchFile` polling path behind `LOG_TAIL_POLL_FALLBACK`.
- No auth code (global guard). Log `'log-tail-started'` on connect.

**Execution note:** Write the leak/teardown test first — assert zero `fs.watch` handles and zero pending timers after the subscription is torn down (the REVIEW.md #4 gap). Drive tail behavior with a temp file appended to during the test.

**Patterns to follow:** `apps/tdr-code/src/sse/sse.controller.ts` (`@Sse`, explicit `id`, keepalive merge, `finalize`), `apps/tdr-code/src/sse/sse-hub.service.ts` (create-on-transition / clear-once lifecycle, `new Observable(subscriber => { …; return () => cleanup() })`), `apps/tdr-code/src/console/reconcile.service.ts` (positioned read, trim-to-newline).

**Test scenarios:**
- Happy path (R5): append two complete lines to a watched temp file → two append-delta messages arrive with correct `byteOffset` ids and exact line text.
- Happy path (R16, resume): connect with `?from=<midOffset>` (first connect) or a `Last-Event-ID: <offset>` header (reconnect) → the backlog from that offset is emitted before live streaming begins; the header takes precedence over the query.
- Edge case (backlog→attach race): a line appended between the initial backlog read and the watcher attach is emitted exactly once (watcher-attached-first + post-attach re-drain).
- Edge case (partial-final-line; see the AE5 decision in Open Questions): a `change` fires with a half-written final line (no `\n`) → the partial is held and **not emitted live** (avoids flicker + in-place row growth / bug #1218); it emits once complete on the next append. AE5's literal "appears as raw, then upgrades" is satisfied by the windowed-read rendering of on-disk malformed/partial lines (Phase 1 U6), not by the live tail.
- Edge case (AE4): a burst of N appends emits N incremental messages, not one whole-tail blob.
- Edge case: duplicate `change` events for one write (kernel double-fire) produce at most one read/emit (debounce + offset-vs-size idempotency).
- Edge case (UTF-8): a multi-byte character split across two `change` reads decodes intact (persistent `StringDecoder`).
- Edge case (truncation): the file is truncated (`size < lastOffset`) → offset resets to 0, `pendingPartial` cleared, streaming resumes from the new content.
- Edge case (rotation): the file is renamed + recreated (new inode) → watcher reopens and follows the new file (`'log-tail-reopened'` logged).
- Error path (leak): tearing down the subscription closes the watcher + timer + handle (assert zero handles/timers); `OnModuleDestroy` tears down active connections.
- Error path (R17): unknown `stream` → `BadRequestException`, no watch started.
- Integration: route returns **401 without an auth cookie** (the assertion the DB-SSE lacked).

**Verification:** appended lines arrive as exact-text deltas with monotonic offset ids; partial/truncation/rotation/UTF-8 edges behave; **no watcher or timer survives disconnect**; unknown streams rejected; 401 when unauthenticated.

---

- U9. **Whole-file streaming scan engine (count + cursor-paginated match offsets)**

**Goal:** `GET /api/logs/search` streams the entire file once to compute an honest exact match count and returns match line byte-offsets cursor-paginated, applying structured filters and free-text as one composed predicate — never loading the file into memory, never materializing all offsets.

**Requirements:** R9, R10, R11, R20

**Dependencies:** Phase 1 U1 (predicate + search-response shapes), U2 (jump-to-hit reuses the windowed read)

**Files:**
- Create: `apps/tdr-code/src/logging/log-search.service.ts`
- Create: `apps/tdr-code/src/logging/log-search.service.spec.ts`
- Modify: `apps/tdr-code/src/logging/logs.controller.ts` (`@Get('search')`)
- Modify: `apps/tdr-code/src/logging/logs.controller.spec.ts`
- Modify: `apps/tdr-code/src/logging/logs.dto.ts` (search query: `stream`, `text?`, `level?`, `process?`, `event?`, `cursor?`; response: `{ total, matches: [{ byteOffset }], nextCursor }`)
- Modify: `apps/tdr-code/src/logging/log-view.types.ts` (`LogScanPredicate`, `LogSearchResponse`)
- Modify: `apps/tdr-code/src/logging/log-events.ts` (`'log-search-failed'`)

**Approach:**
- Controller parses/validates via `parseQuery` (encode/allowlist all params; coerce `cursor` non-negative and clamp to `[0, fileSize]`, mirroring U2's `anchor` clamp); delegates to `LogSearchService.scan(stream, predicate, cursor)`.
- **Snapshot the EOF at scan start** and pass that ceiling to the count pass and every subsequent cursor page — never read past it. This keeps `total` and the paginated offsets internally consistent even though the file grows during/after the scan (follow is on by default): without the ceiling, stepping past the loaded page would re-scan to a now-larger EOF and surface hits that were never counted in `total`. The count is a point-in-time value the UI labels as such (U11).
- Service streams the file in fixed blocks with a **carry-over remainder** (ripgrep-style): prepend remainder, split on `\n`, process complete lines, retain the trailing partial; flush the final remainder at EOF (as a raw line per R14).
- Per complete line: `parseLogLine` → apply structured filters in order (numeric `level >= threshold`; `process` equals/`both`; `event` slug equals) → apply text substring match (v1; regex behind the same predicate seam as a stretch). Count and hit-navigation are **per matching line** (one hit = one line containing ≥1 match), not per raw occurrence, so "hit i of N" and the stepped offsets share the same unit: `total++` and, if within the current page window starting at `cursor`, record one `{ byteOffset }` for the line. Stop the page at a bounded offset count; return `nextCursor` = resume byte offset.
- Malformed lines: text-searchable, excluded by any structured filter (no fields).
- `AbortController` wired so a superseding request cancels the scan (the client aborts on query change).
- Byte offsets tracked in bytes (`Buffer.byteLength`), never string length.
- Log `'log-search-failed'` on read errors.

**Execution note:** Test the carry-over/offset math first with a fixed multi-block fixture (a match straddling a block boundary must still be counted with the correct byte offset) — the classic streaming-search bug.

**Patterns to follow:** `apps/tdr-code/src/console/reconcile.service.ts` (block read, skip malformed), ripgrep's constant-buffer + partial-line carry-over, `apps/tdr-code/src/console/pagination.ts` (cursor shape).

**Test scenarios:**
- Happy path (R9): a term appearing 5 times across the file → `total: 5` with the first page of correct byte offsets.
- Covers AE2: a 200 MB fixture whose only match sits near the very top → `total: 1` and the offset points at that top line (count does not depend on what a client loaded).
- Edge case: a match spanning a block boundary is counted once with the correct offset (carry-over correctness).
- Edge case: `total` counts **matching lines** (a line containing the term twice counts as 1), consistent with the per-line hit-navigation unit — so "hit i of N" and stepping never disagree.
- Edge case (R20): the scan's peak memory stays bounded (one block + one line) on the 200 MB fixture, not proportional to file size.
- Edge case (scaling): a term matching a large fraction of lines returns an exact `total` but only a bounded first page of offsets + a `nextCursor`; fetching the next page resumes from the cursor without rescanning from the top.
- Edge case (growing file): with the scan anchored to a start-of-scan EOF snapshot, appending matching lines after the scan does not change `total` or surface uncounted hits when paging — `N` and the reachable hit set stay consistent.
- Covers AE6 (R11): `stream=backend`, `process=bot`, `level>=40`, `text='x'` → count and offsets reflect only bot warn+ lines containing `x`.
- Edge case (R14): a malformed line matches a text query (findable) but is excluded when any structured filter is active.
- Error path: aborting mid-scan (query changed) stops the file read (no leaked stream); unknown `stream` → `BadRequestException`.
- Integration: route returns 401 without an auth cookie.

**Verification:** counts are exact and whole-file (incl. AE2/AE6); offsets are byte-accurate and page correctly; memory bounded on huge files; aborts cancel the read; filters compose with text.

---

- U10. **Follow / pause / jump-to-latest (live tail client)**

**Goal:** Wire the tail stream into the Phase 1 viewer: follow-on-by-default with auto-scroll, auto-pause on scroll-up with a "N new" badge, and a jump-to-latest that resumes follow and snaps to the newest line — rendering bursts incrementally.

**Requirements:** R3, R4, R5

**Dependencies:** U8 (tail endpoint), Phase 1 U5 (bounded-window list), U6 (row)

**Files:**
- Create: `apps/tdr-code/src/app/logs/use-log-tail.ts` (EventSource hook, per-stream, leak-safe)
- Modify: `apps/tdr-code/src/app/logs/log-viewer.tsx` (follow state, append/evict on tail, badge, jump-to-latest)
- Modify: `apps/tdr-code/src/app/lib/api.ts` (`logTailUrl(stream, from)` — **`encodeURIComponent`** params)
- Create: `apps/tdr-code/src/app/logs/__tests__/use-log-tail.spec.tsx`
- Modify: `apps/tdr-code/src/app/logs/__tests__/log-viewer.spec.tsx`

**Approach:**
- `use-log-tail(stream, from, { onLine })`: one `EventSource` per `stream` mount (mirror `use-live-stream.ts` lifecycle — unstable callbacks held in a ref, effect keyed only on `[stream]`), listener for the `log-append` event and `keepalive`. Closed on unmount; never re-created on unrelated re-renders (the drawer-history lesson).
- Viewer: default `following = true`. On a tail line while `following` and `isAtEnd`, append (immutable) + evict top; `followOnAppend` (from the 3.14.5 bump) auto-scrolls to newest. When the user scrolls up (`!isAtEnd`), follow auto-pauses; tail events then only **increment a bounded "N new" counter** (do not append to the visible bottom or grow an unbounded pending buffer). "Jump to latest" re-fetches the tail window (`before` from current `fileSize`), `scrollToEnd()`, resets the counter, resumes follow.
- Reconnect: native `EventSource` auto-reconnect re-sends the server-set `Last-Event-ID` (each message `id` = its byte offset) to the same URL, so the tail server resumes from that header (U8) with no missed or duplicated lines. The client does **not** rebuild the URL on `onopen` (it cannot change a live `EventSource`'s URL); a manual close-and-reopen with a fresh `?from=` is used only for a deliberate re-seek (jump-to-latest).

**Execution note:** Drive the hook with a `MockEventSource` (mirror `apps/tdr-code/src/app/__tests__/use-live-stream.spec.tsx`) emitting `log-append` events; assert append/evict/badge behavior deterministically.

**Patterns to follow:** `apps/tdr-code/src/app/lib/use-live-stream.ts` (EventSource lifecycle, reconnect resync), `apps/tdr-code/src/app/__tests__/use-live-stream.spec.tsx` (MockEventSource), TanStack `followOnAppend`/`isAtEnd`/`scrollToEnd`.

**Test scenarios:**
- Covers AE1 (R3): with follow on and pinned at bottom, an appended line auto-scrolls the view to it.
- Covers AE1 (R4): scrolling up pauses follow and shows a "N new" badge that increments as lines arrive; "jump to latest" resumes follow and snaps to the newest line, badge resets.
- Covers AE4 (R5): a burst of appended lines renders incrementally (each line appended), not as one re-fetch/re-render.
- Edge case: while paused, the in-memory window stays bounded (the "N new" counter grows, not a pending line buffer).
- Edge case (leak): the tail `EventSource` is created once per stream mount and closed on unmount; a keystroke/re-render does not tear it down and recreate it.
- Edge case: switching tabs closes the inactive tab's tail (or suspends it) so idle tabs hold no live watcher.
- Integration: reconnect after a dropped connection resumes from the `Last-Event-ID` the server set (not a rebuilt query) with no missed or duplicated lines — assert against a simulated auto-reconnect that re-sends the header.

**Verification:** follow/pause/badge/jump match AE1; bursts render incrementally (AE4); the EventSource is leak-safe; the window stays bounded while paused.

---

- U11. **Search UI (hit i of N, jump-to-hit-in-context, highlight)**

**Goal:** A search bar that runs the whole-file scan, shows an honest "hit i of N", steps through matches (next/prev), and on selection loads the windowed context around the hit with the matched text highlighted in place.

**Requirements:** R9, R10

**Dependencies:** U9 (scan engine), Phase 1 U2 (windowed read for context), U5 (viewer), U6 (row highlight)

**Files:**
- Create: `apps/tdr-code/src/app/logs/log-search-bar.tsx`
- Modify: `apps/tdr-code/src/app/logs/log-viewer.tsx` (search state, hit navigation, jump-to-hit)
- Modify: `apps/tdr-code/src/app/logs/log-row.tsx` (highlight matched substring)
- Modify: `apps/tdr-code/src/app/lib/api.ts` (`api.searchLog(params)`, `queryKeys.logSearch(...)` — **encode params**)
- Create: `apps/tdr-code/src/app/logs/__tests__/log-search-bar.spec.tsx`

**Approach:**
- Debounced search input; on submit/debounce, call `api.searchLog({ stream, text, ...activeFilters, cursor })`; abort the prior request on change (client `AbortController`, matching U9's server-side abort).
- Show "hit i of N" using the exact `total` — a point-in-time count anchored to the scan-start EOF snapshot (U9), so `N` and the reachable hits stay consistent even as the file grows; show a subtle "file grew — re-run" affordance when EOF has advanced. next/prev move the hit index, fetching the next offset page via `nextCursor` when stepping past the loaded page.
- Selecting a hit loads the windowed **context** around its byte offset (`api.readLogWindow({ anchor, direction: 'around' })`), replaces/positions the viewer window there, `scrollToIndex(hitRowIndex, { align: 'center' })` in a window-keyed `useLayoutEffect`, and highlights the matched substring in the row (U6).
- **Reconcile with live tail (jump while following):** selecting a hit sets `following = false` and suspends tail-driven appends *into the window*; the tail may keep incrementing the "N new" badge (U10) but must not splice near-EOF byte offsets onto a mid-file window — that would break the monotonic `getItemKey = byteOffset` ordering the virtualization relies on (Phase 1 U5). "Jump to latest" (U10) is the only path back to an EOF-anchored window that resumes live appends.
- Loading treatment: while the whole-file scan runs (slower than a windowed read on a large file), show a scan-in-progress indicator on the search bar and do not flash the list empty (which reads as "0 results") until the scan resolves.
- Empty query clears search state and returns to raw mode.

**Execution note:** Mock `api.searchLog`/`api.readLogWindow` with fixtures; assert count display, hit stepping across page boundaries, and that jump loads the correct window + highlights.

**Patterns to follow:** `apps/tdr-code/src/app/events/page.tsx` (search/filter input idiom), TanStack `scrollToIndex` timing (window-keyed layout effect), `apps/tdr-code/src/app/lib/api.ts`.

**Test scenarios:**
- Covers AE2 (R9, R10): searching a term whose only hit is near the top of a large file shows "hit 1 of 1"; selecting it loads the top context window and highlights the match — search does not report 0 for unloaded content.
- Happy path: a term with 5 hits shows "N=5"; next/prev cycles 1→5→1; each selection loads the correct context window.
- Edge case: stepping past the loaded offset page fetches the next page via `nextCursor` without rescanning from the top.
- Edge case: changing the query aborts the in-flight scan and starts a new one; clearing the query returns to raw mode + live tail.
- Edge case (jump while following): with follow on, selecting a search hit turns follow off and loads the mid-file context; a tail line arriving afterward increments the "N new" badge and does **not** splice into the mid-file window (byteOffsets stay monotonic).
- Edge case: a query with zero matches shows "0 results" honestly (empty, not error).
- Edge case: highlight renders only the matched substring within the row; a match in a truncated `msg` still resolves in the detail panel.

**Verification:** counts are honest and whole-file (AE2); hit navigation + jump-to-context + highlight work across page boundaries; query changes cancel cleanly.

---

- U12. **Structured filters + detail-panel filter actions**

**Goal:** Filter controls for level, source/process (incl. `main`/`bot`/both within `backend`), and `event` slug that compose with search, switching the list to a filtered projection; plus the detail panel's "filter by this field/value" actions (completing R13).

**Requirements:** R11, R13 (filter-actions half)

**Dependencies:** U9 (scan predicate), U11 (composes with search), Phase 1 U7 (panel)

**Files:**
- Create: `apps/tdr-code/src/app/logs/log-filters.tsx`
- Modify: `apps/tdr-code/src/app/logs/log-viewer.tsx` (filter state → predicate; filtered-projection view mode)
- Modify: `apps/tdr-code/src/app/logs/log-detail-panel.tsx` (wire the deferred "filter by this field/value" actions)
- Modify: `apps/tdr-code/src/app/lib/api.ts` (predicate params on search/window)
- Create: `apps/tdr-code/src/app/logs/__tests__/log-filters.spec.tsx`
- Modify: `apps/tdr-code/src/app/logs/__tests__/log-detail-panel.spec.tsx`

**Approach:**
- `log-filters`: level `<select>` (≥ trace…≥ fatal), source/process `<select>` (for `backend`: `main`/`bot`/both; other tabs: none), `event` slug input/select. Filter state feeds the shared `LogScanPredicate`.
- When any structured filter is active, the viewer enters **filtered projection**: the list is driven by the scan's matching offsets (paged via `nextCursor`), each line rendered via the windowed read (or line content returned by the scan to save a round-trip — implementation choice). Free-text composes as an added predicate (AE6). Clearing all filters returns to raw mode + tail.
- **Empty result:** zero matching lines under an active filter shows a distinct empty state ("No lines match these filters"), separate from raw mode's per-tab empty state (U4) and from search's "0 results", and distinguished from the still-loading scan (hold the loading indicator until the scan resolves, per U11).
- **Liveness (chosen behavior — never a silently frozen view):** a filtered projection stays live. Evaluate the composed predicate against incoming tail lines (U10) client-side and append matches in real time so "errors-only" keeps updating as errors occur (the origin's follow-on-by-default intent). If live-append proves too costly in practice, the documented fallback is a visible "N new matches — refresh" affordance — not a stale list with no signal.
- **Malformed lines:** having no structured fields, they never appear in a filtered projection, and the detail panel's "filter by field/value" actions are disabled/hidden on a malformed line (nothing to filter by).
- Detail-panel actions: "filter by `process=bot`", "filter by `event=<slug>`", "filter by `level>=<n>`" set the corresponding filter and re-scan; this completes R13's deferred half from Phase 1 U7.
- Filters are per-tab state (R2), preserved across switches.
- `cns()`, `data-track-id` throughout.

**Patterns to follow:** `apps/tdr-code/src/app/events/page.tsx` (`<select>`/`<input>` filter bar, "Clear filters", `LEVEL_COLORS`), the Phase 1 detail-panel seam marked for these actions.

**Test scenarios:**
- Covers AE6 (R11): setting process=bot + level≥warn + a text term yields a filtered projection + count reflecting only bot warn+ lines matching the term across the whole file.
- Happy path: "errors-only" (level≥error) with no text shows only error/fatal lines, paged; count is the whole-file error total.
- Happy path (R13): clicking "filter by this event" in the detail panel sets the `event` filter and updates the list/count.
- Edge case: filters compose with search (both active) and with each other (level ∧ process ∧ event).
- Edge case (R2): filter state is preserved when switching tabs away and back.
- Edge case: clearing filters returns to the raw windowed view and resumes live tail.
- Edge case (empty): a filter with zero matching lines (e.g. level≥fatal with no fatal lines) shows the "No lines match these filters" empty state, distinct from a still-loading scan.
- Edge case (live): with a filter active, a newly-appended line matching the predicate appears in the filtered projection in real time (or increments a "N new matches" affordance in the fallback) — never a silently frozen list.
- Edge case: `event` filter excludes `debug` lines (no `event`) without treating them as malformed.

**Verification:** filters evaluate whole-file server-side and compose with search (AE6); filtered projection shows only matches; panel filter actions work; per-tab state preserved.

---

- U13. **Tail-path transport hardening (buffering-off + 401 fallback)**

**Goal:** Guarantee the tail streams unbuffered across every proxy hop and that an expired session surfaces instead of hanging the EventSource — verified through the real production chain.

**Requirements:** R18, R20

**Dependencies:** U8 (tail path exists), U10 (tail client)

**Files:**
- Modify: `apps/tdr-code/deploy/nginx.conf` (add a `location /api/logs/tail` block cloning the `/api/stream` buffering-off directives)
- Modify: `apps/tdr-code/src/app/logs/use-log-tail.ts` (consecutive-error → one authenticated request → 401/login latch)
- Modify: `apps/tdr-code/src/app/logs/__tests__/use-log-tail.spec.tsx` (401-fallback assertion)

**Approach:**
- Add the nginx `location /api/logs/tail` block mirroring `location /api/stream` (`proxy_buffering off; proxy_cache off; chunked_transfer_encoding off; proxy_read_timeout 3600s; proxy_set_header Connection '';`). The Next `/api/*` `X-Accel-Buffering: no` header and `@Sse()`'s own headers already cover the other two layers.
- Tail hook: after `CONSECUTIVE_ERROR_THRESHOLD` `onerror`s, fire one authenticated `request()` (e.g. `api.getLogSources()`) so a 401 triggers the existing `/login` latch instead of an infinite silent retry.
- **Manual verification through `tdr-code.lilnas.io`** with `curl -N` (chained-proxy header-stripping was the top risk in the shipped SSE work) — record the check in the PR.

**Execution note:** No unit test can prove the proxy chain; the buffering-off verification is a manual `curl -N` outcome recorded in the PR, plus a config review that the new `location` matches the working `/api/stream` block.

**Patterns to follow:** `apps/tdr-code/deploy/nginx.conf` (`location /api/stream`), `apps/tdr-code/next.config.js` (`X-Accel-Buffering` on `/api/*`), `apps/tdr-code/src/app/lib/use-live-stream.ts` (401 fallback).

**Test scenarios:**
- Happy path (client): after N consecutive `onerror`s, the hook fires one authenticated request (assert via mock) enabling the 401→/login redirect.
- Edge case: an occasional single `onerror` (normal reconnect) does not trigger the fallback (threshold respected).
- Test expectation: nginx/proxy buffering-off is verified manually via `curl -N` against the real chain (append a line server-side → the client receives it with no multi-second buffering delay) — recorded in the PR, not a unit test.

**Verification:** tail streams unbuffered end-to-end through the real chain; an expired session redirects to `/login` instead of hanging; the nginx block matches the proven `/api/stream` directives.

---

- U14. **Frontend-design polish pass**

**Goal:** Bring the Logs page to a first-class, polished finish across composition, typography, severity/motion cues, and copy — the origin's "reads as a native part of the console, not an afterthought" bar — now that live/search/filter interactions exist to polish.

**Requirements:** R1 (polish), R12 (visual refinement)

**Dependencies:** U10, U11, U12 (interactions to polish), Phase 1 U6 (rows), U7 (panel)

**Files:**
- Modify: `apps/tdr-code/src/app/logs/log-viewer.tsx`, `log-row.tsx`, `log-detail-panel.tsx`, `log-search-bar.tsx`, `log-filters.tsx`, `page.tsx` (visual/interaction refinement)

**Approach:**
- Run the frontend-design quality pass (composition, typography, color/severity contrast, motion, copy) against the console's existing dark/dense/monospace aesthetic — the origin's `/frontend-design` intent. Refine: the fixed row grid's column rhythm and severity legibility; follow/pause/badge and jump-to-latest affordances (subtle motion, no jank); search highlight contrast; filter-bar density; empty/loading/error copy; detail-panel layout.
- Verify against the real page via screenshots (headless browser) at representative states: streaming, paused-with-badge, search-with-hits, filtered projection, malformed lines, empty tab.
- No new heavy dependencies; hand-built idiom + `cns()`.

**Execution note:** This is a refinement pass, not new behavior — verify visually against screenshots of the running app rather than via new unit tests. Preserve all behavior/tests from U10–U12.

**Patterns to follow:** the console's existing pages (`events`, `sessions/[id]`, `/` live) for aesthetic tokens; `frontend-design` skill guidance; `packages/utils/src/cns.ts`.

**Test scenarios:**
- Test expectation: none (visual/interaction refinement) — verified via screenshots of representative states (streaming, paused+badge, search hits, filtered, malformed, empty) and by confirming U10–U12 behavior tests still pass. No behavioral change to assert.

**Verification:** the page reads as a first-class console surface at every state; severity/highlight/motion cues are legible and smooth; no regression in U10–U12 tests.

---

- U15. **Large-file perf validation + cross-cutting test hardening**

**Goal:** Prove the acceptance examples and close the test-coverage gaps the shipped SSE review flagged — large-file smoothness, honest search on huge files, incremental bursts, malformed-line live completion, auth on all new routes, and tail leak-freedom.

**Requirements:** R20 (validation), and hardening across R9–R11, R14, R16, R18

**Dependencies:** U8, U9, U10, U11, U12, U13

**Files:**
- Modify: `apps/tdr-code/src/logging/log-tail.service.spec.ts`, `log-search.service.spec.ts`, `logs.controller.spec.ts` (auth + leak + perf assertions)
- Modify: `apps/tdr-code/src/app/logs/__tests__/log-viewer.spec.tsx` (burst/perf/AE assertions)
- Create: `apps/tdr-code/src/logging/__tests__/logs-large-file.spec.ts` (generated large-fixture perf harness)

**Approach:**
- Generate a large temp fixture (hundreds of MB or a representative proxy sized to run in CI budget) and assert: windowed read + scan peak memory stays bounded (not ∝ file size) (R20, AE3); a scan finds a single top-of-file match with exact count (AE2); a burst tail renders incrementally (AE4); a half-written line is held then emitted once complete over the live tail, with the "raw then structured" rendering verified via the windowed read of an on-disk partial line (AE5, per the Open Questions decision).
- Add the **401-without-cookie** assertion to every new route (`/logs/window`, `/logs/sources`, `/logs/search`, `/logs/tail`) — the gap REVIEW.md flagged for `/api/stream`.
- Add/confirm the **tail teardown leak test** (zero `fs.watch` handles + zero timers after disconnect; `OnModuleDestroy` tears down active connections).
- Confirm **all client query/stream params are `encodeURIComponent`-encoded** (the REVIEW.md footgun) and shared constants live only in the U1 module (no cross-plane duplication).
- Clean up the generated fixture in `afterAll`.

**Execution note:** Run with the Node 24 PATH override (better-sqlite3 ABI). Size the "large" fixture to a CI-safe bound while still exercising the bounded-memory property; document the local-only larger run.

**Patterns to follow:** `apps/tdr-code/src/logging/browser-logs.service.spec.ts` (temp-file setup/teardown), `apps/tdr-code/jest.config.js` (backend/frontend projects), the REVIEW.md coverage checklist.

**Test scenarios:**
- Covers AE3 (R20): windowed read + scan on the large fixture keep peak memory bounded; the virtualized list keeps DOM node count bounded.
- Covers AE2: exact count + correct offset for a single top-of-file match on the large fixture.
- Covers AE4: a burst tail renders incrementally.
- Covers AE5 (per the Open Questions decision): the tail holds a half-written final line and emits it once complete; the "raw then structured" rendering is verified against the windowed read of an on-disk partial/malformed line (Phase 1 U6), not the live tail.
- Security: each new route returns 401 without an auth cookie.
- Leak: no `fs.watch` handle or timer survives a tail disconnect; `OnModuleDestroy` cleans up.
- Contract: all client params encoded; no duplicated cross-plane constants.

**Verification:** all origin acceptance examples for Phase 2 pass; every new route is auth-guarded; the tail is provably leak-free; large-file behavior is bounded; the REVIEW.md coverage gaps are closed.

---

## System-Wide Impact

- **Interaction graph:** The tail controller/service and scan service join the main-process-only `LogsModule` (never `BotModule`). The tail is a **new** SSE route **independent of** `SseController`/`SseHubService`/`NotifyBusService` — no shared hub, no shared signal bus (R16). The global `AuthGuard` auto-covers all new routes.
- **Error propagation:** Tail/scan failures log a registered `event` slug and surface as Nest exceptions or SSE error/teardown; the tail client's consecutive-error fallback converts a silent 401 hang into a `/login` redirect.
- **State lifecycle risks:** The `fs.watch` watcher, debounce timer, and file handle are per-connection long-lived handles — the primary risk surface (REVIEW.md #1). One-per-connection, torn down on every path, tested. While follow is paused, only a bounded counter grows — never an unbounded pending-line buffer. Appended lines are immutable (avoids TanStack bug #1218).
- **API surface parity:** All new endpoints follow the `console/` controller+DTO+service + `api.ts` typed-method + `queryKeys` conventions; the tail follows the `@Sse` + `EventSource` conventions from the shipped SSE work (explicit `id`, keepalive, reconnect resync, 401 fallback).
- **Integration coverage:** The proxy chain buffering-off (manual `curl -N`), the large-file bounded-memory behavior, and the tail leak-freedom are the cross-layer properties unit mocks can't prove — covered by U13's manual check and U15's harness.
- **Unchanged invariants:** `/api/stream` and its hub/bus are untouched. `log-paths.ts`, `log-events.ts` plane-neutrality, and write-time redaction are consumed as-is (only `LOGS_*` slugs added). No log file is written by the viewer. The Phase 1 raw windowed view is unchanged and remains the default (raw mode).

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| `fs.watch` handle/timer leak across many connect/disconnect cycles (the REVIEW.md #1 class) exhausts inotify watches. | One handle per connection created inside the Observable, `AbortController` signal, idempotent `cleanup()` on `finalize`/`error`/`OnModuleDestroy`; a mandatory zero-handles-after-disconnect test (U8/U15). |
| `fs.watch` misses appends on rotation (inode pinning) or exotic mounts (NFS/osxfs). | Inode-change detection → reopen; `LOG_TAIL_POLL_FALLBACK` (`fs.watchFile`) env flag for exotic mounts; both documented in U8. |
| Half-written final tail line renders corrupt or double-emits. | `pendingPartial` buffer + persistent `StringDecoder`; emit complete lines only; AE5 test over the live tail. |
| Search returns millions of offsets and blows memory (server or client). | Exact count from the streaming pass; offsets cursor-paginated (bounded page + `nextCursor`); bounded-memory scan test on the large fixture (U9/U15). |
| Match/line split across a read block boundary undercounts. | Carry-over remainder pattern (ripgrep-style); boundary-straddle test (U9). |
| Tail buffered somewhere in Traefik → nginx → Next → NestJS despite defense-in-depth. | Dedicated nginx `location` cloning the proven `/api/stream` block; manual `curl -N` verification through the real chain recorded in the PR (U13). |
| Expired session hangs the tail EventSource forever (401 retries). | Consecutive-error fallback fires one authenticated request → existing 401/login latch (U13). |
| TanStack streaming downward-drift (bug #1218) makes the tail "scroll itself." | Immutable appended lines (no in-place growth); pin via `followOnAppend`/`scrollToEnd`. |
| Local test/typecheck failure from the `better-sqlite3` Node-ABI mismatch. | Run specs/`tsc` with the Node 24 PATH override (see Institutional Learnings). |
| Unbounded concurrent tail connections or whole-file scans exhaust inotify watches / CPU (flat-admin trust lowers severity — every authenticated user is trusted). | Close inactive tabs' tails (U10); consider a per-session cap on simultaneous tails + in-flight scans as an operational guard. Low priority given the trust model, but the plan should not assume unbounded concurrency is free. |

---

## Open Questions

### Resolved During Planning

- **Tail mechanism** — `fs.watch` as signal + positioned read + `pendingPartial`/`StringDecoder` + debounce + truncation/inode handling + `fs.watchFile` fallback flag. (Origin [R5, R16].)
- **Search implementation** — two-phase streaming scan: exact count in one pass, cursor-paginated match offsets; substring v1, regex as a same-seam stretch; byte-accurate offsets; abortable. (Origin [R9, R10].)
- **Filters ↔ search composition** — unified via one scan predicate; filtered-projection view when structured filters are active, search-navigator (full-file context + jump-to-hit) for pure text search. This introduces an implicit view-mode switch, which sits in tension with origin Q1 ("search, filters, and scroll-back are always-present first-class controls, not a mode you switch into") — see the confirmation item under Deferred to Implementation. (Origin [R11], Q1.)
- **Tail buffering-off** — dedicated nginx `location /api/logs/tail` cloning the `/api/stream` block; Next + `@Sse()` layers already cover it; verified via `curl -N`. (Origin [R18, R20].)

### Deferred to Implementation

- Exact tail debounce interval, keepalive interval, and scan block size / offset-page size — tune against the real `backend.dev.log` and the large fixture.
- Whether the scan returns line *content* alongside offsets (saving a windowed-read round-trip in filtered projection) or just offsets — decide in U9/U12 by measuring the extra round-trip cost.
- **[Confirm — UX] The filter/search view-mode model.** Two decisions to validate before U11/U12 lock in: (1) whether a *lone text search* hides non-matches (filtered projection) or navigates in full-file context (current decision, per literal R10); (2) whether the implicit raw ↔ search-navigator ↔ filtered-projection mode switch is coherent given origin Q1's "not a mode you switch into" — or whether the three modes should converge. Both are small client-mode changes if reversed; flagged by the product, scope, and adversarial reviews as the key remaining UX judgment call.
- **[Confirm — renegotiates AE5] Live half-written-line rendering.** The chosen tail design holds a partial final line and emits it only once complete (avoids flicker + TanStack in-place-growth bug #1218), so AE5's literal "the half-written line appears as raw, then upgrades" is satisfied by the *windowed-read* rendering of on-disk partial/malformed lines (Phase 1 U6), not by the *live tail*. This is a small deliberate renegotiation of AE5's tail clause — confirm it's acceptable, or opt into provisional-raw-then-replace on the tail (which reintroduces in-place row growth) if literal live AE5 is required.
- Regex support — shipped only if it lands within the streaming scan without risking R20; otherwise a documented follow-up.

### Carried From Phase 1

- Phase 1 must land first: this plan extends U2 (windowed read), U5 (virtualized list), U6 (row), U7 (panel), and the U1 shared module — all prerequisites.

---

## Sources & References

- **Origin document:** [docs/brainstorms/2026-07-05-tdr-code-logs-page-requirements.md](../brainstorms/2026-07-05-tdr-code-logs-page-requirements.md)
- **Phase 1 plan:** docs/plans/2026-07-05-003-feat-tdr-code-logs-viewer-phase-1-plan.md
- Related code: `apps/tdr-code/src/sse/sse.controller.ts`, `apps/tdr-code/src/sse/sse-hub.service.ts`, `apps/tdr-code/src/app/lib/use-live-stream.ts`, `apps/tdr-code/src/console/reconcile.service.ts`, `apps/tdr-code/deploy/nginx.conf`, `apps/tdr-code/next.config.js`
- Review checklist: `REVIEW.md` (SSE migration — leak class, auth-test gap, param-encoding, cross-plane constants)
- Convention: `docs/solutions/conventions/tdr-code-structured-logging-convention-2026-07-03.md`
- External: [ripgrep write-up](https://burntsushi.net/ripgrep/), [ripgrep #566](https://github.com/BurntSushi/ripgrep/issues/566), [less(1)](https://www.man7.org/linux/man-pages/man1/less.1.html), [Node fs](https://nodejs.org/api/fs.html), [Node string_decoder](https://nodejs.org/api/string_decoder.html), [TanStack Virtualizer API](https://tanstack.com/virtual/latest/docs/api/virtualizer)
