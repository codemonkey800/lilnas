# Asset conversion scripts

Local-only tooling for converting 3D assets between **GLB/glTF**, **FBX**, and **OBJ**.
`useGLTF` (drei) needs glTF/GLB, while Mixamo takes FBX or OBJ — this bridges them, and
can emit a Mixamo-ready **zip** (OBJ + `.mtl` + textures) in one step.

- `convert.ts` — the CLI (run via `tsx`).
- `blender_convert.py` — the actual converter, run inside headless Blender.
- [`rewire-textures/`](./rewire-textures/README.md) — sibling tooling for ripped
  game assets whose FBX bakes in dead absolute texture paths. A plain conversion
  here leaves those models white; rewire-textures rebuilds their materials
  against the local textures. Reach for it when a converted GLB comes out
  untextured.

## How it works

FBX is a proprietary format with no reliable Node writer, so instead of an npm package
this wraps **Blender** in background mode: the CLI validates inputs, batches them into a
temp jobs file, and hands them to `blender_convert.py`, which imports each file and
re-exports it in the target format. Nothing here runs in Docker or at runtime — it's a
dev convenience for prepping assets you then commit.

## Prerequisites

- **Blender** on your `PATH` (as `blender`), or point `BLENDER_BIN` at it.
  Verified against **Blender 5.2 LTS**. Install with `brew install --cask blender`.

## Usage

```bash
# Infer the output name beside the input (.fbx -> .glb, .glb/.gltf -> .fbx)
pnpm --filter @lilnas/theater convert public/models/master-chief.fbx

# Explicit output path
pnpm --filter @lilnas/theater convert public/models/master-chief.fbx public/models/master-chief.glb

# Batch a whole directory (or several files) into an output directory
pnpm --filter @lilnas/theater convert public/animations --out-dir public/animations/glb

# Bundle OBJ + .mtl + textures into one Mixamo-ready zip
pnpm --filter @lilnas/theater convert public/models/aang.glb aang.zip

# Batch a whole folder of characters into Mixamo zips
pnpm --filter @lilnas/theater convert ~/chars --out-dir ~/mixamo --to zip

# Stream Blender's full log instead of the per-file summary
pnpm --filter @lilnas/theater convert model.fbx -v

# Correct a source file whose mesh itself is the wrong real-world size
pnpm --filter @lilnas/theater convert public/models/snake.fbx --scale 10
```

From inside `apps/theater/` you can drop the filter: `pnpm convert model.fbx`.

Direction is inferred from file extensions (`.fbx` ↔ `.glb`/`.gltf` by default). Name an
explicit output — or pass `--to <fmt>` for batches — to target `obj` or `zip`. Formats:
`.glb`/`.gltf` and `.fbx` carry rig + animation; **`.obj` is static geometry only** (no
bones/animation), which is exactly what Mixamo wants for auto-rigging; a **`.zip`** wraps
an OBJ bundle. Converting within the same family (e.g. `.glb` → `.gltf`) is rejected.

## What's handled

- **Scale** — Mixamo FBX imports carry a 0.01 unit scale that would otherwise make the
  glTF come out 100× too small. The Python applies object scale so output is at correct
  real-world metres (Master Chief exports at ~2 m tall, verified). Some ripped/auto-rigged
  assets carry no such convention and instead bake the _mesh itself_ at the wrong
  size (e.g. a game asset authored in non-metre units) — there's no reliable signal to
  detect that automatically, so `--scale <factor>` layers a manual correction on top.
  Compare the bad output's height against an already-correct model (e.g. via a quick
  glTF bounding-box check) to find the right factor.
- **Textures** — GLB embeds them natively. For FBX, each texture is written as a
  **named** PNG into a sibling `<name>.fbm/` folder _and_ embedded. The naming is the
  important part: glTF textures import without filenames, and an FBX texture with a blank
  name renders **white** in most external viewers and in Mixamo even though the pixel
  bytes are embedded — so the converter assigns real filenames. Keep the `.fbm` folder
  alongside the `.fbx` when sharing it.
- **OBJ / zip** — OBJ writes the mesh + a `.mtl` + external PNG textures (named and
  model-prefixed so a batch landing in one folder can't collide). A `.zip` output bundles
  all three flat into one archive — upload it straight to Mixamo. OBJ is static geometry
  only (no rig/animation), which is fine as a Mixamo _input_ since Mixamo builds the rig.
- **Animations** — skinning and animation clips are carried across (bones baked, no
  export-only leaf bones).
- **Compressed GLBs** — `EXT_meshopt_compression` + `KHR_mesh_quantization` (e.g.
  `cinema.glb`) import fine on Blender 5.2; the full 391k-tri scene round-trips to FBX.
  Very old Blender versions may lack meshopt import — if GLB import ever fails, decompress
  first (`gltf-transform meshopt <in> <out>`).

## Mixamo workflow

Mixamo auto-rigs a static mesh and always returns an animated **FBX**. So the round trip
is: `convert char.glb char.zip` → upload the zip → rig + animate → download the FBX →
`convert char.fbx char.glb` for the app. Textures ride along in the OBJ `.mtl` set on the
way in; on the way back you reapply the original GLB's textures to the rigged mesh (UVs
are preserved), or animate the original textured mesh directly.

## Caveats

- **Messy clip names from Sketchfab exports** — assets wrapped by Sketchfab (like the
  current `master-chief.fbx`) carry extra nodes (`Sketchfab_model`, `RootNode`, …), so the
  converted file exposes several animation clips named after those nodes rather than one
  clean `idle`. This is inherent to the source, not the converter. Cleaning up / merging
  clips into a single named asset is a separate glTF-Transform step (see the combine-Mixamo
  workflow), intentionally out of scope here.
- **Round-trips aren't loss-free** — bone orientation and material nuance can drift on
  `fbx → glb → fbx`. Fine for asset prep; not a fidelity guarantee.
- **~1–2 s Blender startup** per run (amortised across a batch — one launch does all jobs).
