# Phase 1 — Theater + Collision (Build Spec)

**App:** `apps/theater` (`@lilnas/theater`) · **Date:** 2026-07-19
**Audience:** the implementing agent (assume **no prior conversation context** —
everything needed is in this document).
**Design source:** [Notion — Lilnas Theater](https://app.notion.com/p/3a2ee12be1ec806bbff0f85657c3967a)

> Scope: **Phase 1 only** — replace the flat fly-camera scene with the real
> cinema model, walked in first-person under Rapier physics with collision.
> No video, no multiplayer, no character model yet (those are Phases 2–5).

---

## 1. Context you need

`@lilnas/theater` is a hybrid app: **NestJS backend (:8081)** + **Next.js 15 /
React 19 frontend (:8080)**, with `/api/*` proxied to the backend. The 3D layer
is **React Three Fiber (R3F) v9** (React-component wrapper over Three.js).

**Current state (Phase 0, already shipped)** — a first-person *fly* camera:
- `src/components/Scene/Scene.tsx` — `<Canvas>`, lights, a cosmetic `<Floor>`
  (plane + drei `<Grid>`), five non-colliding boxes, `<Player>`, drei
  `<PointerLockControls>`, wrapped in `<KeyboardControls>`.
- `src/components/Scene/Player.tsx` — a `useFrame` loop that moves
  `state.camera` on WASD and hard-clamps `camera.position.y = 1.7`. **No physics,
  no gravity, no collision.**
- `src/components/Scene/SceneView.tsx` — `next/dynamic(..., { ssr: false })`
  wrapper. **Keep this ssr:false** — Rapier/WASM must never run server-side.
- `src/components/Scene/Floor.tsx` — the cosmetic plane + grid.

**Installed, relevant versions** (do not change): `react` / `react-dom`
`19.2.0`, `three` `0.185.1`, `@react-three/fiber` `9.6.1`,
`@react-three/drei` `10.7.7`, `next` `15.5.20`.

**Phase 1 delivers:** load the real cinema GLB, stand inside it, walk around in
first-person held down by gravity, and be blocked by the floor and walls.

### Definition of done
1. Page loads → the real cinema renders and the player **settles on the floor**.
2. **WASD walks**, mouse controls look; movement respects the room.
3. You **cannot fall through the floor or walk through the perimeter walls**.
4. `pnpm --filter @lilnas/theater type-check | lint | build` all pass.
5. No console errors; no SSR/WASM error on hard reload.

---

## 2. The asset (already in place — measured, do not re-derive)

| | |
| --- | --- |
| **Runtime file** | `apps/theater/public/models/cinema.glb` → served at **`/models/cinema.glb`** |
| **Size / format** | **3.44 MB**, glTF 2.0, `EXT_meshopt_compression` + `KHR_mesh_quantization` |
| **Geometry** | 391,904 triangles · 532 nodes · 510 meshes · 8 materials · **0 textures** |

**Decoding:** drei's `useGLTF` decodes meshopt with a **bundled** decoder
(`MeshoptDecoder` from `three-stdlib`) and handles `KHR_mesh_quantization`
natively in `GLTFLoader`. **No DRACO, no external CDN, no Next webpack/WASM
config.** Just `useGLTF('/models/cinema.glb')`.

**Geometry facts (world space — meshopt + quantization preserve world
positions, so these hold for the shipped `cinema.glb`):**
- Full bounds: `min [-72.30, -1.30, -32.11]`, `max [-66.65, 3.70, -20.91]`
  → room ≈ **5.65 (X) × 5.00 (Y) × 11.20 (Z)** meters. Scale is metric; a 1.7 m
  player fits — **do not rescale**.
- **The model is offset from origin** (centered near x≈−69.5, z≈−26.5; not at 0)
  and the **floor is raked** (stadium seating): floor y runs **−1.30 at the
  screen end up to +1.15 at the back**.
- **`wall_screen`** node (Phase 3 video target, not needed in Phase 1): a flat
  quad, world center `[-69.47, 1.79, -22.46]`, size **4.07 × 1.85 m**, on the
  screen-end wall. Named nodes `floor`, `floor_metal`, `wall`, `wall_metal`,
  `ceilling` also survive — locate parts by name via `scene.getObjectByName(...)`.

**Known limitations (not Phase 1 blockers — see §7/§9):**
- 510 meshes ⇒ ~510 draw calls (seats are fragmented into ~6–9 sub-meshes each).
  Fine at friends-scale; merge-by-material is a Phase 6 perf task.
- Seats are **not** grouped/named per seat, so seat markers can't be read from
  the GLB — they'll be authored by hand in Phase 5.
- **License unknown** (user-sourced). Fine for local dev; confirm terms before
  the app is exposed. Not a Phase 1 blocker.

---

## 3. Dependencies to add

```bash
# from repo root
pnpm --filter @lilnas/theater add @react-three/rapier@2.2.0 ecctrl@1.0.97 leva@0.10.1
```

| Package | Version | Why / pin rationale |
| --- | --- | --- |
| `@react-three/rapier` | `2.2.0` | Rapier physics for R3F. Peers (`R3F ^9.0.4`, `react ^19`, `three ≥0.159`) all satisfied. Its `@dimforge/rapier3d-compat` **inlines WASM as base64** → no webpack config. |
| `ecctrl` | `1.0.97` | Capsule character controller on Rapier (first-person). **Pinned to 1.0.97, NOT 2.0.0:** v2 peer-requires `react ≥19.2.7` (app is `19.2.0`) and makes `leva` a required peer. v1.0.97 needs only `react ≥19.1.0` / `R3F ≥9.0` / `rapier ≥2.0.0` / `three ≥0.177` — all satisfied, **no React bump** — and bundles `zustand` + `@react-spring/three`. |
| `leva` | `0.10.1` | ecctrl renders a leva debug panel by default; we import `<Leva hidden />` to suppress it. Must be a **direct** dep (pnpm won't resolve `import { Leva } from 'leva'` from ecctrl's nested copy). |

> Do **not** bump React, three, R3F, or drei. Do **not** add `zustand`
> explicitly yet (arrives via ecctrl; add it in Phase 4 for the multiplayer store).

### Verified compatibility

| Peer | Installed | ecctrl 1.0.97 | rapier 2.2.0 | OK |
| --- | --- | --- | --- | --- |
| react / react-dom | 19.2.0 | ≥19.1.0 | ^19 | ✅ |
| @react-three/fiber | 9.6.1 | ≥9.0 | ^9.0.4 | ✅ |
| @react-three/drei | 10.7.7 | ≥9.0 | — | ✅ |
| three | 0.185.1 | ≥0.177.0 | ≥0.159 | ✅ |

---

## 4. Target architecture

```
SceneView.tsx  (next/dynamic ssr:false)          ← unchanged
  └─ Scene.tsx
       ├─ <Leva hidden />                          ← DOM, OUTSIDE <Canvas>
       ├─ <Canvas>
       │    ├─ lights (ambient + directional)
       │    └─ <Suspense fallback={null}>          ← GLB fetch + Rapier WASM suspend here
       │         └─ <Physics debug={DEV}>          ← gravity [0,-9.81,0]
       │              ├─ <Theater />                ← loads /models/cinema.glb, recenters, adds colliders
       │              └─ <Player />                 ← ecctrl first-person capsule + placeholder body
       └─ crosshair / HUD hint (DOM overlay)
```

Component boundaries chosen so later phases slot in cleanly: `<Theater>` already
owns the model + colliders; `<Player>`'s placeholder body becomes the real
character model in Phase 2; `wall_screen` is found by name in Phase 3.

---

## 5. Implementation steps

### Step 1 — Install deps (§3), confirm no unmet-peer errors.

### Step 2 — `Player.tsx`: ecctrl first-person controller (rewrite)
Replace the manual camera loop with `<Ecctrl>`. **Critical:** ecctrl reads
specific `KeyboardControls` action names — the current map uses `left`/`right`,
which ecctrl **silently ignores**. Export the corrected map + type:

```ts
export type Controls =
  | 'forward' | 'backward' | 'leftward' | 'rightward' | 'jump' | 'run'

export const KEYBOARD_MAP: KeyboardControlsEntry<Controls>[] = [
  { name: 'forward',   keys: ['KeyW', 'ArrowUp'] },
  { name: 'backward',  keys: ['KeyS', 'ArrowDown'] },
  { name: 'leftward',  keys: ['KeyA', 'ArrowLeft'] },   // was 'left'  ← ecctrl needs 'leftward'
  { name: 'rightward', keys: ['KeyD', 'ArrowRight'] },  // was 'right' ← ecctrl needs 'rightward'
  { name: 'jump',      keys: ['Space'] },
  { name: 'run',       keys: ['ShiftLeft', 'ShiftRight'] },
]
```

First-person `<Ecctrl>` config (verified against the ecctrl README — this set is
what makes it first-person; the camera is owned by ecctrl):

```jsx
<Ecctrl
  camCollision={false}
  camInitDis={-0.01}
  camMinDis={-0.01}
  camFollowMult={1000}
  camLerpMult={1000}
  turnVelMultiplier={1}
  turnSpeed={100}
  mode="CameraBasedMovement"
  position={[0, 1, -3]}   // spawn: back of room, above floor (see §2 coords)
>
  {/* Phase-1 placeholder body — invisible/simple; replaced by the real model in Phase 2.
      ecctrl needs a child mesh; the capsule collider size is set via ecctrl props,
      independent of this mesh. */}
  <mesh visible={false}><capsuleGeometry args={[0.3, 1.0]} /><meshBasicMaterial /></mesh>
</Ecctrl>
```

Remove the old `useFrame` camera code and the `EYE_HEIGHT` clamp.

### Step 3 — `Theater.tsx` (new): load, recenter, collide
Load and **recenter at runtime** (robust — no hardcoded magic numbers):

```tsx
const { scene } = useGLTF('/models/cinema.glb')
// horizontal center → origin, lowest point → y=0
const box = new THREE.Box3().setFromObject(scene)
const c = box.getCenter(new THREE.Vector3())
scene.position.set(-c.x, -box.min.y, -c.z)
```
*Sanity check:* offset ≈ `(+69.48, +1.30, +26.51)`; recentered room spans
X∈[−2.83, 2.83], Y∈[0, 5.0], Z∈[−5.60, 5.60]; screen ends up near
`(0, 3.09, +4.05)`. So **+Z is the screen end; spawn the player at −Z facing +Z.**

Colliders — **do NOT trimesh the whole 392k-tri model** (the Notion doc's
explicit warning). The floor is raked, so a flat plane collider would leave the
player clipping ~2.4 m into the floor at the back. Recommended:
- **Floor:** a **`trimesh` collider on the `floor` (and `floor_metal`) mesh only**
  — accurate on the rake, and cheap because it's a single low-ish-poly mesh, not
  the whole model. Find via `scene.getObjectByName('floor')`; wrap in a fixed
  `<RigidBody colliders="trimesh">` (or `<RigidBody type="fixed"><primitive
  object={floorMesh} /></RigidBody>`).
- **Walls:** four thin **fixed `cuboid`** colliders at the recentered extents
  (X = ±2.83, Z = ±5.60, height 0→5). These are separate collider bodies; they
  don't need to be tied to specific meshes.
- **Seats:** no colliders in Phase 1 (walking through them is acceptable for the
  demo). Optional coarse cuboids later; precise seat colliders are Phase 5.

Render the recentered `scene` via `<primitive object={scene} />` inside the
theater component (outside the collider RigidBodies, or reuse the floor mesh
under its RigidBody).

### Step 4 — `Scene.tsx`: wire physics (edit)
- `import { Physics } from '@react-three/rapier'`.
- Wrap world content in `<Suspense fallback={null}>` then `<Physics>`.
- Replace `<Floor/>` + the five boxes + old `<Player/>` + `<PointerLockControls/>`
  with `<Theater/>` + new `<Player/>`.
- `const DEV = process.env.NODE_ENV !== 'production'`; pass `<Physics debug={DEV}>`
  to draw collider wireframes in dev.
- Keep `<KeyboardControls map={KEYBOARD_MAP}>` (now the corrected map).
- Render `<Leva hidden />` in the returned DOM, **outside `<Canvas>`**.
- Add `useGLTF.preload('/models/cinema.glb')` at module scope.

### Step 5 — `Floor.tsx`: delete (the cinema owns its floor now).

### Step 6 — HUD (edit): update the overlay text to the new controls
("Drag to look · WASD move · Space jump") and add a small center crosshair.

### Step 7 — Lint/format/type-check/build + manual verify (§7). Per `CLAUDE.md`,
every file written must pass the package's prettier + eslint.

---

## 6. File-by-file change summary

| File | Change |
| --- | --- |
| `package.json` | + `@react-three/rapier@2.2.0`, `ecctrl@1.0.97`, `leva@0.10.1` |
| `src/components/Scene/Player.tsx` | **Rewrite** → ecctrl first-person; corrected `KEYBOARD_MAP`/`Controls`; placeholder body |
| `src/components/Scene/Theater.tsx` | **New** → `useGLTF('/models/cinema.glb')`, Box3 recenter, trimesh floor + cuboid wall colliders |
| `src/components/Scene/Scene.tsx` | **Edit** → `<Physics>`+`<Suspense>`, swap in `<Theater/>`+`<Player/>`, `<Leva hidden/>`, `useGLTF.preload`, updated HUD |
| `src/components/Scene/Floor.tsx` | **Delete** |
| `src/components/Scene/SceneView.tsx` | Unchanged (stays `ssr:false`) |

No backend, env, or `next.config.js` changes. The existing `eslint.config.cjs`
override disabling `react/no-unknown-property` for `Scene/**` already covers the
new `Theater.tsx`.

---

## 7. Verification

```bash
pnpm --filter @lilnas/theater type-check
pnpm --filter @lilnas/theater lint
pnpm --filter @lilnas/theater build          # proves Physics/ecctrl never run server-side
pnpm --filter @lilnas/theater dev:frontend   # next dev on :8080 (frontend-only is enough)
```

**Manual demo checklist** (`http://localhost:8080`):
- [ ] The real cinema renders (not a flat grid); the model is centered/on the floor.
- [ ] Player **falls and rests** on the floor (gravity works).
- [ ] WASD walks; mouse-drag looks around.
- [ ] Walking into a perimeter wall **stops** you; you don't fall through the floor.
- [ ] Walking the raked floor toward the back keeps your feet on the ground
      (validates the trimesh floor collider vs. a flat plane).
- [ ] `<Physics debug>` wireframes overlay floor + walls sensibly.
- [ ] No leva panel visible; no console/WASM/SSR errors on hard reload.

---

## 8. Out of scope for Phase 1 (do NOT build)
Character model + walk/idle animations (Phase 2); Emby client + stream proxy +
`VideoTexture` on `wall_screen` (Phase 3); Socket.IO gateway / remote avatars /
presence (Phase 4); sit-in-seat + look-clamp + occupancy + video sync (Phase 5);
draw-call merging / positional audio / HLS / deploy tuning (Phase 6).

---

## 9. Gotchas & decisions for the builder

| Item | Guidance |
| --- | --- |
| **ecctrl keyboard names** | Must be `forward/backward/leftward/rightward/jump/run`. `left`/`right` silently do nothing. |
| **Camera ownership** | ecctrl owns the camera in FP mode — **remove `PointerLockControls`** and the old manual camera loop, or they fight. |
| **Look feel** | ecctrl FP is **drag-to-look**, not pointer-lock (a UX change from Phase 0). Accepted for Phase 1; restoring pointer-lock is a Phase 6 polish item. |
| **Raked floor** | Use a **trimesh collider on the `floor` mesh**, not a flat plane (floor rises ~2.4 m front→back). A flat plane will look broken toward the back. |
| **Don't trimesh everything** | Never put a trimesh collider on the full 392k-tri model — floor mesh + cuboid walls only. |
| **ecctrl step handling** | Stadium floors may have step edges; ecctrl's floating capsule handles small steps but may catch on big ones. Minor catching is acceptable in Phase 1. |
| **WASM / SSR** | `SceneView` stays `ssr:false`; meshopt/quantization decode with bundled decoders (no CDN); `<Suspense>` covers async GLB + WASM init. |
| **leva panel** | `<Leva hidden />` outside `<Canvas>`; `leva` is a direct dep. |
| **Repo size** | `cinema.glb` is 3.44 MB (committable). The 14 MB uncompressed source was removed from the repo. |
| **License** | Confirm the model's license before the app is exposed publicly (non-blocking for Phase 1). |

---

## 10. Reference: Phase roadmap (from the Notion design)
Phase 0 ✅ (R3F hello world) · **Phase 1 (this doc)** · Phase 2 character+camera ·
Phase 3 Emby on the screen · Phase 4 multiplayer presence · Phase 5 seats + video
sync · Phase 6 polish. Each phase is independently demoable and de-risks the next.
