# Theater — Phase 4: Multiplayer Presence

**Status:** Plan (no implementation yet) · **App:** `apps/theater` (`@lilnas/theater`)
**Depends on:** Phases 0–3 (shipped: physics scene, character select, Emby playback).
**Spec of record:** the Notion "Lilnas Theater" doc. This file is the Phase-4 build plan.

---

## Goal

"See each other walking." A Socket.IO gateway on the NestJS backend relays lightweight
presence (position, yaw, animation state, chosen character) between the friends in a room.
Each browser renders every *other* player as a full third-person character — walking, idle —
interpolated smoothly between the ~12–15 Hz network updates. The local player still renders
**no local body** (Phase-2 decision), so this phase is purely about seeing *others* — walking,
and (F7) identifying who's who via a nametag that fades in above a peer's head only while you look
directly at them.

Explicitly **out of scope** for Phase 4 (deferred to Phase 5): seats, sit/stand, look-clamp,
seat occupancy, and video play/pause/seek sync. The playback store's anchor model
(`src/playback/store.ts`) already exists as the seam for video sync, but the room-state
broadcast that drives it is Phase 5 and depends on the gateway this phase builds.

**Scope note (expanded 2026-07-23).** After review this plan now also covers three things
the original Phase-4 cut deferred or omitted, all confirmed in-scope for "the multiplayer
experience":

- **Directional locomotion** — walk forward/back **and** strafe left/right (not a single
  `walking` state), with clip playback speed matched to movement speed so feet don't skate.
  Folded into the Phase-4 core below (contracts · **A1** asset step · F3/F4/F5).
- **Phase 4B — spatial voice chat** — distance-only attenuation in POV, non-spatial in
  fullscreen, mute on `M`. New section below.
- **Phase 4C — tablet presence + UI mirroring** — see a peer open their tablet and the
  library UI they're navigating/scrolling. New section below.

Seats, sit/stand, and video play/pause/seek sync stay Phase 5 (unchanged). Nametags stay
**gaze-gated** (F7) — confirmed, not always-on.

---

## What already exists (and the gaps this phase closes)

- **No realtime layer at all.** `package.json` has none of `@nestjs/websockets`,
  `@nestjs/platform-socket.io`, `socket.io`, or `socket.io-client`. The backend
  (`bootstrap.ts`) is a plain Express-platform Nest app; `app.module.ts` imports only
  Auth/Emby/Health.
- **`characterId` is selected but dropped.** `TheaterApp.tsx` stores `characterId` from
  `<CharacterSelect>` then renders `<SceneView />` with **no props** (the code comment even
  says "characterId isn't consumed yet"). Phase 4 must thread it through
  `TheaterApp → SceneView → Scene →` the socket handshake, so peers know which model to draw.
- **No reusable world-space avatar.** `CharacterSelect/CharacterModel.tsx` renders a character,
  but it is **stage-only**: it runs the per-frame "pedestal" machinery (re-anchoring the root
  bone over stage-center, re-planting feet, `ROOT_SWAY_SCALE`) that would *fight*
  network-driven positioning. Phase 4 needs a new `<Avatar>` whose transform is driven purely
  by the interpolated network position. The reusable pieces to lift from `CharacterModel` are
  `SkeletonUtils.clone` and the clip-track stripping (see below), **not** the pedestal.
- **Auth is HTTP-cookie based and reusable.** `AuthService.readSession(req)` verifies the
  signed `theater_session` cookie; `AuthModule` already `exports: [AuthService]`. The gateway
  will reuse this to authenticate the socket handshake (one small new method).
- **Routing is single-origin through Next.js.** Traefik only routes port **8080** (Next.js
  standalone); the backend **8081** is reached exclusively via the `next.config.js` rewrite
  `/api/:path*` → `:8081/:path*` (which **strips** `/api`). Native `lilnas dev` runs both
  processes directly with no Traefik. This shapes the whole `/socket.io` routing decision below.

---

## Routing: the one genuinely risky infra decision

The Notion doc flagged "WebSocket through the proxy" as the spot likely to need iteration.
Verified fact: **Next.js `rewrites()` do not proxy the WebSocket `Upgrade` handshake**
(vercel/next.js#23147; Socket.IO's own Next.js guide recommends sharing the HTTP server
instead). Socket.IO's HTTP **long-polling** transport *does* pass through a rewrite, but it
never upgrades to WS — so a naive `/socket.io` rewrite gives a working-but-polling-only
connection.

Note also: theater is **not** behind Traefik `forward-auth@file` (check `deploy.yml` — no
forward-auth middleware; the app self-gates with its password). So the only auth on the socket
is the app's own `theater_session` cookie — simpler than the doc assumed.

**Decision — route `/socket.io` at the proxy layer straight to the backend; keep the browser
same-origin.** Traefik upgrades WebSockets natively. Add a second same-host router (exactly the
pattern `apps/swole/deploy.yml` uses for its `/metrics` PathPrefix router) pointing at port
8081:

- **`deploy.yml`** (prod, `theater.lilnas.io`): add
  ```
  - traefik.http.routers.theater-ws.rule=Host(`theater.lilnas.io`) && PathPrefix(`/socket.io`)
  - traefik.http.routers.theater-ws.entrypoints=websecure
  - traefik.http.routers.theater-ws.tls.certresolver=le
  - traefik.http.routers.theater-ws.service=theater-ws
  - traefik.http.services.theater-ws.loadbalancer.server.port=8081
  ```
  (The existing `theater` router/service still serves everything else on 8080. Both point at
  the same single container — the Dockerfile's `pnpm start` runs `run-p start:*` = Next.js 8080
  + NestJS 8081.)
- **Native `lilnas dev`** (no Traefik; the app's only dev flow):
  the browser page is `http://localhost:8080`, so a
  same-origin `/socket.io` can't reach 8081. Handle with an env-gated direct connection:
  client uses `process.env.NEXT_PUBLIC_SOCKET_URL` when set (dev `.env`:
  `NEXT_PUBLIC_SOCKET_URL=http://localhost:8081`), else same-origin `''`. The gateway enables
  CORS **only** in dev for `http://localhost:8080` with `credentials: true`. In prod the empty
  URL keeps it same-origin, so CORS never triggers. The `theater_session` cookie is
  `sameSite:'lax'` — sent on the same-site cross-port handshake GET in dev, and same-origin in
  prod.

**Zero-infra fallback (documented, not the default):** if the Traefik router misbehaves, mount
the client at `path: '/api/socket.io'` (reuses the existing rewrite; the server keeps default
`/socket.io` since the rewrite strips `/api`). This connects via long-polling everywhere with
no infra change — acceptable for friends-scale, just higher latency. Ship the Traefik router
first; keep this in the back pocket.

---

## Shared data contracts (lock these before splitting work)

Short wire keys keep presence packets tiny at 12–15 Hz; readable names on the roster events.

```ts
// Handshake (client → server, in socket.handshake.auth):
{ characterId: string }                    // validated server-side against the allowlist

// Client → server, ~12–15 Hz, dead-banded:
'presence' → { p: [number, number, number], y: number, a: AnimState }
//              position (feet, world)      yaw(rad)   see AnimState (5 states) below

// Server → the joining client, once, on connect:
'peers:init' → PeerSnapshot[]              // everyone already in the room (excludes self)

// Server → the rest of the room:
'peer:join'     → PeerSnapshot             // { id, username, characterId, p, y, a }
'peer:leave'    → { id: string }
'peer:presence' → { id: string, p:[number,number,number], y:number, a:AnimState }

// Directional locomotion (widened from the original 'idle' | 'walking'). The LOCAL player
// classifies its velocity RELATIVE TO FACING (F5) and sends the discrete state; diagonals
// snap to the dominant axis. Speed is NOT on the wire — each remote derives cadence from its
// own interpolation (F4), so the clip's stride matches the rendered motion (running just
// speeds the same clip up). Voice (4B) + tablet (4C) add their own events — see those sections.
type AnimState = 'idle' | 'walk_fwd' | 'walk_back' | 'strafe_left' | 'strafe_right'
//                                                             'sitting' is Phase 5
type PeerSnapshot = { id:string; username:string; characterId:string;
                      p:[number,number,number]; y:number; a:AnimState }
```

`id` = `socket.id` (server-assigned, unique per connection). MVP is a **single hard-coded
room** (`THEATER_ROOM`); the doc allows multi-room later without reshaping these events.

---

## Asset units (local, one-time)

### A1 — convert the strafe clips
Two new Mixamo strafe animations are staged at `~/Desktop/models/walk-strafe-left.fbx` and
`walk-strafe-right.fbx`. Convert each to GLB beside the existing clips with the app's own
Blender-backed CLI (local-only asset tooling, `scripts/convert.ts` → `blender_convert.py`;
nothing here runs in Docker or at runtime):

```
pnpm --filter @lilnas/theater convert ~/Desktop/models/walk-strafe-left.fbx  public/animations/walk-strafe-left.glb
pnpm --filter @lilnas/theater convert ~/Desktop/models/walk-strafe-right.fbx public/animations/walk-strafe-right.glb
```

After A1 the locomotion clip set is: `idle.glb`, `walk.glb` (forward), `walk-back.glb`,
`walk-strafe-left.glb`, `walk-strafe-right.glb` (the existing `twerk.glb` is unrelated).
`walk.glb` and `walk-back.glb` already exist on disk but are currently wired to nothing —
F3 is the first consumer of all five. These GLBs are used **animation-only** (F3 reads
`.animations`, ignores any bundled dummy mesh), and clips bind by bone name, so the
`mixamorig:`-named tracks resolve against the Mixamo-rigged cast with no retargeting. Confirm
each converted GLB loads and that its first clip is the strafe motion; see the "clip↔skeleton
binding" risk for the RPM-rigged (bare-bone-name) character caveat.

---

## Backend units (NestJS)

### B1 — dependencies
Add to `apps/theater/package.json` (pin Nest packages to the existing `11.1.6`):
`@nestjs/websockets@11.1.6`, `@nestjs/platform-socket.io@11.1.6`, `socket.io` (server).
`pnpm install`, commit the lockfile.

### B2 — `AuthService.verifySessionCookie(cookieHeader: string | undefined): string | null`
The handshake carries a raw `Cookie:` header, not an Express `Request`, so `readSession`
(which reads `req.signedCookies`) can't be used directly. Add a sibling method that parses the
header (`cookie.parse`), pulls `theater_session`, and unsigns it with `THEATER_SESSION_SECRET`
via `cookie-parser`'s `signedCookie(value, secret)` — returning the username or `null`.
Refactor `readSession` to delegate to it so both paths share one verification. Add a unit test
(valid signed cookie → username; tampered/absent → null).

### B3 — `PresenceModule` + `PresenceGateway`
New `src/presence/`:
- **`presence.module.ts`** — `imports: [AuthModule]` (for `AuthService`), `providers:
  [PresenceGateway]`. Register in `app.module.ts`.
- **`presence.constants.ts`** — `THEATER_ROOM`, presence min-interval (rate limit),
  `VALID_CHARACTER_IDS` (a `Set` mirroring the frontend `CHARACTERS` ids, with a "keep in sync"
  comment — same hand-mirrored-DTO convention this app already uses between `emby.service.ts`
  and `IpadBrowser.tsx`). Consider promoting the id list to a shared module later; not now.
- **`presence.schema.ts`** — zod for the inbound `presence` packet (`p` = tuple of 3 finite
  numbers, `y` finite, `a` ∈ enum) and the handshake `characterId` (non-empty, in the
  allowlist). Boundary validation is this app's convention (`emby.schema.ts`); untrusted client
  input **must** be validated.
- **`presence.gateway.ts`** — `@WebSocketGateway({ cors: <dev-only> })`, implementing
  `OnGatewayConnection`/`OnGatewayDisconnect`:
  - **Auth on connect:** read `client.handshake.headers.cookie` → `AuthService
    .verifySessionCookie`. No/invalid session → `client.disconnect(true)` and return. Validate
    `client.handshake.auth.characterId` against the allowlist → invalid → disconnect. Stash
    `{ username, characterId }` on `client.data`.
  - **Roster:** keep an in-memory `Map<socketId, PeerSnapshot>` (a NestJS singleton field, same
    shape as `EmbyService.cachedUserId`). On connect: join `THEATER_ROOM`, seed the peer's entry
    (spawn defaults for `p`/`y`/`a`), `emit('peers:init', <all others>)` to the joiner, and
    `client.to(ROOM).emit('peer:join', <this peer>)`.
  - **`@SubscribeMessage('presence')`:** zod-validate; drop if invalid or if the socket exceeds
    the rate limit (per-socket last-timestamp min-interval — cheap flood guard); update the
    map; `client.to(ROOM).emit('peer:presence', { id, p, y, a })`.
  - **Disconnect:** delete from map; `client.to(ROOM).emit('peer:leave', { id })`.
  - MVP relays each packet directly (no server tick). *Optimization, documented not built:* a
    fixed-rate server broadcast loop that coalesces to one snapshot/tick — revisit only if
    friends-scale traffic ever bites.
- **Adapter:** the default `IoAdapter` attaches Socket.IO to the HTTP server Nest already
  created on 8081 — no `bootstrap.ts` change needed beyond it working out of the box. Confirm
  the gateway comes up in the boot logs.
- **Single gateway owner (Option B on the backend).** `presence.gateway.ts` has exactly **one
  writer**: the `rtc:signal`/`peer:mute` relay (VB1, Phase 4B) and the `tablet:state` relay (TB1,
  Phase 4C) are added **here, in this same Wave-2 unit**, each backed by its own sibling schema
  file (`rtc.schema.ts`, `tablet.schema.ts` alongside `presence.schema.ts`). Building all three
  relays now — they're tiny pass-throughs against frozen contracts — means the voice and tablet
  **frontend** waves (5/6) never touch the backend and so share no files at all. See ORCHESTRATE.md §4.

### B4 — gateway tests
`src/presence/__tests__/presence.gateway.test.ts`: auth accept/reject via mocked handshake
cookie; `characterId` allowlist enforcement; join seeds roster + emits `peers:init`/`peer:join`;
`presence` validation drops malformed packets and relays valid ones; disconnect emits
`peer:leave`. Mock the socket/server (no real network).

---

## Frontend units (React / R3F)

### F1 — thread `characterId`
`TheaterApp.tsx`: `<SceneView characterId={characterId} />`. `SceneView.tsx` and `Scene.tsx`:
accept and forward the prop (both are currently prop-less). `Scene` passes it to the connect
call and to `<LocalPresence>`.

### F2 — `src/multiplayer/store.ts` (zustand) + singleton socket
Mirror `playback/store.ts`'s module-singleton pattern. **Split what re-renders from what
doesn't** — this is the core perf decision:
- **zustand state (React-visible, changes only on join/leave):** `status`,
  `peerIds: string[]`, `peerMeta: Record<id, { characterId; username }>`. React uses this to
  mount/unmount exactly one `<RemoteAvatar>` per peer.
- **module-level `peerBuffers: Map<id, { targetPos:Vector3; targetYaw:number; animState; speed;
  headHeight? }>`** updated *directly* by the `peer:presence` handler (`targetPos`/`targetYaw`/
  `animState`) — **never** through React state. Movement at 15 Hz must not trigger re-renders; each
  `<RemoteAvatar>` reads its own buffer in `useFrame`. `speed` is written by the F4 shell (smoothed
  render speed, for `<Avatar>` cadence); `headHeight` is written once by `<Avatar>` on load (for
  `<NameTag>` placement). Voice (VF1) and tablet (TF-track) keep their own separate module-level
  maps/state keyed by the same `id` — see ORCHESTRATE.md §1 for the frozen shapes.
- **Actions:** `connect(characterId)` — lazily create the singleton
  `io(process.env.NEXT_PUBLIC_SOCKET_URL ?? '', { withCredentials: true, auth: { characterId }
  })`, wire handlers (`peers:init`, `peer:join`, `peer:leave`, `peer:presence`, `connect`,
  `disconnect`, `connect_error`); `disconnect()` — tear down.
- **StrictMode guard:** React 19 + `next dev` double-invoke effects. Guard `connect()` with an
  in-flight/existing-socket check (a module-level singleton + ref guard), and only truly
  disconnect on real unmount — the same class of double-mount race that bit the tdr-code logs
  viewer. Validate inbound packets defensively (ignore non-finite `p`, unknown `a`).

### F3 — `src/components/Scene/clipTracks.ts` (shared) + `<Avatar>`
- **`clipTracks.ts`:** extract clip-track stripping so it's shared and tested. Two variants:
  `stripProportionTracks` (keep `.quaternion` + root `.position` — current `CharacterModel`
  behavior) and `stripToRotation` (**quaternion-only**, drop the root position track too). Remote
  avatars use `stripToRotation`: the group's world position is the *sole* driver, so any
  retained root-motion/position track would double-move and slide the feet — exactly the doc's
  "clips must be in-place" warning. Refactor `CharacterModel` to import its variant from here
  (no behavior change). Unit-test both.
- **`src/components/Scene/Avatar.tsx`** — the reusable world-space avatar:
  - `useGLTF(modelUrl)` → `SkeletonUtils.clone` (per-mount copy; same reason as `CharacterModel`).
  - Load the shared clip set once (drei `useGLTF` on each): `idle.glb`, `walk.glb` (fwd),
    `walk-back.glb`, `walk-strafe-left.glb`, `walk-strafe-right.glb` (A1). Take clip 0 of
    each, `stripToRotation` (quaternion-only). Build a `Record<AnimState, AnimationAction>`
    via `useAnimations`.
  - **Crossfade on `animState`:** on change, `next.reset().fadeIn(0.2)`, `prev.fadeOut(0.2)`
    (drei action API). Start on `idle`.
  - **Speed-matched cadence (no foot-skate):** each walk-family clip carries a hand-tuned
    `NATURAL_SPEED` constant (the m/s at which its stride reads as "correct" — eyeball it once
    at ecctrl's walk speed; do **not** read it off the root track, which the ~100× units bug
    makes meaningless). Each frame set the active walk action's `timeScale = speed /
    NATURAL_SPEED[state]` (clamped); idle stays at `1`. `speed` arrives as a prop from F4 (the
    remote's interpolation speed) — which is also why running needs no extra clip: a larger
    `speed` just speeds the same cycle up.
  - One-time recenter so feet sit at the group origin (reuse `pedestal.ts`'s recenter step only,
    **not** the per-frame pedestal loop) — so the network `p` (feet position) places it
    correctly. Render `<primitive object={scene} />`. No sway, no per-frame root re-anchor.
  - Props: `{ modelUrl: string; animState: AnimState; speed: number }`. Keep it presentational — position/yaw
    live on the parent group (F4), so the same `<Avatar>` could later back the picker preview
    (doc's "shared with picker" ideal — a *later* optional unification, not this phase; don't
    churn the working `CharacterModel`).

### F4 — `<RemoteAvatars>` + `<RemoteAvatar>` shell + interpolation
`src/components/Scene/RemoteAvatars.tsx`, rendered inside `<Canvas>` and the existing
`<Suspense>` but **outside `<Physics>`** (remote avatars are visual only — no colliders; remote
players don't run ecctrl). Maps `peerIds` → one `<RemoteAvatar key={id} id={id} />`.

**`<RemoteAvatar>` is a thin composition root (Option B — ORCHESTRATE.md §3).** It owns the
interpolated transform and mounts one child per feature, each in its own file with its own small
`useFrame`, so the nametag/voice/tablet units never edit this file's internals:

- Resolves `characterId → CHARACTERS.modelUrl` (from `peerMeta`); skip if unknown.
- Holds a `<group>` ref; its `useFrame` reads `peerBuffers.get(id)` and frame-rate-independently
  smooths render→target: `pos.lerp(target, 1 - Math.exp(-k*dt))`; yaw via shortest-angle wrap
  (or slerp a Y-quaternion). It also writes a smoothed render speed (`|Δ smoothed-pos.xz| / dt`,
  low-passed) back into the buffer's `speed`, so `<Avatar>` can match cadence — no extra wire field.
- Renders, **inside the group** (transform inheritance places them all on the avatar), the four
  child slots: `<Avatar modelUrl animState speed />` (F3) · `<NameTag id />` (F7) ·
  `<PeerVoice id />` (VF3) · `<RemoteIpad id />` (TF3). **F4 creates all four mounted now** —
  `NameTag`/`PeerVoice`/`RemoteIpad` land as trivial stub files (`return null`) that their owning
  units later fill in. This is the point of Option B: after F4, **no later unit edits
  `RemoteAvatar.tsx`** — each only fleshes out its own child file.
- Frozen child contract: every child takes **only `{ id }`** (except `<Avatar>`, presentational
  with `{ modelUrl, animState, speed }`) and reads its hot per-frame data from `peerBuffers.get(id)`
  / the voice + tablet stores by id — never React state, never per-frame props.
- This interpolation is what makes 15 Hz look smooth at 60 fps. Unit-test the pure
  smoothing/shortest-angle-yaw helpers (jsdom can't verify the visual, per this app's
  no-browser-verification convention).

### F5 — `<LocalPresence characterId>` broadcast hook
`src/components/Scene/LocalPresence.tsx` (or `useLocalPresence`), inside `<Canvas>`, outside
`<Physics>`:
- Decouple from ecctrl internals: read `state.camera` in `useFrame`. First-person camera sits at
  the head (`Player.tsx`: `camInitDis -0.01`), so `p` = camera world position minus eye-height
  (≈ capsule height) to land at feet; `y` = **yaw only** from the camera quaternion (never pitch
  — looking up/down must not tilt the body).
- `animState` from velocity **relative to facing**: take world velocity (this frame's feet
  position minus last frame's), rotate it into the body's local frame by `-yaw`, and classify
  the dominant local axis → `walk_fwd`/`walk_back` (local ∓Z) or `strafe_left`/`strafe_right`
  (local ∓X); below the speed epsilon → `idle`. Diagonals (W+A) snap to the larger axis. Yaw is
  still broadcast separately — the body faces camera-forward, so strafing slides sideways while
  facing forward, exactly what the strafe clips depict.
- **Throttle + dead-band:** accumulate time like `Player.tsx`'s telemetry throttle (~0.07–0.08 s
  ≈ 13 Hz); emit only when moved/rotated past an epsilon **or** `animState` flipped — silent
  when standing still, to cut idle traffic.
- Do **not** broadcast while `ipadOpen` (movement is frozen anyway) — optional minor optimization.

### F6 — connect lifecycle in `Scene`
On `Scene` mount call `multiplayerStore.connect(characterId)`; on unmount `disconnect()`
(StrictMode-guarded per F2). Render `<RemoteAvatars/>` and `<LocalPresence characterId/>` inside
the existing `<Suspense>` (Avatar GLBs suspend). Optional: a tiny "N in the theater" indicator
reading `peerIds.length` from the store — nice demo affordance, cheap.

### F7 — gaze-gated nametags
Purely additive and **frontend-only**: `username` already rides `PeerSnapshot` into
`peerMeta[id].username` (F2), and "am I looking at this peer" is a *local* decision computed from the
local camera + the peer's already-buffered position — **no protocol, backend, or wire change, and
zero new network traffic.** Default state is hidden; a peer's name fades in only while the local
player looks near-directly at them, and fades back out on look-away. This is also the thing that
disambiguates two players who picked the *same* character (identical models, distinct names — see Q1
above).

- **`src/components/Scene/gaze.ts` (shared, pure, tested):**
  - `gazeAlignment(camPos, camForward, targetPos): number` — normalized dot of `camForward` with the
    direction from camera to `targetPos`; `1` = dead-centre, falls off toward/behind. Unlike the
    avatar body's **yaw-only** rule, gaze uses the camera's *full* 3D direction (incl. pitch) — a
    reticle test ("is their head near my screen centre"), not a compass bearing. Aim at the peer's
    **head**, not feet, so looking at a face triggers it.
  - **Hysteresis (two thresholds, not one):** `GAZE_ENTER_COS = cos(12°)` turns a name *on*,
    `GAZE_EXIT_COS = cos(18°)` (looser) turns it *off*. `nextGazeState(prevOn, alignment): boolean` is
    a pure schmitt-trigger — off→on when `alignment > ENTER`, on→off when `alignment < EXIT`, else
    unchanged. The sticky band between the two angles stops names flickering when your gaze hovers at
    the cone edge: the damp smooths the *fade*, but on a single threshold the *target* would still
    oscillate. These two constants are the taste dial — widen for "who's in front of me," tighten for
    "precisely centred."
  - Fade with the same frame-rate-independent smoothing F4 already uses for position
    (`THREE.MathUtils.damp` / `1 - Math.exp(-k*dt)`), lambda tuned to a ~0.2–0.3 s feel. Unit-test
    `gazeAlignment` (on-axis → ~1; off-axis/behind → low/negative), `nextGazeState` (crosses ENTER
    going up, EXIT going down, holds inside the band), and the damp step — pure math, no R3F, per the
    no-browser-verification convention.
- **`src/components/Scene/NameTag.tsx`** — presentational billboard label:
  - drei `<Billboard>` + `<Text>` (both in the installed `@react-three/drei@10.7.7`). `<Text>` with
    `transparent`, `depthWrite={false}`, an outline for legibility, and a high `renderOrder` /
    `depthTest={false}` so the tag draws on top instead of being clipped by the avatar's own head.
  - Positioned at head height by reusing the bind-pose bounds F3's `<Avatar>` already measures for
    its recenter (`prepareCharacterScene` / `measureLocalBounds` → `Box3`, `pedestal.ts`): park the
    tag at `box.max.y + margin`, so it sits right above a tall Master Chief and a short Kanna alike —
    no per-character magic constant.
  - Props `{ text: string; height: number }`; expose the text material via `forwardRef` (or an
    internal ref the parent reaches) so the parent writes opacity without re-rendering.
- **Occlusion — `occludesGaze` helper + a shared theater env-root ref:** the dot-product test knows
  *direction*, not *line of sight*, so a peer behind the screen wall would otherwise show a name
  through it (worse with `depthTest={false}`). Once the cone+hysteresis test says "on," cast a single
  reused module-level `THREE.Raycaster` from the camera to the peer's head and compare the nearest
  hit distance to the distance-to-peer; a closer hit → occluded → force the target hidden.
  - **Target set:** the theater environment root loaded in `Theater.tsx` (cinema.glb). Expose it via
    a small ref — a `Scene`-level context, or a module-level ref `Theater` sets on load — that
    `<RemoteAvatar>` reads. Intersect **recursively** (`intersectObject(envRoot, true)`): cinema.glb's
    real meshes are auto-named children nested under the meaningful named groups, so a shallow
    intersect misses them. Treat an unset ref (first frames) as not-occluded.
  - **Cost:** only cast for peers currently inside the gaze cone (usually 0–1 at friends-scale) and
    throttle to ~15 Hz, caching the last result between casts — a raycast is far pricier than the dot
    product. Occlusion just AND-gates the damp target; when blocked the name fades out smoothly, no
    hard cut.
- **`<NameTag id />` owns its own gaze loop (Option B child; F4 already mounts its stub inside the
  group — F7 just fills in `NameTag.tsx`, no edit to `RemoteAvatar`).** Its own `useFrame` reads the
  peer's buffered position + `headHeight` and the local camera, computes `gazeAlignment` against the
  head, folds it through `nextGazeState` (hysteresis) and the throttled occlusion cast, damps a
  per-avatar opacity toward `(on && !occluded) ? 1 : 0`, writes it straight onto its own text
  material, and flips `visible` off below ~0.01 (skip the transparent draw + troika update when
  hidden). The gaze on/off flag and last-occlusion result live in **refs, never React state** — the
  same no-re-render discipline as movement (F2/F4); a `useState` gaze flag would re-render the peer
  on every look-toward/away, exactly the churn the buffer split exists to avoid. It reads
  `peerMeta[id].username` for the label — so `<NameTag>` takes only `{ id }`.
- *Deferred (optional, not MVP):* a max-distance cap or distance falloff so far-away peers' tiny,
  illegible tags don't show even when centred — skipped for now since the theater is a single
  not-huge room; add it only if across-the-room names feel noisy in practice.

---

## Infra / config units

- **`next.config.js`:** primary path uses Traefik (no change needed). If shipping the
  polling fallback instead, add the `/api/socket.io`-based client path (server stays default).
  Prefer leaving `next.config.js` untouched and using the Traefik router.
- **`deploy.yml`:** add the `theater-ws` PathPrefix router → port 8081 (see Routing section).
  Dev only runs via native `lilnas dev`.
- **`.env.example` / `.env`:** add `NEXT_PUBLIC_SOCKET_URL` (dev: `http://localhost:8081`; prod:
  empty/unset → same-origin). Document it like the existing keys. No new `EnvKeys` entry needed
  server-side (the client reads `process.env.NEXT_PUBLIC_*` directly; the dev CORS origin can be
  a constant gated on `NODE_ENV`).

---

## Security checklist

- **Handshake auth:** no valid signed `theater_session` → immediate disconnect. Only
  password-gated users reach the room (B2/B3).
- **Input validation:** every `presence` packet + the handshake `characterId` pass zod; drop on
  failure (never trust client geometry/enum/id).
- **`characterId` allowlist server-side** (`VALID_CHARACTER_IDS`) — a peer can't inject an
  arbitrary/huge `modelUrl` string; the client only ever maps a known id to a bundled asset.
- **Per-socket rate limit** on `presence` (min-interval) so one client can't flood the room.
- **CORS** is dev-only and origin-pinned to `http://localhost:8080` with credentials; prod is
  same-origin so CORS never engages.
- **Voice (4B):** mic is user-gated (`getUserMedia`) and secure-context-only; relay
  `rtc:signal` only to a `to` in the room; never log SDP/ICE. STUN only (no TURN yet).
- **Tablet (4C):** zod-validate `tablet:state` (enum `view`/`typeFilter`, finite `scrollTop ≥ 0`,
  bounded id/search strings) and rate-limit it like `presence`; the remote view is render-only
  (`pointer-events:none`, no store writes).
- Run the repo's diff security scan on the finished diff (auth + new public socket surface,
  plus the new WebRTC-signaling and tablet-state relays).

---

## Phase 4B — Spatial voice chat

**Goal (reqs 8–9).** Friends speak and hear each other; in **POV** each voice is attenuated
by distance (positional), in **fullscreen** it drops to plain non-spatial stereo; **`M`**
toggles mute. **Distance-only — no wall occlusion** (confirmed out of scope; the gaze-nametag
raycast in F7 is unrelated and stays there).

**Architecture — WebRTC mesh, signaled over the Phase-4 gateway.** At friends-scale (≤ ~6–8)
a full mesh (each client holds N−1 `RTCPeerConnection`s) needs no SFU and no TURN of its own —
media is peer-to-peer; the Socket.IO gateway from B3 is reused purely as the **signaling**
channel (SDP + ICE relay). Each peer's inbound audio routes through a `THREE.PositionalAudio`
attached to *their* avatar group, so distance attenuation falls out of Web Audio's panner for
free — the same dual-chain trick `useVideoAudio.ts` already uses for the movie (POV
`PositionalAudio` + fullscreen `Audio`, gain toggled on `view`).

### Contracts (add)

```ts
// Signaling — the server only forwards to `to`, never inspecting media:
'rtc:signal' (client → server) → { to: string; data: RtcSignal }
'rtc:signal' (server → target) → { from: string; data: RtcSignal }
type RtcSignal =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }

// Optional, so peers can show a muted-mic icon on the nametag:
'peer:mute' → { id: string; muted: boolean }   // relayed to the room
```

**Glare rule:** on `peer:join` / for each entry in `peers:init`, the peer whose `socket.id`
sorts **lower** creates the offer; the other only answers. Deterministic, so two peers never
both offer.

### Backend units

- **VB1 — signaling relay** (built in **Wave 2 as part of B3's single-owner gateway**, not a
  separate wave — see B3's "single gateway owner" note): `@SubscribeMessage('rtc:signal')`
  zod-validates `{ to, data }` (in its own `rtc.schema.ts`), confirms `to` is a socket in
  `THEATER_ROOM`, and emits `{ from: client.id, data }` to that socket only. Optional `peer:mute`
  → relay to room + update the roster entry. Rate-limit ICE (chatty). No media touches the server;
  never log SDP. No new deps — `socket.io` from B1 is all the server needs.

### Frontend units

- **VF1 — `src/voice/store.ts`** (module singletons, same discipline as F2): lazy
  `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl:
  true } })` for the one local mic stream; a `muted` flag; `Map<peerId, RTCPeerConnection>` and
  `Map<peerId, MediaStream>` (inbound) — both **module-level**, never React state (connection
  setup must not re-render the scene).
- **VF2 — peer-connection lifecycle** (driven off the F2 roster events): on a peer appearing,
  create `RTCPeerConnection` (public STUN), add the local mic track, follow the glare rule to
  offer/answer, trickle ICE through `rtc:signal`; `ontrack` stashes the inbound `MediaStream`.
  Tear down (`pc.close()`, drop stream) on `peer:leave`.
- **VF3 — `<PeerVoice id />`** (Option B child; F4 already mounts its stub inside the
  `<RemoteAvatar>` group — this unit only fills in `PeerVoice.tsx`, never touching `RemoteAvatar`):
  once the inbound stream for `id` exists (from the VF1 voice store), build the same dual chain as
  `useVideoAudio` — a `PositionalAudio` on the avatar group (POV) + a plain `Audio` (fullscreen) fed
  from one `MediaStreamAudioSourceNode` (`setMediaStreamSource`), gain toggled on `view`. As a child
  of the interpolated group, the panner tracks the avatar automatically. Distance-only: leave the
  panner's default distance model. **Chrome gotcha:** a WebRTC `MediaStream` won't pump through Web
  Audio unless it's *also* attached to a muted, off-DOM `HTMLAudioElement` sink — create one per peer.
- **VF4 — mute on `M`** in `viewControls.ts` (behind the existing `isEditingText()` guard so it
  doesn't fire in the iPad search box): toggle every local mic track's `.enabled`, flip the
  store `muted`, optionally emit `peer:mute`. A tiny corner mic indicator reads `muted`. (`M` is
  currently unbound — only `Tab`/`Escape`/`F` are taken.)
- **VF5 — permission UX:** prompt on first join (or first unmute); on denial, disable voice
  gracefully (you still see everyone) and surface a one-line note. AudioContext resume is
  already globally handled (`useVideoAudio` resumes on first pointerdown).

### Security / infra

- Mic is **user-gated** (`getUserMedia` prompt) and needs a secure context — prod is HTTPS,
  dev `localhost` counts as secure. Relay `rtc:signal` only to a `to` inside the room; never
  log SDP/candidates. Public STUN (e.g. `stun:stun.l.google.com:19302`) suffices on home
  networks; **TURN is not included** — add coturn later only if a strict-NAT friend can't
  connect. Optionally expose the STUN list via `NEXT_PUBLIC_STUN_URLS`; a hardcoded default is
  fine to start.

### Acceptance

- Two tabs (on headphones, to avoid feedback) hear each other; volume falls off with distance
  in POV; `F` to fullscreen → equal-volume non-spatial; `M` mutes/unmutes (the other tab stops
  hearing you); closing a tab drops its audio and connection.

---

## Phase 4C — Tablet presence + UI mirroring

**Goal (req 10).** See a peer **open** their tablet (one appears in their hands) and see the
**library UI they're navigating/scrolling** — the poster grid, search, series/season
drill-down, and scroll position — mirrored in near-real-time.

**Approach — broadcast UI *state*, re-render on the remote (not pixel streaming).** The tablet
UI (`IpadBrowser.tsx`) is a drei `<Html transform>` DOM panel. Mirroring it means broadcasting
the small set of values that define what's on screen and re-rendering the *same* component,
read-only, on a world-space tablet attached to the peer's avatar. Because it's the same backend
and the same session cookie, the remote fetches identical `/api/theater/*` data, so grids / art
/ lists resolve the same. Pixel/canvas streaming is rejected (huge bandwidth, blurry,
pointless here).

### Precondition refactor (TF1)

Split `IpadBrowser.tsx` into:

- **`IpadBrowserView`** — presentational: takes the full UI state as props + an
  `interactive: boolean`. When `interactive` is false: `pointer-events: none`, no store writes,
  no key/click handlers — purely a display of someone else's tablet. Keeps *all* current
  rendering (grid, search box, filter pills, seasons/episodes, the data-fetching effects keyed
  on the state props).
- **local `IpadBrowser`** — owns input + the camera-HUD positioning exactly as today, and
  additionally **broadcasts** its UI state (below). Local behavior must stay byte-for-byte
  identical (this is the shipped, working tablet — don't regress it).

### Contracts (add)

```ts
// Client → server, throttled ~10 Hz while open + immediately on any change:
'tablet:state' → {
  open: boolean
  view: 'grid' | 'seasons' | 'episodes'
  seriesId: string | null
  seasonId: string | null
  search: string
  typeFilter: 'all' | 'movie' | 'series'
  scrollTop: number            // px of the scrollable grid/list container
}
'peer:tablet' → { id: string } & TabletState   // server → room
```

Fold the latest `TabletState` into `PeerSnapshot`/`peers:init` too, so a late joiner sees a
tablet that's *already* open.

### Backend unit

- **TB1 — relay** (built in **Wave 2 as part of B3's single-owner gateway**, not a separate wave):
  `@SubscribeMessage('tablet:state')`, zod-validate in its own `tablet.schema.ts` (enum
  `view`/`typeFilter`, finite `scrollTop ≥ 0`, bounded id/search strings), store on the roster
  entry, relay as `peer:tablet` to the room. Same per-socket rate-limit shape as `presence`.

### Frontend units

- **TF2 — broadcast** from the local `IpadBrowser` (TF1): on any change to
  `{ ipadOpen, browse, search, typeFilter }` and, throttled, on scroll of the grid container
  (`onScroll` → `scrollTop`), emit `tablet:state`. Silent when nothing changed.
- **TF3 — `<RemoteIpad id />`** (Option B child; F4 already mounts its stub inside the
  `<RemoteAvatar>` group — this unit only fills in `RemoteIpad.tsx`, never touching `RemoteAvatar`):
  reads the peer's tablet state from the multiplayer store by `id`; renders nothing while `open` is
  false. When open: a world-space tablet — reuse the `RoundedBox` body from `IpadBrowser` — sits at
  hands/chest height in the group, facing outward, carrying `<IpadBrowserView interactive={false}
  …peerTabletState />` via drei `<Html transform occlude>`. Apply the peer's `scrollTop` to the grid
  container each update (via a ref, lightly smoothed). It fetches its own `items`/`seasons`/
  `episodes` from the peer's broadcast ids.

### Boundary with Phase 5

`tablet:state` carries **navigation** (what they're browsing/scrolling), not playback
transport. Play/pause/quality/seek belong to the Phase-5 video-sync anchor (`store.ts`), so this
phase deliberately does **not** mirror the tablet's playback-control row — that rides video
sync, avoiding two sources of truth.

### Acceptance

- `Tab` opens a peer's tablet in your view (it appears in their hands with the library grid);
  their search / filter / series→season→episode drill-down and scrolling mirror in your view
  within ~100–200 ms; closing it (Tab/Esc) removes the tablet.

---

## Suggested wave breakdown (for `theater-impl` sub-agents)

Scope each unit to the files it names; no cross-file edits outside scope; lint + type-check +
test each before hand-off (this app's sub-agent convention).

The authoritative dispatch schedule (batches, file-ownership, gates, per-unit scopes) lives in
`ORCHESTRATE.md`; this is the summary view.

1. **Wave 1 (4 parallel — zero shared files):** B1 deps · B2 `verifySessionCookie` (+test) ·
   `clipTracks.ts` extraction (+test, F3 first half — pure, no R3F) · **A1** strafe-clip conversion.
2. **Wave 2 (backend, single gateway owner — sequential within):** B3 gateway/module/constants +
   the `presence`/`rtc`/`tablet` schema files + **all three relays** (presence, VB1 `rtc:signal`,
   TB1 `tablet:state`) · B4 gateway tests. Depends on B1/B2. This is the *only* wave that writes
   `presence.gateway.ts`.
3. **Wave 3 (frontend presence + directional):** internally ordered —
   - **3a (3 parallel):** F1 threading · F2 store · F3 `<Avatar>` (5-clip set + speed-matched
     `timeScale`) · `gaze.ts` (pure helper, F7 first half).
   - **3b (2 parallel):** F4 `<RemoteAvatars>` + `<RemoteAvatar>` shell — **creates the four child
     slots incl. the `NameTag`/`PeerVoice`/`RemoteIpad` stub files** (Option B), +interp tests ·
     F5 `<LocalPresence>` (directional classification).
   - **3c:** F7 fills `NameTag.tsx` + the theater env-root ref in `Theater.tsx` (needs F4's stub).
   Depends on the contracts + `clipTracks` + A1.
4. **Wave 4 (wiring + infra, parallel):** F6 Scene wiring · deploy.yml router · env files.
5. **Wave 5 (voice — FULLY parallel with Wave 6, no shared files):** VF1 voice store · VF2 PC
   lifecycle · VF3 fills the `PeerVoice.tsx` stub · VF4 `M` mute (`viewControls.ts`) · VF5 permission.
   Backend (VB1) already shipped in Wave 2. Depends on the gateway (Wave 2) + the F4 shell (Wave 3).
6. **Wave 6 (tablet — FULLY parallel with Wave 5, no shared files):** TF1 `IpadBrowser` refactor ·
   TF2 broadcast · TF3 fills the `RemoteIpad.tsx` stub. Backend (TB1) already shipped in Wave 2.
   Depends on the gateway (Wave 2) + the F4 shell (Wave 3).
   Then a full `pnpm --filter @lilnas/theater build` + `pnpm --filter @lilnas/theater test`.

---

## Risks & gotchas

- **WS through the proxy** — the one flagged spot. Traefik router is the fix; polling-through-
  `/api` is the fallback. Verify the transport actually upgrades (browser devtools → WS frames),
  not just that it connects.
- **StrictMode double-connect** — guard `connect()`; don't disconnect on the throwaway first
  mount (prior art: tdr-code logs-viewer StrictMode race).
- **Clip root-motion** — remote avatars must use `stripToRotation` (quaternion-only) or feet
  slide / the body double-moves. The shipped clips have a known units bug (~100× root travel);
  quaternion-only sidesteps it entirely.
- **Feet grounding** — `p` is feet-at-origin; `<Avatar>` must recenter feet to the group origin
  once, or avatars float/sink relative to the floor.
- **Yaw only** — never feed camera pitch into the avatar's rotation. (Deliberate counterpoint: the
  F7 *gaze test* uses the full camera direction incl. pitch — body compass-bearing vs. reticle.)
- **Nametag opacity must not re-render** — drive the F7 fade by mutating the text material in
  `useFrame`, never `useState`; a gaze boolean in React state re-renders the peer on every
  look-toward/away, exactly the churn F2's buffer split exists to avoid.
- **Occlusion raycast** — cast against the theater env root **recursively** (cinema.glb's real
  meshes are auto-named children under the meaningful named groups; a shallow intersect hits
  nothing), guard for the env-root ref being unset on the first frames, and throttle to ~15 Hz for
  only the in-cone peers — an every-frame raycast per peer is far pricier than the dot product.
- **Foot-skate / clip cadence** — remote walk clips are in-place (`stripToRotation`), so the
  active walk clip's `timeScale` must track the rendered speed (F3/F4) or feet slide; tune the
  per-clip `NATURAL_SPEED` constants by eye (the root track is unusable for this — ~100× units bug).
- **Clip↔skeleton binding across the cast** — the strafe/walk clips are `mixamorig:`-named and
  bind to the Mixamo-rigged characters, but the RPM-rigged Charlie uses bare bone names (known
  prior issue). Confirm all five clips bind on every *selectable* character, or gate the odd one out.
- **Voice — MediaStream through Web Audio** — the Chromium quirk (needs a muted `<audio>` sink
  per peer) or the panners stay silent; pick a deterministic offerer to avoid glare; rely on
  `echoCancellation` + recommend headphones to avoid feedback; the mesh is friends-scale only.
- **Tablet — remote `<Html>` churn** — unmount the overlay when a peer's tablet closes; don't
  drive the remote view from React state on every scroll tick (throttle; use refs where hot).
- **No visual verification in this app** — per convention, validate via `tsc`/tests/build +
  source reading; the user click-tests live and reports bugs. A two-tab manual demo (open two
  browsers, pick different characters, walk toward each other) is the acceptance check.

---

## Manual demo / acceptance checklist

1. Two browser tabs (or two machines), both logged in, each picks a *different* character.
2. Each tab sees the other's avatar appear (`peer:join`) at the spawn area.
3. Walking in one tab shows smooth movement + the walk animation in the other; stopping returns
   to idle.
4. Yaw turns the remote avatar; looking up/down does **not** tilt it.
5. Closing a tab removes that avatar in the other (`peer:leave`).
6. Devtools shows a WebSocket connection (transport upgraded), not just long-polling — unless
   intentionally on the polling fallback.
7. Looking near-directly at a peer fades their username in above their head; looking away fades it
   out. Two tabs on the *same* character are still tellable apart by name.
8. A peer standing behind the screen wall shows **no** name even when you look toward them
   (occlusion); step into their line of sight and the name fades in.
9. Walking backward plays the back clip and strafing plays the matching strafe clip on the remote
   avatar (not a forward walk); step cadence visibly speeds up when a peer runs and slows when
   they creep — feet don't obviously skate.
10. Two tabs hear each other; voice gets quieter with distance in POV, becomes equal-volume in
    fullscreen (`F`), and `M` mutes/unmutes.
11. Opening a peer's tablet shows it in their hands with the library UI; their scrolling and
    drill-down mirror in your view; closing it removes the tablet.
