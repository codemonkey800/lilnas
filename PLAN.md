# Theater — Phase 5: Seats + Video Sync

**Status:** Plan (no implementation yet) · **App:** `apps/theater` (`@lilnas/theater`)
**Depends on:** Phases 0–4 (shipped: physics scene, character select, Emby playback, multiplayer
presence + voice + tablet mirroring).
**Spec of record:** the Notion "Lilnas Theater" doc.

**This file is the design rationale** — why each unit exists, what the tradeoffs were, the measured
seat data, the risks. **`ORCHESTRATE.md` is the source of truth for interfaces, file ownership, and
the dispatch schedule**, and is what each `theater-impl` sub-agent reads before writing code. If the
two ever disagree, ORCHESTRATE wins on contracts and ownership; this file wins on *why*.

The Phase-4 pair these replace is in git history: `git show f5cad89:PLAN.md`, `git show
f5cad89:ORCHESTRATE.md`.

---

## Goal

Three features that finish the "watch a movie together" loop:

1. **Seats** — walk up to a seat, press a key, ease into it with a clamped look range, and see
   *other* people seated in their own seats. The gateway arbitrates occupancy so two people can
   never claim the same seat.
2. **Video sync** — play/pause/seek propagate to the whole room off one server-held anchor,
   including for someone who joins after the movie already started.
3. **A shared queue** — picking a title adds it to a room-wide queue rather than starting it
   outright. Anyone can jump to an entry, remove one, or reorder. The queue lives in the tablet UI.

**The tablet is the only control surface, and it is POV-only.** Fullscreen's native `<video>`
controls are removed outright (D4) and no tablet is reachable there (D7) — fullscreen is purely for
watching. Every transport action goes through the tablet, and therefore through the room. The
tablet stays usable while seated (D8).

Explicitly **out of scope** (Phase 6): GLB compression, MinIO asset hosting, HLS/transcode
fallback polish, a third-person camera toggle, seat colliders, and the Traefik deploy pass.

---

## What already exists (the seams this phase plugs into)

Phase 5 is unusually well set up. Most of the hard architecture is already built and explicitly
labelled as the Phase-5 seam:

- **The playback anchor model is done.** `src/playback/store.ts` already stores transport as
  `{ playing, playheadAtAnchor, anchorClockMs }` — never a per-frame playhead — derives the
  target via `getTargetPlayhead()`, reconciles the real `<video>` each frame in `tick()` (hard
  seek past 0.75 s drift, otherwise a ±10 % `playbackRate` nudge), and exposes
  **`applyAnchor({ playing, playhead, atClockMs })`** whose own comment says "a future gateway
  would instead drive it via `applyAnchor()`". Video sync is wiring, not a rewrite.
- **The gateway exists and is extensible.** `src/presence/presence.gateway.ts` authenticates the
  handshake off the signed session cookie, keeps an in-memory `roster: Map<socketId,
  PeerSnapshot>`, relays presence/RTC/tablet, and has a reusable per-socket `acceptRate()` flood
  guard. New events are additive.
- **Feature stores attach their own socket listeners.** `getSocket()` is exported from
  `src/multiplayer/store.ts` precisely so later features wire their own events without editing
  that file — `src/voice/peerConnections.ts` is the precedent.
- **`disableControl` + gravity freeze is already solved.** `Player.tsx` freezes the character
  while the iPad is open: `disableControl={ipadOpen}` on `<Ecctrl>`, plus a `useFrame` that pins
  `setGravityScale(0)` / zero linvel/angvel *every frame* (a one-time zero isn't enough — ecctrl's
  loop early-returns on `disableControl`, leaving gravity unopposed, and the character tunnels
  through the thin floor trimesh). Sitting needs exactly this machinery, generalized.
- **The per-peer composition root is Option B.** `RemoteAvatars.tsx`'s `<RemoteAvatar>` shell owns
  the interpolated `<group>` and mounts `<Avatar>/<NameTag>/<PeerVoice>/<RemoteIpad>` — each child
  runs its own `useFrame`. A seated peer changes how the shell computes that transform, not the
  children.
- **`peerTablets` is the pattern for a new per-peer React-visible map** — `peerSeats` copies it
  verbatim.

**Gaps this phase closes:**

- **No seat data anywhere.** No seat markers, no seat store, no occupancy. (`meshCollider.test.ts`
  mentions a `seats` node only as collider-exclusion fixture data.)
- **No sit animation.** `public/animations/` holds `idle`, `walk`, `walk-back`,
  `walk-strafe-left`, `walk-strafe-right` (+ an unrelated `twerk`). There is **no sit clip** — a
  hard asset dependency, resolved by D1/A1: three clips are staged (sit-down, sit-idle, stand-up).
- **Playback is single-player.** `IpadBrowser.selectItem()` calls `load()` then `play()` locally;
  nothing is broadcast, nothing is received, and the room has no video state.
- **No queue of any kind.** Selecting a title replaces whatever was playing, immediately. There is
  no room-level list, no ordering, and no notion of "what's next".
- **The tablet can't seek.** Its footer has play/pause, volume, quality and subtitles — no scrub bar.
  D4 makes the tablet the only control surface, so this becomes load-bearing.
- **Fullscreen hands the user native controls.** `FullscreenPlayer.tsx` sets `video.controls =
  true`, which D4 removes outright — leaving fullscreen a pure viewing surface with no controls and
  no tablet (D7). `Tab` becomes inert there and `F` closes the tablet on the way in, so the tablet
  never ends up stranded behind the overlay on a `frameloop="never"` canvas.

---

## Seat data — measured, not assumed

`cinema.glb` already contains **42 real seats: 6 rows × 7**, individually named mesh nodes. Verified
by parsing the GLB directly (it uses `EXT_meshopt_compression` + `KHR_mesh_quantization`, so
positions are normalized `SHORT`s that must be de-quantized before the node scale is applied — a
naive read gives coordinates ~32767× too large).

Per seat the model carries a cushion (`垫`), base (`底`), backrest (`靠背`), and wooden backrest
(`靠背_木头`) — 42 of each. The armrest/frame families (`侧中`, `侧框`, `木头扶手`, `铁支`,
`铁脚底`) have **48** each: 8 dividers bounding 7 seats per row. **The `垫` (cushion) family is the
seat anchor** — one per seat, exactly 7 per row.

World-space coordinates **after `Theater.tsx`'s recentering** (`model.position.set(-center.x,
-box.min.y, -center.z)`, i.e. lowest model point at `y = 0`):

| row | z | cushion-top y |
|----|---------|-------|
| 0 (front, nearest screen) | +0.713 | 1.178 |
| 1 | −0.137 | 1.478 |
| 2 | −0.987 | 1.778 |
| 3 | −1.837 | 2.078 |
| 4 | −2.687 | 2.378 |
| 5 (back) | −3.537 | 2.678 |

Columns, identical in every row: `x = −2.350, −1.909, −1.467, −1.026, −0.585, −0.144, +0.296`.

Seat pitch **0.441 m**, row pitch **0.850 m**, rake **+0.300 m/row** (floor and seats rake
together, so cushion-height-above-floor is constant across all six rows).

**Facing:** the screen is at the **+Z** end (`TheaterScreen.tsx`; backrests sit at more-negative Z
than their own cushion), so every seat faces +Z ⇒ **`yaw = 0`** in the convention already shared by
`LocalPresence` (`atan2(dir.x, dir.z)`) and `RemoteAvatar` (`group.rotation.y = yaw`).

For orientation: `Player.tsx`'s spawn is `[2.19, 1.13, −3.62]` — back-right, outside the seat block
(seats span x ∈ [−2.35, +0.30]).

**Seats have no colliders today** (`Theater.tsx` only trimeshes `/floor/i` and `/wall|frame/i`), so
the player currently walks straight through them. Phase 5 should **keep it that way** — adding seat
colliders would make standing up inside a seat a trap. Note it for Phase 6.

---

## Decisions

All settled 2026-07-25. No open decisions blocking dispatch.

- **D1 — sit animation assets: three clips, not one.** `sitting-down.fbx` (standing → seated),
  `sitting-idle.fbx` (the seated loop), `stand-up.fbx` (seated → standing) are staged for
  conversion. This buys real transitions instead of a pop, and it reshapes three units: A1 converts
  three files, `<Avatar>` needs a small one-shot/loop state machine (F5), and the local camera
  should *ease* into and out of the seat over the transition rather than teleport (F4).
- **D2 — video control: anyone can control, including the queue.** Last-write-wins, no host
  concept, no per-user permissions: any member can enqueue, jump, remove, reorder, seek, play, and
  pause for the whole room.
- **D3 — look clamp while seated: yaw ±75° / pitch ±45°** around the seat's facing. Glance at your
  neighbour, don't spin to face the back wall.
- **D4 — no video controls outside the tablet.** `FullscreenPlayer.tsx`'s
  `video.controls = true` is deleted; no custom bar replaces it. The tablet is the single control
  surface, and every transport action therefore goes through `video:command` and moves the whole
  room. This also removes the entire class of "native control writes `currentTime`, `tick()` yanks
  it back" bugs rather than working around them. The tablet gains **seeking** (it only has
  play/pause today).
- **D5 — `E` toggles sit/stand.** Press near a free seat to sit, press again to stand. A "Press E to
  sit" / "Press E to stand" prompt shows the current affordance.
- **D6 — the queue is a playlist with a cursor, not a consuming queue.** A finished entry stays in
  the list; only `currentEntryId` moves forward. You can jump back to something already watched, and
  removal is always explicit. (The alternative — pop-on-finish — makes "wait, play that again" a
  re-search.)
- **D7 — the tablet is POV-only; fullscreen is a pure viewing surface.** No controls and no tablet
  in fullscreen at all: `Tab` is inert there, and entering fullscreen closes the tablet if it was
  open. To change anything you press `F` to drop back to POV and use the tablet. This keeps the
  tablet rendering in exactly one place (drei `<Html>` inside `<Canvas>`) — no second DOM host, no
  shared prop-assembly hook, no reasoning about a frozen `frameloop="never"` canvas.
- **D8 — the tablet is usable while seated.** Sitting must not lock you out of the only control
  surface. Two consequences, both in F4: `frozen` already covers seated *and* tablet-open, so the
  character stays put either way; but `<SeatedCamera>` must only accumulate look input **while
  pointer lock is held**, since `openIpad()` releases it. Without that check, moving the mouse to
  click a tablet button would swing the seated view — a bug ecctrl doesn't have, because it already
  gates its own rotation on `document.pointerLockElement`.
- **D9 — sitting requires proximity AND gaze, not proximity alone.** `E` claims whichever free seat
  is (a) within `SEAT_TARGET_MAX_DISTANCE_M` and (b) the one you're most centered on among any that
  qualify — reusing `Scene/gaze.ts`'s cosine-alignment test (already built for nametags) against
  each seat's cushion position rather than a peer's head. This is what disambiguates two seats
  0.44 m apart: whichever has the better alignment wins, so aim does the picking, not just distance.
  See F1 (the targeting function) and F4 (the per-frame publish + `E`'s consumption of it) — this
  reshapes both from the original proximity-only design.

---

## Shared data contracts (lock before splitting work)

Additive to Phase 4's protocol. Short keys on the hot path, readable names on room events.

```ts
// ── Seats ────────────────────────────────────────────────────────────────────
// seatId format: `r{row}s{col}`, e.g. 'r0s3' — stable, derived from the seat table.

// Client → server, ack'd RPC (the server is the arbiter; the client does NOT
// assume success):
'seat:claim'   → { seatId: string }   → ack: { ok: true } | { ok: false; reason: 'taken' | 'unknown' }
'seat:release' → {}                   → ack: { ok: true }

// Server → the rest of the room, on any successful claim/release AND on the
// disconnect of a seated peer:
'peer:seat' → { id: string; seatId: string | null }

// PeerSnapshot gains one field (so late joiners see who is seated where):
type PeerSnapshot = { id; username; characterId; p; y; a; muted?; tablet?;
                      seatId?: string | null }
```

**`seatId` — not an `AnimState` — is the single source of truth for "is sitting."** Phase 4's
contract pencilled in a 6th wire state `'sitting'`; deriving it instead means the two can never
disagree, and it keeps `PresencePacketSchema` untouched. `<Avatar>`'s *client-side* `AnimState`
union gains three states — `'sit_down'`, `'sitting'`, `'stand_up'` — but **none of them ride the
wire**. Each client runs the same local state machine off the seat transition it observes:

```
peer:seat { seatId: 'r2s4' }  ⇒  sit_down (one-shot) ──▶ sitting (loop)
peer:seat { seatId: null }    ⇒  stand_up (one-shot) ──▶ idle ──▶ normal locomotion
```

**Transition vs. steady state is the one subtlety.** A peer already seated when you join arrives via
`peers:init`/`peer:join` with `seatId` already set — that is a *steady state*, not a transition, and
must render straight into `sitting` with no sit-down replay. Only a `peer:seat` event observed on an
already-known peer starts a one-shot. Same rule locally: reconnecting into your own held seat
shouldn't replay the animation.

A seated player stops broadcasting `presence` entirely (they aren't moving, and every client
computes the seated transform from `seatId` + the shared seat table). Presence resumes on stand.
Because the whole sit/stand sequence is client-local, its duration never has to be synchronised —
two clients may be a frame or two apart in the animation and nothing drifts.

```ts
// ── Video sync + queue ───────────────────────────────────────────────────────
type QueueEntry = {
  entryId: string              // server-generated (randomUUID) — NOT the itemId
  itemId: string               // Emby item id (a movie, or an episode)
  title: string
  subtitle: string | null      // "2019" for a film, "The Bear · S2E4" for an episode
  imageTag: string | null      // poster, via the existing image endpoint
  runTimeTicks: number | null
  addedBy: string              // username, taken from the socket's session — never client-supplied
}

// Client → server; any member may send (D2). Last-write-wins.
'video:command' → { kind: 'enqueue'; entry: Omit<QueueEntry, 'entryId' | 'addedBy'> }
                | { kind: 'remove';  entryId: string }
                | { kind: 'move';    entryId: string; beforeEntryId: string | null }  // null = to end
                | { kind: 'jump';    entryId: string }
                | { kind: 'next';    afterEntryId: string }
                | { kind: 'play' }
                | { kind: 'pause' }
                | { kind: 'seek';    playhead: number }

// Server → the WHOLE room (sender included, so everyone converges on one anchor),
// and both once to each joining client:
'video:state' → { currentEntryId: string | null; currentItemId: string | null
                  playing: boolean; playhead: number }
'queue:state' → { queue: QueueEntry[] }
```

**Two events, not one.** Transport changes (play/pause/seek) fire far more often than the queue
array changes; folding the whole queue into every `video:state` would re-send it on every pause.
`queue:state` goes out only when the array itself changes.

**`entryId` ≠ `itemId`, and the cursor is an `entryId`, not an index.** Both matter:

- the same title can legitimately be queued twice, so `itemId` is not a handle;
- **reorder and remove must address entries by id, never by position** — two clients removing
  simultaneously against shifted indices delete the wrong rows;
- storing the cursor as `currentEntryId` rather than `currentIndex` means reordering the queue can
  never change *what is playing*, which an index-based cursor does silently.

**`next` carries `afterEntryId` so auto-advance needs no leader election.** Every client's `<video>`
fires `ended` at roughly the same moment and all of them emit `next`; the server applies the first
and ignores the rest, because `currentEntryId` no longer matches the `afterEntryId` they sent. Self-
correcting, no designated emitter, no server-side duration timer. The same command backs the manual
"skip" button.

**Enqueue metadata is client-supplied, deliberately.** The gateway *could* look the title up through
`EmbyService`, which would be more authoritative — but that makes a socket handler async and adds a
failure mode (Emby down ⇒ can't queue). The client already has the metadata: it just rendered the
tile that was clicked. Validate with bounded string lengths, exactly as `tablet.schema.ts` already
does for client-supplied search text. `addedBy` is the one field the server fills in itself, from
the session — so it can't be spoofed.

**No timestamp on the wire, deliberately.** The server advances the anchor to *broadcast* time
before sending (`playhead + (Date.now() − atServerMs)/1000` when playing) and each client re-anchors
against its own `performance.now()` on receipt — which is exactly `applyAnchor`'s existing
signature. The residual error is one-way network latency (single-digit to low-tens of ms at home),
which is immaterial for a movie and far inside `tick()`'s 0.05 s negligible-drift band. This
sidesteps the fact that `performance.now()` is a per-process monotonic clock with **no** cross-machine
meaning. If sub-frame accuracy is ever wanted, add NTP-style offset estimation later — the wire
shape doesn't change.

**No loops:** the store's local `play()`/`pause()`/`seek()` never emit. `video:command` is the only
emitter; `video:state → applyAnchor()` is the only anchor mutator (with one deliberate exception,
the initiator's optimistic local apply — see F6's gesture note).

---

## Asset units (local, one-time)

### A1 — convert the three sit clips (D1)

Convert each staged FBX beside the existing clips with the app's Blender-backed CLI (local-only
asset tooling; nothing here runs in Docker or at runtime):

```
pnpm --filter @lilnas/theater convert ~/Desktop/models/sitting-down.fbx public/animations/sitting-down.glb
pnpm --filter @lilnas/theater convert ~/Desktop/models/sitting-idle.fbx public/animations/sitting-idle.glb
pnpm --filter @lilnas/theater convert ~/Desktop/models/stand-up.fbx      public/animations/stand-up.glb
```

**Already verified against the staged FBX files (2026-07-25) — don't re-derive:**

- All three are present, valid `Kaydara FBX Binary` v7700.
- **Bone names are BARE — zero `mixamorig` occurrences in any of the three** (`Hips`, `Spine`,
  `Spine2`, `LeftUpLeg`, `RightUpLeg`, `LeftArm`, `LeftFoot`, `Head`, plus ~40 finger joints, no
  twist bones). This is the same shape as the strafe clips, so `Avatar.tsx`'s existing
  `withMixamoPrefix()` is **required, not conditional** — without it none of the three bind to
  anything. The extra finger joints are harmless: three's `PropertyBinding` silently drops tracks
  that resolve to no bone, which is already how the strafe clips behave on the simpler rigs.
- **Animation-only, no bundled mesh** (`Vertices=0`, `Deformer=0`), matching all six shipped clips
  (every one has `meshes=0`). So **no mesh-strip step is needed** — `blender_convert.py` exports the
  whole scene with no stripping, which is fine precisely because there's nothing to strip.
- Each carries one anim stack named `mixamo.com` — the same collision-prone default the existing
  clips have. `buildClip` already renames every clip to its `AnimState` key, so this is handled.

What A1 still has to confirm after converting, the same way the strafe clips were checked — load
through the **real** GLTFLoader and inspect `Bone.name` / clip track names, never the raw glTF JSON
(the loader sanitizes `:` out of `mixamorig:` names, so the JSON is misleading):

- the first clip (`.animations[0]`) is the intended motion;
- **record each clip's `duration`** — F4's camera ease and F5's one-shot handoff both key off it.
  A1 writes them to `src/components/Scene/clipTimings.ts` as `SIT_DOWN_DURATION_S` /
  `STAND_UP_DURATION_S`, with a comment naming the source GLB each was measured from;
- all three bind on **every** selectable character, including the RPM-rigged Charlie.

**Root motion is discarded.** `Avatar.tsx` runs every clip through `stripToRotation`
(quaternion-only), because the parent group's transform is network-driven and any retained root
track would double-move the avatar (and the shipped assets carry a known ~100× root-motion units
bug, per `clipTracks.ts`). That matters more for these three than for the walk cycles: a Mixamo
sit-down normally *steps backward* into the chair via root motion, so with it stripped the character
will appear to lower itself in place at the seat position instead. Expect that to look acceptable;
if it doesn't, the fallback is to interpolate the group position from the standing spot to the seat
across the clip's duration (F5), not to reinstate the root track.

---

## Backend units (NestJS)

Single-owner rule from Phase 4 still applies: **`presence.gateway.ts` has exactly one writer per
batch.** B1 (schemas) and B2 (queue helpers) never touch it and run concurrently in Wave 1; B3a and
B3b are the same track, dispatched sequentially in Wave 2 (`ORCHESTRATE.md` §2/§4).

### B1 — schemas + constants

Everything the gateway validates against, so B3 can be pure state + broadcasts. Owns
`src/presence/seat.schema.ts` (new), `src/presence/video.schema.ts` (new),
`src/presence/tablet.schema.ts` (widen `view` with `'queue'`), and
`src/presence/presence.constants.ts`.

- `SeatClaimSchema` = `{ seatId: z.string().max(16) }`. Bound the length, per the existing security
  checklist.
- `SEAT_IDS: Set<string>` — the 42 valid ids, built by a `6 × 7` loop over the `r{row}s{col}`
  format rather than imported from F1's generated table. The format is deterministic, so the two
  agree without a cross-boundary import — same hand-mirroring convention as
  `VALID_CHARACTER_ID_LIST`. An unknown `seatId` is rejected `{ ok: false, reason: 'unknown' }`,
  never stored.
- `VideoCommandSchema` — a discriminated union over the eight kinds. Bound every string (ids 128
  like the tablet schema; `title`/`subtitle` ~200); `playhead` and `runTimeTicks` are non-negative
  `z.number()` (zod v4's base `z.number()` already rejects `NaN`/`±Infinity` — `tablet.schema.ts`
  documents this). Define the `enqueue` payload as an **explicit zod object**, not an import of
  B2's `QueueEntry` — that's what lets B1 and B2 run concurrently.
- Rate-limit floors for the new message kinds, alongside the existing ones.

### B2 — queue mutations (pure)

`src/presence/queue.ts` (new) — the canonical home of the `QueueEntry` type plus four pure exported
functions the gateway calls: `applyEnqueue`, `applyRemove`, `applyMove`, `applyNext`. No socket, no
Nest, no I/O.

This split exists because the queue's edge cases are where the bugs live, and they're all testable
without standing up a gateway. It also keeps B3 thin — the one file the single-writer rule says
only one unit may touch.

### B3a — gateway: seat occupancy

Schema and `SEAT_IDS` are B1's. This unit is `presence.gateway.ts` only:

- `private readonly seats = new Map<string, string>()` — `seatId → socketId`.
- `@SubscribeMessage('seat:claim')` — validate; reject unknown ids; reject if `seats.has(seatId)`
  **and** the holder is someone else (re-claiming your own seat is a no-op success). Release the
  caller's previous seat first (a claim implies a move), then set `seats`, set
  `roster.get(client.id).seatId`, broadcast `peer:seat`, and **return** the ack. Returning a value
  from a `@SubscribeMessage` handler is how Nest replies to a client `emit(..., cb)`.
- `@SubscribeMessage('seat:release')` — clear both maps, broadcast `peer:seat` with `seatId: null`.
- `handleDisconnect` — **must** free the seat and broadcast, or seats leak permanently on a tab
  close. This is the single most likely bug in the phase.
- `PeerSnapshot` gains `seatId?: string | null`; `handleConnection` seeds it `null`.
- Claims need no `acceptRate` throttle of their own (they're user-driven keypresses), but adding a
  generous floor is cheap insurance against a scripted client thrashing the room with `peer:seat`
  broadcasts.

### B3b — gateway: room video state + queue

Validation is B1's `video.schema.ts`; the queue mutations are B2's `queue.ts`. This unit is
`presence.gateway.ts` only:

- `private roomVideo = { queue: [] as QueueEntry[], currentEntryId: null, playing: false,
  playhead: 0, atServerMs: Date.now() }`.
- Two private broadcasters — `broadcastVideoState()` (advances the anchor to *now* when playing;
  resolves `currentItemId` from the queue so clients don't have to) and `broadcastQueueState()`.
  Both go to the **whole room including the sender** (`this.server.to(THEATER_ROOM)`, not
  `client.to(...)`) so everyone converges on one anchor.
- `@SubscribeMessage('video:command')`, one branch per kind:
  - `enqueue` — `randomUUID()` for `entryId`, `addedBy` from `client.data.username`, append. **If
    `currentEntryId === null`, also make it current and start playing** — otherwise adding the very
    first title does nothing visible, which reads as broken. Broadcast both events.
  - `remove` — drop by id. If it was current, advance the cursor to whatever *followed it in the
    pre-removal order* (capture that before splicing), or `null` + stop if it was last.
  - `move` — splice out, reinsert before `beforeEntryId` (or append if `null`). Never touches
    `currentEntryId` (D6/contracts). A `beforeEntryId` that doesn't exist is a no-op, not an error.
  - `jump` — set `currentEntryId`, playhead 0, keep `playing`.
  - `next` — **apply only if `currentEntryId === afterEntryId`**, else silently ignore (the
    auto-advance dedup; see contracts). Advance to the following entry, or stop at the end.
  - `play` / `pause` — re-anchor at the advanced playhead.
  - `seek` — set the playhead, keep `playing`.
  Then `acceptRate` with a modest floor — a scrub UI can fire fast.
- `handleConnection` — emit both `video:state` and `queue:state` to the joiner (alongside
  `peers:init`). That is the whole late-join story.
- Reset `roomVideo` (queue included) when the room empties, so tomorrow's session doesn't inherit
  today's playlist and playhead.

The queue mutations themselves are **B2's** pure helpers (`applyEnqueue`/`applyRemove`/
`applyMove`/`applyNext`); B3b holds state and broadcasts, and does not reimplement them.

### B4 — gateway tests

Extend `src/presence/__tests__/presence.gateway.test.ts` (583 lines, established harness):

- claim succeeds → `peer:seat` broadcast + roster `seatId` set;
- **second claim on a held seat is rejected** and does not disturb the holder;
- claiming while already seated releases the old seat;
- unknown `seatId` rejected;
- **disconnect frees the seat and broadcasts**;
- `video:command` mutates room state and broadcasts to the whole room *including* the sender;
- a joining socket receives the current `video:state` **and** `queue:state`;
- the playhead a paused room reports doesn't advance, and a playing room's does.

**B2 owns its own test file** (`src/presence/__tests__/queue.test.ts`) — a pure-unit suite, no
socket needed, covering where the queue's real edge cases live:

- enqueueing into an **empty** room sets the cursor and starts playing; enqueueing into a playing
  room only appends;
- removing the **current** entry advances the cursor to the one that followed it; removing the
  **last** entry while it's current stops playback (`currentEntryId → null`);
- removing a non-current entry never disturbs the cursor;
- `move` never changes `currentEntryId`, including when the current entry is the one moved;
- `move` with `beforeEntryId: null` appends; with an unknown id it's a no-op;
- **two `next` commands with the same `afterEntryId` advance exactly once** (the auto-advance
  dedup);
- `next` at the end of the queue stops rather than wrapping;
- the same `itemId` enqueued twice yields two distinct `entryId`s, and removing one leaves the other.

---

## Frontend units (React / R3F)

### F1 — the seat table *(no deps; do this first)*

A generator script + a generated data module. Deriving at runtime instead would mean CJK regexes in
app code and re-doing the de-quantization work on every page load, for data that is fixed the moment
the GLB is.

- `scripts/seats.ts` — reads `public/models/cinema.glb`, de-quantizes (`normalized` `SHORT` ⇒
  `max(v/32767, −1)`), composes node world matrices, collects the `垫` family's world-space bbox
  centers, sorts into rows (descending z = front to back) and columns (ascending x), and writes the
  table. Run once, committed; re-run only if the GLB changes. Add a `seats` script to
  `package.json` beside `convert`.
- `src/components/Scene/seats.ts` (generated, committed) — `export const SEATS: Seat[]` where
  `Seat = { id: string; row: number; col: number; cushion: [number, number, number]; yaw: number }`,
  plus the two hand-tuned constants that turn a cushion anchor into the two things the app actually
  needs:
  - `SEATED_EYE_ABOVE_CUSHION = 0.65` — local camera height when seated.
  - `CUSHION_ABOVE_FLOOR = 0.45` — subtract to get the avatar's feet-origin y for a remote seated
    peer (`<Avatar>` recenters feet to the group origin).
  Both are eyeballed starting values, documented as needing one visual pass — the app's established
  convention for "no live browser to measure against" (cf. `Avatar.tsx`'s `NATURAL_SPEED_MPS`).
  **Seat geometry only** — the sit/stand clip durations live in `Scene/clipTimings.ts`, owned by A1
  (they're a measurement output of the conversion, so the unit that converts records them; that's
  also what lets A1 and F1 run concurrently).
- Two more exported constants (D9), same "eyeballed, tune later" convention as the two above:
  - `SEAT_TARGET_MAX_DISTANCE_M = 2.2` — how close you must be to claim a seat. Roomy enough to
    claim while still approaching, tight enough that you can't reach across an aisle.
  - `SEAT_TARGET_MIN_ALIGNMENT_COS = Math.cos(35°)` — the floor for "are you looking roughly at the
    seat block at all," deliberately loose (contrast `gaze.ts`'s tighter 12° nametag cone) since the
    *choice* of which seat is made by best-alignment-wins, not by this threshold — this only
    excludes "looking at the ceiling while standing near a seat."
- Pure helpers, unit-testable (this repo's jest can't import `.tsx`, hence a plain `.ts`; imports
  `gazeAlignment` from the sibling `./gaze` rather than reimplementing the dot product):
  `getSeat(id)`, and (D9, replacing a proximity-only `findNearestFreeSeat`)
  `findGazedFreeSeat(camPos, camForward, occupiedIds)` → `Seat | null` — among free seats within
  `SEAT_TARGET_MAX_DISTANCE_M`, returns whichever has the best `gazeAlignment` against its
  `cushion`, or `null` if even the best doesn't clear `SEAT_TARGET_MIN_ALIGNMENT_COS`. No
  occlusion raycast (unlike `NameTag.tsx`'s gaze test) — the whole seating block is one open room
  well inside the max distance, so "in range" already implies "not behind a wall."

### F2 — `src/seats/store.ts` (local seat state)

Mirrors `src/voice/store.ts`: a small zustand store for *local* state only, emitting through
`getSocket()`.

- State: `mySeatId: string | null`, `pending: boolean`.
- `claim(seatId)` — emit `seat:claim` with an ack callback; set `mySeatId` **only on
  `{ ok: true }`**. Never optimistic: an optimistic sit that loses the race puts two avatars in one
  chair until the correction lands. `pending` blocks a second claim mid-flight.
- `release()` — emit `seat:release`, clear `mySeatId`.
- On socket teardown/`disconnect`, clear `mySeatId` so a reconnect doesn't think it's still seated.

### F3 — `peerSeats` in `src/multiplayer/store.ts`

The one edit to that file. Copy the `peerTablets` pattern exactly:

- `peerSeats: Record<string, string>` in the React-visible state (seat changes are rare, so `set()`
  is correct here — this is not a hot path).
- `isPeerSeatPayload()` validator alongside the existing ones.
- A `peer:seat` handler that sets or deletes the entry.
- Seed from `PeerSnapshot.seatId` in both `peers:init` and `peer:join`; delete in `peer:leave`;
  clear in the deferred teardown alongside `peerTablets`.
- Widen the local `PeerSnapshot` type mirror with `seatId?: string | null`.

### F4 — seated local player (`Player.tsx` + a seated camera controller)

The trickiest unit. Two halves:

**Freeze (`Player.tsx`)** — generalize the existing iPad freeze from one boolean to two:
`const frozen = ipadOpen || seated`, used for both `disableControl={frozen}` and the per-frame
`setGravityScale(0)` / zero-velocity block, restoring `DEFAULT_GRAVITY_SCALE` on the falling edge.
Do not restructure that block; its every-frame behavior is load-bearing (see its comment). On sit,
also `setTranslation()` the body to the seat's floor position so standing up leaves you at the seat
rather than wherever you pressed the key.

**Seated camera (`src/components/Scene/SeatedCamera.tsx`, new)** — mounted inside `<Canvas>`, active
whenever the local player is not fully standing. Because D1 gives real sit-down/stand-up
animations, the local camera should **ease, not teleport** — otherwise your own view snaps into the
chair while everyone else watches your avatar take a second to lower itself. Four local phases,
mirroring the wire-free state machine in the contracts section:

- `sit_down` — over the `sitting-down.glb` clip duration (A1 records it), ease `camera.position`
  from wherever ecctrl left it to `cushion + SEATED_EYE_ABOVE_CUSHION`, and ease the clamp bounds
  in from wide-open to D3's limits so the view is never yanked mid-turn. Use a smoothstep, not a
  linear lerp — a linear position ramp reads as a mechanical slide.
- `sitting` — pin `camera.position` to the seat eye point each frame; own rotation from a
  `mousemove` listener, accumulating yaw/pitch clamped to D3's ±75°/±45° around the seat's
  `yaw = 0`, written via `camera.rotation.set(pitch, yaw, 0, 'YXZ')` (`YXZ` order, so pitch never
  rolls the horizon). **Accumulate only while `document.pointerLockElement` is set** (D8) — the
  tablet releases pointer lock on open, and without this check every mouse movement aimed at a
  tablet button would swing the seated view. ecctrl already gates its own rotation exactly this way;
  match it.
- `stand_up` — ease back to standing eye height over the `stand-up.glb` duration, releasing the
  clamp as it goes.
- `standing` — unmounted; ecctrl owns the camera again.

Owning the camera is safe *because* ecctrl's frame loop early-returns under `disableControl` and
therefore never writes it — the same property `ipadOpen` already relies on. The stand-up ease is a
bonus here: it gives a natural window to reseat ecctrl's camera state before handing control back,
which is the phase's main unknown (see risks).

**Transitions are non-interruptible.** `E` is ignored while `sit_down`/`stand_up` is in flight —
simpler than queueing, and the windows are under a second. `frozen` must stay true for the whole of
both, not just the seated steady state, or the character starts falling mid-animation.

**`LocalPresence.tsx` is also F4's** (one line of behaviour): skip emitting `presence` entirely
while seated, exactly as it already does while `ipadOpen`. A seated player isn't moving, and every
client derives the seated transform from `seatId` + the shared seat table instead.

**Seat targeting (`src/components/Scene/seatTargeting.ts`, new, also F4's) — the gaze+proximity
check from D9, and the architectural piece that check needs.** `viewControls.ts` handles `E` via a
plain `window.addEventListener('keydown', ...)` (see `useViewControls`'s existing shape) — it has
no access to the camera, because it isn't rendered inside `<Canvas>`. Something has to continuously
answer "which free seat, if any, passes D9's test right now" from *inside* Canvas, and publish that
answer somewhere the keydown handler can read it synchronously.

This app already has the exact pattern for that: `playerVelocity.ts` is a plain module-level
mutable object, written every frame by `Player.tsx`'s `useFrame`, read by `LocalPresence.tsx`
outside any parent/child relationship to it. `seatTargeting.ts` copies that shape:

```ts
export const seatTargetRef: { current: string | null } = { current: null }
export function useSeatTargeting(): void   // mounted in Canvas by F8; owns the per-frame useFrame
```

`useSeatTargeting()`'s `useFrame` reads `state.camera`, reads `mySeatId` (F2, skip entirely if
already seated — you don't target a seat to sit in while sitting in one) and `peerSeats` (F3) for
the occupied set, calls F1's `findGazedFreeSeat(camera.position, camera.getWorldDirection(...),
occupied)`, and writes the result into `seatTargetRef.current`. Cheap — a distance + dot product
over 42 seats, once a frame — and mirrors `theaterEnvRef`'s exact naming convention (a plain
`{ current: T | null }`, not a class or a store, per that file's own comment on why this pattern
exists here).

**Both consumers of `seatTargetRef` read the same value, so the prompt and the keypress can never
disagree:** `viewControls.ts`'s `E` handler reads it synchronously at keypress time; F8's
`<SitPrompt>` reads it on its own throttled ~5 Hz tick to decide what to render. Neither recomputes
the targeting logic itself.

**`viewControls.ts` is F4's file** (single writer), and gains three changes:

- the `E` binding, behind `isEditingText()` like `Tab`/`F`/`M`: if mid-transition → ignore; if
  seated → `release()`; else if `seatTargetRef.current` is non-null → `claim(seatTargetRef.current)`.
- `Tab` becomes **inert while `view === 'fullscreen'`** (D7). Keep the `preventDefault()` so focus
  still can't escape the canvas.
- `F` **closes the tablet on the way into fullscreen** (D7), so you never end up in fullscreen with
  an open-but-unreachable tablet behind the overlay. Reuse `closeIpad()` rather than setting
  `ipadOpen` directly — it owns the pointer-lock restore bookkeeping.

### F5 — seated remote peers (`RemoteAvatars.tsx`)

In `<RemoteAvatar>`, read `peerSeats[id]`. When set:

- **stop sampling the interpolation buffer** — snap `group.position` to
  `[cushion.x, cushion.y − CUSHION_ABOVE_FLOOR, cushion.z]` and `group.rotation.y` to the seat yaw.
  A seated peer sends no presence, so `sampleAt` would hold at their last walking sample forever.
  Snap at the *start* of `sit_down` (the clip is rotation-only, so the pose has to play out at its
  final position) — see A1's root-motion note and its interpolate-the-group fallback.
- drive `animState` from the local state machine, not directly from `seatId`: a newly-observed
  `peer:seat` starts `sit_down`, a peer already seated at join goes straight to `sitting`.
  `speed={0}` throughout.
- On `seatId → null`, play `stand_up` at the seat position, then resume buffer sampling. Their first
  fresh presence packet may be a few hundred ms out, so expect a short glide from the seat to their
  real position — acceptable, and cheaper than special-casing.

**`Avatar.tsx` grows a one-shot mechanism**, which it doesn't have today — currently every clip
loops and every transition is a symmetric crossfade. Add:

- `'sit_down' | 'sitting' | 'stand_up'` to the union; load and preload the three new GLBs (eight
  clips total).
- For the two one-shots: `setLoop(LoopOnce, 1)` + `clampWhenFinished = true` so the last frame
  holds instead of snapping back to bind pose, and a `mixer` `'finished'` listener that advances
  `sit_down → sitting` and `stand_up → idle`, reported up to `<RemoteAvatar>` through a callback
  (the `onMeasured` prop is the precedent for extending this component's props without giving it
  store access).

  Note that `<SeatedCamera>` **cannot** share that signal: the local player renders no body at all
  (the Phase-2 no-local-body decision), so there is no local `<Avatar>` to fire it. The two stay in
  step by keying off the same *number* instead — `SIT_DOWN_DURATION_S` / `STAND_UP_DURATION_S`,
  measured off the clips in A1 and exported as documented constants — while the remote avatar keys
  off the real clip via `'finished'`. If those ever disagree, the constants are stale and A1's
  measurement is the source of truth.
- All three take the **normal crossfade**, never the instant-snap branch `idle` uses (that branch
  exists so a hard stop doesn't slide the feet; snapping into a seated pose just looks broken).
- Exclude all three from `NATURAL_SPEED_MPS` speed-matching — `timeScale = 1`, like `idle`.

### F6 — `src/playback/sync.ts` (video sync client)

One new file; no edits to `multiplayer/store.ts`. Mirrors `voice/peerConnections.ts`'s
attach-listeners-to-`getSocket()` shape, but **must fix that file's documented limitation**: it
registers once against whatever socket exists at that moment and never rebinds after a
disconnect/reconnect (which creates a brand-new socket instance). For voice that degrades to "no
audio"; for video it would silently desync the room. Attach from an effect keyed on the
multiplayer store's `status`, re-registering on each new connection.

- A sibling `src/playback/queue.ts` — a small zustand store holding `{ queue: QueueEntry[],
  currentEntryId, currentItemId }`, written only by this module's socket handlers. Separate from
  `playback/store.ts` (551 lines, singleton-heavy, and about the `<video>` element rather than room
  state), matching the one-new-store-per-feature convention `voice/` and `seats/` already follow.
- Inbound `video:state` → if `currentItemId` changed, `usePlaybackStore.getState().load(itemId)`
  (each client resolves its own quality/subtitles/`PlaySessionId` — per-client transcode sessions
  are correct and already how `load()` works), then `applyAnchor({ playing, playhead, atClockMs:
  performance.now() })`. Guard against re-`load()`ing the item already loaded, or every pause
  re-resolves the stream.
- Inbound `queue:state` → straight into the queue store.
- Outbound `commandEnqueue/commandRemove/commandMove/commandJump/commandNext/commandPlay/
  commandPause/commandSeek` — thin `emit` wrappers, exported for the UI.
- **Auto-advance**: listen for `ended` on the shared `<video>` and emit
  `commandNext(currentEntryId)`. Every client fires this at once by design; the server's
  `afterEntryId` check collapses them (contracts). Attach once, alongside the socket handlers, and
  read `currentEntryId` fresh at fire time rather than closing over it.
- **Autoplay gesture.** A remote-initiated `play()` is not a user gesture on the receiving client.
  In practice sticky activation (the receiver has already clicked to pointer-lock, opened the
  tablet, etc.) satisfies Chrome/Firefox, and `applyAnchor` already catches a rejected `play()` into
  the store's `error`. Two mitigations: (a) on the **initiating** client, keep the optimistic local
  `load()`+`play()` inside the click handler so the gesture is preserved there — the echoed
  `video:state` then merely reconciles; (b) if `play()` rejects, surface a one-click "join playback"
  affordance rather than a red error string.

### F7a — tablet: transport through commands, plus seeking

- `IpadBrowser.tsx` — `selectItem()` becomes `commandEnqueue(...)` built from the clicked
  `TheaterItem`/`TheaterEpisode` (both already carry `name`/`imageTag`/`runTimeTicks`; an episode's
  `subtitle` composes from the series + season/episode numbers the drill-down state already holds).
  The footer's play/pause calls `commandPlay`/`commandPause`.
  - **The autoplay gesture still matters here.** Keep the optimistic in-handler `load()`+`play()`
    (F6) for the case where this enqueue is what *starts* playback — i.e. when the queue store says
    nothing is currently playing. A click that only appends shouldn't touch local playback at all.
- **Seek UI** — a scrub bar in the footer. Three things to get right:
  - `playhead` changes continuously, so the container must sample `getTargetPlayhead()` in
    `useFrame` and throttle into React state at ~4 Hz. Per-frame `setState` would re-render the
    whole tablet DOM 60×/s — the discipline `RemoteAvatars` already applies to `speed`.
  - Emit `commandSeek` **on release**, not on every `onInput` tick, or one drag floods the room with
    seeks and yanks everyone's playhead around while you're still dragging.
  - While dragging, render the dragged value and ignore incoming `video:state` playheads, or the
    thumb fights the user mid-gesture.
  - New `IpadBrowserView` props: `playhead`, `duration`, `onSeek?`.
- `FullscreenPlayer.tsx` *(D4)* — delete the `video.controls = true` line from `showSharedVideo`.
  Nothing replaces it. Leave the reparenting logic alone; it's the reason playback survives the
  POV↔fullscreen swap.

### F7b — tablet: the queue view

- **`TabletState.view` gains `'queue'`**, and that ripples through four files by design — the union
  is deliberately mirrored at each boundary: `src/presence/tablet.schema.ts` (the zod enum),
  `src/multiplayer/store.ts` (type mirror + `isTabletState` validator), `IpadBrowser.tsx`
  (`BrowseState` union + `buildTabletState`), and `RemoteIpad.tsx` (its `TabletState → BrowseState`
  reconstruction). Miss one and a peer opening the queue tab either fails validation silently or
  renders the wrong view in everyone else's mirror.
- `IpadBrowserView.tsx` — a `Queue (N)` nav affordance beside the type filter, and a list rendering
  each entry as poster thumb · title · subtitle · "added by X", with three controls: **play**
  (`onQueueJump`), **remove** (`onQueueRemove`), **move up/down** (`onQueueMove`). Mark the
  currently-playing entry.
  - **Buttons, not drag-and-drop.** Drag-reorder inside an `<Html>` overlay rendered into a 3D
    canvas, with pointer-lock in play, is a pointer-event fight not worth having for something two
    arrow buttons cover.
  - Up/down map onto the id-addressed `move` command (`beforeEntryId` = the neighbour's id, or
    `null` to send to the end) — never an index swap. See contracts.
  - Stays presentational: every value and callback arrives as props, so `RemoteIpad` renders a
    peer's queue view read-only with no callbacks, exactly as it does for the grid today.
- `IpadBrowser.tsx` reads the queue from `playback/queue.ts` and passes it down.
- Nothing to do for fullscreen (D7): the tablet renders in one host only.

### F8 — Scene wiring + the sit prompt

The integration unit, and the only one that touches `Scene.tsx` (mirroring Phase 4's F6). Four
small additions:

- mount `<SeatedCamera>` (F4) inside `<Canvas>`;
- mount `useSeatTargeting()` (F4) inside `<Canvas>` — nothing else runs it, so if this line is
  missed, `seatTargetRef` never updates and `E` silently does nothing;
- call `useVideoSync()` (F6) so the room's socket handlers are attached and rebind on reconnect;
- render `<SitPrompt>` in the existing bottom-chrome overlay area.

`Scene/SitPrompt.tsx` (new, also F8's): when not seated and `seatTargetRef.current` is non-null,
show "Press E to sit"; when seated, "Press E to stand." Read the **same ref** `viewControls.ts`
consumes (D9/F4) — don't call `findGazedFreeSeat` a second time here, or the prompt and the
keypress could theoretically disagree about which seat. Drive the render off a **throttled** (~5 Hz)
poll of the ref, not per-frame React state — the same discipline `RemoteAvatars` uses for `speed`.
Optional nice-to-have: tint the candidate seat's cushion mesh.

---

## Risks & gotchas

- **Seat leak on disconnect** — if `handleDisconnect` doesn't free the seat, seats disappear
  permanently over a session. Covered by a B3 test; call it out in the unit prompt.
- **The claim race** — two clients pressing `E` on one seat in the same tick. The ack'd-RPC design
  (F2 never sets `mySeatId` optimistically) is what makes this correct; an optimistic sit would show
  two avatars in one chair until a correction landed.
- **ecctrl handoff on stand** — the genuine unknown. ecctrl's frame loop early-returns under
  `disableControl` and so never writes the camera, which is what lets F4 own it; but ecctrl's own
  internal camera state is *not* updated during that window, so re-enabling control may snap the
  view. Prototype sit→stand→sit early; if it snaps, the fallback is to seed ecctrl's camera state
  on release, or to keep `disableControl` off and instead override the camera after ecctrl in frame
  order.
- **Floor tunneling if the freeze is done wrong** — the every-frame `setGravityScale(0)` is not
  belt-and-braces, it's required. A one-time zero leaves gravity unopposed and the capsule tunnels
  through the thin floor trimesh (ecctrl has no CCD). Do not "simplify" that block.
- **Seated presence goes silent** — intentional, but it means anything that assumes a peer keeps
  emitting must be checked: `<NameTag>`'s gaze test (reads the group transform — fine, F5 keeps
  writing it), `<PeerVoice>`'s panner position (same), and `sampleAt`'s buffer (must be bypassed,
  not left to hold a stale sample).
- **`tick()` vs. any non-command control** — the reconcile loop hard-seeks back to the anchor past
  0.75 s drift, so *any* surface that writes `currentTime` without going through a command **will**
  be fought on the next frame. D4 removes the only such surface; the rule to keep is that nothing
  may ever write `currentTime` outside `store.ts`.
- **Index-addressed queue mutations** — the single most likely correctness bug in the queue. Remove
  and reorder must address entries by `entryId`; two clients acting on stale indices delete or move
  the wrong row, and an index cursor silently changes what's playing when someone reorders above it.
  Covered by the pure `queue.ts` tests.
- **Auto-advance storms** — every client fires `ended` at once. Without the `afterEntryId` staleness
  check the room would skip N entries instead of one. Test it with two simulated `next`s.
- **Re-`load()` on every pause** — `video:state` carries `currentItemId` on *every* transport
  change; if F6 doesn't compare against the already-loaded item, each pause tears down and
  re-resolves the stream (and, on HLS, leaks a transcode session per pause).
- **The `'queue'` view union is mirrored in four places** — by design, per this app's
  hand-mirror-across-boundaries convention, but it means a partial edit fails *silently* (a peer's
  tablet state just stops validating). Grep for the union, don't rely on the type checker: each copy
  is independent.
- **Autoplay policy** — see F6. Most likely to bite the *second* browser in a two-tab test if that
  tab has never been clicked.
- **Clip↔skeleton binding for the three sit clips** — the sources are **confirmed bare-named**
  (A1), so `withMixamoPrefix()` is load-bearing here: skip it and the clips bind to nothing and the
  avatar silently holds its bind pose, with no error anywhere. Still confirm all three bind on every
  selectable character, especially the RPM-rigged Charlie.
- **Sit pose alignment** — `stripToRotation` discards root motion, so the seated pose sits exactly
  where `CUSHION_ABOVE_FLOOR` puts it. Budget one visual tuning pass; if the clip's hips sit far
  from its feet origin, that constant absorbs the difference. The sit-*down* clip is the more likely
  offender: Mixamo authors it stepping backward into the chair via root motion, so stripped it will
  lower in place (A1).
- **One-shot clips are new to `Avatar.tsx`** — everything it plays today loops. `LoopOnce` without
  `clampWhenFinished = true` snaps back to bind pose on the last frame, which looks like the
  character briefly T-posing into the chair. Both flags, always.
- **Camera ease vs. clip duration** — `<SeatedCamera>`'s ease (local, timer-driven off
  `SIT_DOWN_DURATION_S`) and `<Avatar>`'s one-shot (remote, driven off the real clip) are
  *structurally* independent: there is no local avatar to share a completion signal with. They only
  agree because the constant is the measured clip duration. Re-measure if a clip is ever replaced,
  or your own view will land in the chair noticeably before or after everyone sees you get there.
- **Transition + interruption** — `E` must be inert while a one-shot is in flight, and `frozen` must
  cover the transitions as well as the seated steady state. A stand-up that unfreezes on the first
  frame instead of the last drops the character mid-animation.
- **Seated look vs. an open tablet (D8)** — `openIpad()` releases pointer lock but `mousemove` keeps
  firing, so a `<SeatedCamera>` that doesn't check `document.pointerLockElement` will swing the view
  every time you reach for a tablet button. The failure is subtle: it only shows up seated *and*
  with the tablet open, which is exactly the "watching a movie, want to pause" path.
- **Fullscreen with an orphaned tablet** — if `F` doesn't close the tablet on the way in (D7),
  `ipadOpen` stays true behind a `z-50` overlay on a `frameloop="never"` canvas: invisible, frozen,
  and still holding `lockedElementBeforeIpad`. Coming back to POV would then restore into a
  confusing half-state.
- **Nobody mounts `useSeatTargeting()` (D9)** — it's easy to build F4's targeting logic correctly
  and still forget the one line in F8 that runs it every frame. The failure is silent: no crash, no
  type error, `E` just never claims a seat, because `seatTargetRef.current` never leaves `null`.
  Worth an explicit check at the Batch 5 gate, not just "does it build."
- **The prompt and the keypress must read one ref, not call `findGazedFreeSeat` twice** — two call
  sites computing the same thing independently can drift a frame apart (camera moves between the
  prompt's poll and the keypress) and, worse, invites someone "simplifying" one of them later in a
  way that quietly changes only one behavior. One ref, two readers, is what keeps them identical by
  construction.
- **Seat-targeting needs no occlusion raycast, unlike nametags** — don't reach for
  `NameTag.tsx`'s wall-occlusion pattern here. `SEAT_TARGET_MAX_DISTANCE_M` already bounds the
  check to well inside the open seating area, so "in range" already implies "not behind a wall";
  adding a raycast would be unnecessary cost copied from a different problem.
- **Sit-down replay on join** — a peer already seated when you connect arrives with `seatId` set via
  `peers:init`; rendering that as a *transition* makes everyone already in the theater visibly
  re-sit every time someone joins. Only a `peer:seat` event on an already-known peer is a transition.
- **Don't add seat colliders** — standing up inside a solid seat would trap the player. Deliberately
  Phase 6.
- **No visual verification in this app** — per convention, validate via `tsc` / tests / build +
  source reading; you click-test live and report bugs. Build **sequentially**
  (`pnpm --filter @lilnas/theater build:backend && … build:frontend`) — the package's `run-p`
  build races deterministically on a cold `.next/types`.

---

## Dispatch (summary — `ORCHESTRATE.md` is authoritative)

**The batch schedule, per-unit file ownership, gates, and sub-agent guardrails live in
`ORCHESTRATE.md`** (§2 ownership matrix, §5 dispatch schedule, §6 guardrails). Dispatch one
`theater-impl` sub-agent per unit; run the gate between batches; check each return summary's
exported symbols against ORCHESTRATE §1 before dispatching dependents. This section is the summary
view only — if it and ORCHESTRATE disagree, ORCHESTRATE wins.

```
Batch 1 ── 4 concurrent:   A1 clips · F1 seat table · B1 schemas · B2 queue helpers
Batch 2 ── sequential:     B3 gateway (B3a seats → B3b video/queue)  →  B4 gateway tests
Batch 3 ── 3 concurrent:   F2 seat store · F3 peerSeats · F6 video sync
Batch 4 ── 2 concurrent:   F4 seated player · F5 seated peers
Batch 5 ── 2 concurrent:   F7a tablet transport+seek · F8 Scene wiring + sit prompt
Batch 6 ── 1 agent:        F7b tablet queue view
```

Peak concurrency 4; critical path B1/B2 → B3 → F6 → F7a → F7b. Two ordering constraints worth
repeating because they're easy to get wrong:

- **A1 must be *done*, not just dispatched, before Batch 4** — F4 and F5 both need its measured
  clip durations, and placeholder timings would desync the camera ease from the avatar animation.
- **`IpadBrowser.tsx`/`IpadBrowserView.tsx` are one sequential track** (F7a → F7b), one batch apart.
  Never concurrent.

Rough size: ~8 new files, ~12 edited. The delicate ones are `presence.gateway.ts`, `Player.tsx`,
`Avatar.tsx`'s new one-shot handling, and the four-file `'queue'` union ripple. The queue makes this
comparable to Phase 4 in total size, though not in risk — most of it is CRUD over an array with a
cursor, fully unit-testable before it ever touches a socket. Three places may need iteration: the
ecctrl camera handoff on stand-up, the sit-down clip's appearance with root motion stripped, and the
queue's tablet layout at the tablet's small render size.

---

## Manual demo / acceptance checklist

1. Two browser tabs, both logged in, each on a different character.
2. Walk near a seat but **look away from it** (at the ceiling, at another row) — no prompt appears,
   and `E` does nothing. Turn to look at the seat while still close: "Press E to sit" appears.
3. **Disambiguation (D9):** stand between two adjacent seats (0.44 m apart) and turn your head
   between them — the prompt follows whichever one you're more centered on, not always the nearer
   or always the same one.
4. `E` **eases** you into the chair (no teleport) and lands at a plausible seated eye height, facing
   the screen.
5. The other tab sees that avatar play the sit-down animation and settle into the seated loop **in
   that exact seat** — not standing inside the chair, not floating above it, and not T-posing on the
   clip's last frame.
6. The camera finishes its ease at roughly the same moment the avatar finishes sitting (compare the
   two tabs side by side).
7. While seated, WASD does nothing and you do not fall through the floor — including *during* the
   sit-down and stand-up animations.
8. Mashing `E` mid-sit-down does nothing; the transition completes normally.
9. Looking around while seated is clamped (D3, ±75°/±45°) — you can glance left/right and up/down,
   but not spin to face the back wall.
10. Tab 2 tries to sit in the seat tab 1 already holds → refused (no prompt, or a "taken" state);
   tab 1 stays put and does not visibly twitch.
11. `E` again plays stand-up, then hands the camera back to ecctrl **without a visible snap**, and you
   can walk away normally.
12. Open a third tab while someone is seated → the seated avatar appears **already sitting**, and the
    two existing tabs do **not** see anyone re-play the sit-down.
13. Close a seated tab → the avatar disappears **and** the seat becomes claimable again.
14. Pick a title in tab 1 with nothing playing → it enqueues **and** starts, and tab 2's screen loads
    the same title.
15. Pick a second title while the first plays → it appends to the queue and **does not** interrupt
    playback. Both tabs show a two-entry queue.
16. Pause in tab 1 → tab 2 pauses within a frame or two. Same for play.
17. Drag the tablet's scrub bar → the room seeks once, on release (not continuously mid-drag), and
    both tabs land on the same spot.
18. In fullscreen (`F`) there are **no** video controls and `Tab` does nothing (D7); pressing `F`
    again returns to POV where the tablet works. Opening the tablet first and *then* pressing `F`
    closes it rather than stranding it behind the overlay.
19. **Seated + tablet (D8):** sit down, press `Tab`, and control playback from the chair — the
    character stays seated, and moving the mouse across the tablet's buttons does **not** swing the
    seated view. Closing the tablet hands look control back.
20. Queue ops from either tab, both tabs agreeing after each: jump to entry 2 · move entry 3 up ·
    remove a non-playing entry · remove the *playing* entry (playback advances to the next one).
21. Reorder the queue **above** the currently-playing entry → playback is undisturbed (the cursor
    follows the entry, not the index).
22. Queue the same title twice → two distinct rows; removing one leaves the other.
23. Let a short item play to its end → the room advances to the next entry exactly **once** (not two
    or three entries at a time with two tabs open).
24. Open a third tab mid-movie → it joins **at the current playhead**, already playing, in the right
    title, with the full queue populated.
25. Leave it running a few minutes → the two tabs stay within a fraction of a second (watch
    `tick()`'s `playbackRate` nudge do its job; no repeated hard seeks) and no pause re-buffers the
    stream from scratch.
26. Sit down while a movie is playing, with voice on — audio still spatializes from the screen, and
    a seated neighbour is audible.
27. Open a peer's tablet mirror while they're on the queue tab → you see the queue view, not the
    grid.
