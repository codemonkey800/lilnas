# Theater Phase 4 — ORCHESTRATE.md

**Authoritative contracts + dispatch plan for the theater multiplayer build.** The
`theater-impl` sub-agent reads this file before writing any code. `PLAN.md` is the *design
rationale* (why each unit exists, the tradeoffs); **this file is the source of truth for
interfaces, file ownership, and the dispatch schedule.** If the two ever disagree, this file
wins for contracts and ownership.

Guiding principle — **Option B everywhere**: every convergence point (the per-peer
`RemoteAvatar`, the Socket.IO gateway) has **exactly one writer**. Features attach as
separate files (child components; separate schema files) so parallel units never edit the
same file. That's what makes Waves 5 and 6 fully parallel.

---

## §0 How to use this file

**Orchestrator (main agent):** dispatch units in the batches of §5, one `theater-impl`
sub-agent per unit. Between batches, run the gate (§5) and read each agent's return summary to
confirm the exported symbols match §1 before starting the next batch.

**Sub-agent (`theater-impl`):** before writing, read §1 (the contracts you build against) and
find your unit in §2 (the exact files you may write and the files you must not touch). Follow
§6 guardrails. Your task message names your unit id (e.g. "F4"); everything you need is here.

---

## §1 Frozen contracts (build exactly to these)

### Wire protocol (Socket.IO)

```ts
// Handshake — client → server, in socket.handshake.auth:
{ characterId: string }                         // validated server-side vs VALID_CHARACTER_IDS

// Presence — client → server, ~13 Hz, dead-banded:
'presence'       → { p: [number,number,number]; y: number; a: AnimState }   // feet pos, yaw(rad)

// Server → the joining client, once:
'peers:init'     → PeerSnapshot[]               // everyone already in room, excludes self

// Server → the rest of the room:
'peer:join'      → PeerSnapshot
'peer:leave'     → { id: string }
'peer:presence'  → { id: string; p: [number,number,number]; y: number; a: AnimState }

// Voice signaling (Phase 4B) — server forwards to `to`, never inspects media:
'rtc:signal' (c→s) → { to: string;   data: RtcSignal }
'rtc:signal' (s→t) → { from: string; data: RtcSignal }
'peer:mute'        → { id: string; muted: boolean }        // s→room (optional icon)

// Tablet mirroring (Phase 4C) — client → server, throttled ~10 Hz while open + on change:
'tablet:state'   → TabletState
'peer:tablet'    → { id: string } & TabletState            // s→room

type AnimState = 'idle' | 'walk_fwd' | 'walk_back' | 'strafe_left' | 'strafe_right'

type RtcSignal =
  | { kind: 'offer' | 'answer'; sdp: string }
  | { kind: 'ice'; candidate: RTCIceCandidateInit }

type TabletState = {
  open: boolean
  view: 'grid' | 'seasons' | 'episodes'
  seriesId: string | null
  seasonId: string | null
  search: string
  typeFilter: 'all' | 'movie' | 'series'
  scrollTop: number
}

// Late joiners must see already-open tablets / muted peers, so PeerSnapshot carries them:
type PeerSnapshot = {
  id: string; username: string; characterId: string
  p: [number,number,number]; y: number; a: AnimState
  muted?: boolean
  tablet?: TabletState
}
```

`id` = `socket.id`. MVP is a single hard-coded room `THEATER_ROOM`.

### Client state shapes

```ts
// src/multiplayer/store.ts (zustand — React-visible; changes only on join/leave/nav):
{
  status: 'idle' | 'connecting' | 'connected' | 'error'
  peerIds: string[]                                  // drives mount/unmount of <RemoteAvatar>
  peerMeta: Record<string, { characterId: string; username: string }>
  peerTablets: Record<string, TabletState>           // nav state; RemoteIpad reads by id
  connect(characterId: string): void
  disconnect(): void
}

// src/multiplayer/store.ts — MODULE-LEVEL, non-React (hot path, never triggers re-render):
peerBuffers: Map<string, {
  targetPos: THREE.Vector3
  targetYaw: number
  animState: AnimState
  speed: number          // written by the F4 shell (smoothed render speed) for <Avatar>
  headHeight?: number    // written once by <Avatar> on load, for <NameTag> placement
}>

// src/voice/store.ts (VF1) — zustand: { muted: boolean }; MODULE-LEVEL, non-React:
localStream: MediaStream | null
pcs: Map<string, RTCPeerConnection>
inbound: Map<string, MediaStream>
```

### `<RemoteAvatar>` → child component contract (Option B — do not deviate)

Every child is a child of the interpolated `<group>` and takes **only `{ id }`**, reading its
hot data from `peerBuffers` / the voice + tablet stores by id. The one exception is `<Avatar>`,
which stays presentational:

```tsx
<Avatar    modelUrl={string} animState={AnimState} speed={number} />   // F3
<NameTag   id={string} />                                             // F7
<PeerVoice id={string} />                                             // VF3
<RemoteIpad id={string} />                                            // TF3
```

### Env + constants

```
NEXT_PUBLIC_SOCKET_URL   dev: http://localhost:8081   prod: empty/unset (same-origin)
NEXT_PUBLIC_STUN_URLS    optional; default 'stun:stun.l.google.com:19302'
THEATER_ROOM             single hard-coded room id (server)
VALID_CHARACTER_IDS      Set mirroring CHARACTERS ids in CharacterSelect/characters.ts
PRESENCE_MIN_INTERVAL_MS per-socket rate-limit floor (server)
```

---

## §2 File-ownership matrix

Each unit **writes only** its "Owns" files and **must not edit** anything else. "Depends on"
means that unit's outputs (symbols in §1) must exist first.

| Unit | Wave | Owns (creates / writes) | Must NOT touch | Depends on |
|------|------|-------------------------|----------------|------------|
| **B1** deps | 1 | `package.json`, `pnpm-lock.yaml` | any source | — |
| **B2** cookie | 1 | `src/auth/auth.service.ts` (+ `__tests__/auth.service.test.ts`) | presence, components | — |
| **F3a** clipTracks | 1 | `src/components/Scene/clipTracks.ts` (+ test); import-only refactor of `CharacterSelect/CharacterModel.tsx` | Avatar, RemoteAvatars | — |
| **A1** strafe clips | 1 | `public/animations/walk-strafe-{left,right}.glb` (via `convert` CLI) | source | — |
| **B3+VB1+TB1** gateway | 2 | `src/presence/{presence.module,presence.gateway,presence.constants,presence.schema,rtc.schema,tablet.schema}.ts`; register in `src/app.module.ts` | frontend, auth internals | B1, B2 |
| **B4** gateway tests | 2 | `src/presence/__tests__/presence.gateway.test.ts` | gateway impl | B3 |
| **F1** thread id | 3a | `src/components/TheaterApp.tsx`, `Scene/SceneView.tsx`, `Scene/Scene.tsx` (prop signatures only) | store, avatars | contracts |
| **F2** store | 3a | `src/multiplayer/store.ts` | components | contracts |
| **F3b** Avatar | 3a | `src/components/Scene/Avatar.tsx` | RemoteAvatars, store | F3a, A1 |
| **F7a** gaze | 3a | `src/components/Scene/gaze.ts` (+ test) | components | contracts |
| **F4** shell + stubs | 3b | `src/components/Scene/RemoteAvatars.tsx` (+ interp-helper test); **creates stub files** `Scene/NameTag.tsx`, `Scene/PeerVoice.tsx`, `Scene/RemoteIpad.tsx` (`return null`) | Avatar, store internals | F2, F3b |
| **F5** local presence | 3b | `src/components/Scene/LocalPresence.tsx` | RemoteAvatars | F2 |
| **F7** nametag fill | 3c | `src/components/Scene/NameTag.tsx` (fills F4 stub); `Scene/Theater.tsx` (env-root ref) | RemoteAvatars.tsx | F4, F7a |
| **F6** wiring | 4 | `src/components/Scene/Scene.tsx` (render + connect) | — | F1, F2, F4, F5 |
| **infra** | 4 | `apps/theater/deploy.yml`, `apps/theater/.env.example` | source | — |
| **VF1/VF2** voice core | 5 | `src/voice/store.ts`, `src/voice/peerConnections.ts` | RemoteAvatars.tsx, gateway | B3(VB1), F2 |
| **VF3** PeerVoice fill | 5 | `src/components/Scene/PeerVoice.tsx` (fills F4 stub) | RemoteAvatars.tsx | F4, VF1 |
| **VF4** mute | 5 | `src/components/Scene/viewControls.ts` (add `M`) | — | VF1 |
| **VF5** mic UX | 5 | `src/voice/store.ts`, a small `Scene/MicIndicator.tsx` | RemoteAvatars.tsx | VF1 |
| **TF1** iPad split | 6 | `src/components/Scene/IpadBrowser.tsx` → also create `Scene/IpadBrowserView.tsx` | RemoteAvatars.tsx | contracts |
| **TF2** broadcast | 6 | `src/components/Scene/IpadBrowser.tsx` (same track as TF1) | — | TF1, F2 |
| **TF3** RemoteIpad fill | 6 | `src/components/Scene/RemoteIpad.tsx` (fills F4 stub) | RemoteAvatars.tsx | F4, TF1 |

**Stub-handoff rule (the crux of Option B):** F4 *creates* `NameTag.tsx`, `PeerVoice.tsx`,
`RemoteIpad.tsx` as `return null` stubs and mounts them in `RemoteAvatar`. After F4, **those
three files change owner** — F7 owns `NameTag.tsx`, VF3 owns `PeerVoice.tsx`, TF3 owns
`RemoteIpad.tsx`. Each filler edits only its own file; **nobody re-opens `RemoteAvatars.tsx`.**

**Cross-wave shared files (safe because sequential):** `Scene.tsx` (F1 wave 3 → F6 wave 4);
`IpadBrowser.tsx` (TF1 → TF2, same track). No file is written by two *concurrent* units.

---

## §3 The `RemoteAvatar` composition root (frontend Option B)

`RemoteAvatar` is a thin shell: it interpolates the `<group>` transform from `peerBuffers` and
mounts the four children **inside the group** (so transform inheritance places them on the
avatar). It does not contain nametag, voice, or tablet logic — those live in the child files.

- The shell's single `useFrame` does *only*: lerp position, wrap/slerp yaw, and write smoothed
  `speed` into the buffer. Each child runs its **own** small `useFrame` reading `peerBuffers` /
  stores by id.
- Children never receive per-frame props (that would re-render). `animState` (rare) may be a
  prop to `<Avatar>`; `speed` is read by `<Avatar>` from the buffer.
- Cost of Option B vs. one fused loop: a few extra `useFrame` callbacks per peer — negligible
  at ≤ 8 peers. Benefit: NameTag/voice/tablet are independent files → parallel, no collisions.

---

## §4 Gateway single-owner (backend Option B)

`presence.gateway.ts` is written **once**, in Wave 2, by one agent. It implements *all three*
relays — `presence`, `rtc:signal`/`peer:mute` (VB1), `tablet:state` (TB1) — each validated by
its **own** schema file (`presence.schema.ts`, `rtc.schema.ts`, `tablet.schema.ts`). The rtc
and tablet handlers are trivial validated pass-throughs; building them now (against the frozen
§1 contracts) means the voice/tablet **frontend** waves add zero backend code and touch zero
shared files. No later wave reopens the gateway.

---

## §5 Dispatch schedule (batches + gates)

Spawn one `theater-impl` sub-agent per unit. Units on the same line run **concurrently**.
After each batch, run the **gate** before proceeding. `⛔` = hard gate (must pass).

```
Batch 1  (Wave 1) ── 4 concurrent:  B1 · B2 · F3a · A1
   ⛔ gate: B1 ran `pnpm install`; `pnpm --filter @lilnas/theater type-check && test` green;
            A1 produced two GLBs that load.

Batch 2  (Wave 2) ── 1 agent (gateway is single-owner), then its tests:
            B3+VB1+TB1  →  B4
   ⛔ gate: type-check + test green; gateway appears in boot logs; the three schema files exist.

Batch 3  (Wave 3a) ── 4 concurrent:  F1 · F2 · F3b · F7a
   ⛔ gate: type-check green (F2 exports match §1 store shape; F3b exports <Avatar> per §1).

Batch 4  (Wave 3b) ── 2 concurrent:  F4 · F5
   ⛔ gate: type-check green; F4 created the 3 stub files and mounts all 4 children;
            interp-helper unit tests pass.

Batch 5  (Wave 3c) ── 1 agent:  F7 (fills NameTag.tsx + Theater env-root ref)
   ⛔ gate: type-check + test green.

Batch 6  (Wave 4) ── 3 concurrent:  F6 · deploy.yml · env
   ⛔ gate: full `pnpm --filter @lilnas/theater build` + `test` green.
   👤 human demo: two tabs, different characters, see each other walk/strafe; WS upgraded.

Batch 7  (Waves 5 + 6 — fully parallel, no shared files):
   7a ── 2 concurrent:  VF1+VF2 (voice core)  ‖  TF1 (iPad split)
   7b ── concurrent:    VF3 · VF4 · VF5        ‖  TF2 · TF3
   ⛔ gate: full build + test green.
   👤 human demo: voice (distance in POV, stereo in fullscreen, M mute) + tablet mirroring.
```

**Peak concurrency:** 4 (Batch 1 / Batch 3). **Critical path:** B1→B3→F2→F4→(VF3‖TF3)→demo.

**Verification at every gate:** `pnpm --filter @lilnas/theater type-check` + `test`; add
`build` at Batches 6 and 7. Sub-agents self-verify their own files (type-check + eslint/prettier,
per §6); the orchestrator runs the *integration* build/test at gates — a type error in another
in-flight unit's file is expected mid-wave and is not a sub-agent's job to fix.

---

## §6 Guardrails (every sub-agent)

- **Scope:** write only your unit's "Owns" files (§2). Never edit a file owned by another unit.
  If you believe you need to, stop and report it in your return summary instead.
- **Build to §1 contracts** exactly — other units are coding against the same symbols in
  parallel. Do not rename or reshape a shared type/event/store field; if a contract looks wrong,
  flag it, don't unilaterally change it.
- **No unrelated skills** — do not run code-review, security-review, or any other skill.
- **No runtime verification** — do not start dev servers or use any browser/screenshot tooling.
  Rendering is verified by the human. Your verification is type-check + lint only.
- **Match conventions** — prettier + eslint flat config, `cns()` for className composition,
  avoid `any`, boundary-validate untrusted input with zod. Read a neighboring file first.
- **Verify before hand-off:** `pnpm --filter @lilnas/theater type-check:app` (your files clean —
  errors in other in-flight units' files are expected, note them, don't fix); then
  `eslint --fix` + `prettier -w` on the files you changed.

**Return summary (your value to the orchestrator):** files changed · the exported symbols /
interfaces you established (so the orchestrator can check them against §1 before the next wave)
· any deviation from a §1 contract and why · the outcome of your verify commands. No preamble.

---

## §7 Notes for the orchestrator

- **Contract-drift check between waves:** read each return summary; confirm the exported store
  shape (F2), `<Avatar>` props (F3b), gateway event names (B3), and child props (F4 stubs) match
  §1 verbatim before dispatching dependents. A mismatch caught here is cheap; caught in Batch 7
  it is not.
- **Stub files must compile:** after Batch 4, `PeerVoice.tsx` / `RemoteIpad.tsx` sit as
  `return null` through Wave 4 — that's intended; the build stays green.
- **Waves 5 and 6 are independent** — if running low on parallelism budget, ship voice first,
  then tablet; nothing in tablet depends on voice or vice-versa.
- **Fallbacks live in PLAN.md** (the `/api/socket.io` polling fallback for the WS route; the
  TURN-later note for voice) — reach for them only if the primary path misbehaves at a gate.
