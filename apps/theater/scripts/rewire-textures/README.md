# Rewire-textures: ripped-FBX → textured GLB

Local-only Blender tooling for turning a **ripped game-asset FBX** into a
self-contained, correctly-textured **GLB** the theater app can load with
`useGLTF`.

Ripped assets (e.g. from The Models Resource) bake **absolute texture paths from
the ripper's own machine** into the FBX — something like
`C:\Users\Someone\...\Textures\body_D.png`. Those paths are dead on any other
computer, so the material references resolve to nothing. On top of that, the
textures are often **channel-split** (separate grayscale PNGs per map) with
names that don't say which is metallic vs. roughness. The result: a straight
conversion gives you a **white, untextured** model.

These scripts fix that by discarding the imported image nodes and **rebuilding
each material's Principled BSDF against the local PNGs**, then exporting a GLB
with the textures embedded.

## This vs. `../convert.ts`

The sibling [`../`](../README.md) tool (`convert.ts` + `blender_convert.py`) is a
general **format** converter (FBX ↔ GLB ↔ OBJ) and handles Mixamo scale. It does
**not** rebuild materials, so on a ripped asset with dead texture paths it
produces a white model.

Use **this** folder when a converted GLB comes out untextured/white because the
source FBX has dead absolute texture paths and/or channel-split maps that need to
be mapped to PBR inputs by hand.

## Prerequisites

- **Blender** on your `PATH` (as `blender`), or set `BLENDER_BIN`. Verified
  against **Blender 5.2 LTS** (`brew install --cask blender`).

## Usage

Both scripts read the **current working directory** as the asset root, so `cd`
into your extracted asset folder first (or export `ASSET_DIR=/path/to/asset`):

```bash
cd /path/to/extracted-asset

# 1. Verify the wiring visually first — writes preview.png into the asset folder.
blender --background --factory-startup \
  --python /path/to/apps/theater/scripts/rewire-textures/render_preview.py

# 2. Once the preview looks right, export the GLB (written into the asset folder).
blender --background --factory-startup \
  --python /path/to/apps/theater/scripts/rewire-textures/build_glb.py
```

`--factory-startup` keeps the run reproducible (ignores your personal Blender
config). `render_preview.py` also prints a report of every material and any image
node still pointing at an absolute source path — a fast way to spot wiring gaps.

## Adapting to a new asset

The per-asset config lives in a clearly-marked block at the top of
`build_glb.py`. Editing it is the whole job:

1. **Extract** the model so the FBX and its textures sit under one folder. Point
   `FBX_NAME` / `TEX_SUBDIR` / `OUT_NAME` at them (relative to the asset folder).
2. **Find the material names.** Import the FBX in Blender (or grep the binary)
   and note the material names — these become the keys of `MATERIAL_TEXTURES`.
   `wire_all_materials()` raises if a configured name isn't found, so typos fail
   loudly rather than silently skipping.
3. **Map textures to channels.** For each material, decide which PNG feeds
   `base_color` / `normal` / `metallic` / `roughness` / `emission`. Every key is
   optional — omit one to leave that BSDF input at its default.
   - Diffuse/albedo → `base_color`, normal → `normal` are usually obvious from
     the filename suffix (`_D`, `_N`).
   - **Channel-split masks** (`_S_R`, `_S_G`, `_S_b`, `_M_R`, ...) are the hard
     part — the suffix rarely tells you which is metallic vs. roughness. Make
     quick thumbnails and _look_ at them:
     ```bash
     sips -Z 256 T_..._S_G.png --out /tmp/thumb_S_G.png   # macOS
     ```
     Reason physically: a visor/glass region should be **metallic** (bright in
     the metallic map) and **smooth** (dark in the roughness map); bare
     plastic/cloth is non-metal and rougher. That contrast is how the Master
     Chief mapping below was pinned down.

## Gotchas (why the scripts do what they do)

1. **Dead absolute texture paths.** The reason this tooling exists — the FBX's
   baked paths point at the ripper's drive. The scripts ignore them and load
   PNGs from `TEX_SUBDIR`.
2. **Duplicate materials after import.** Blender's FBX importer can split one
   material into `Name` and `Name.001` across sub-meshes. If you only rewire
   `Name`, the `.001` faces keep the dead path. `merge_duplicate_materials()`
   collapses `Name.*` back onto `Name` before wiring.
3. **Colorspace.** Base-color and emission are sRGB **color**; normal, metallic,
   and roughness are raw **data** and must be flagged **Non-Color**, or the PBR
   math is wrong. `load_image(..., non_color=True)` handles this.
4. **Normal maps need a Normal Map node.** You can't wire a normal texture
   straight into the BSDF's `Normal` input — it goes through a `ShaderNodeNormalMap`
   first.

## Worked example: Master Chief

The committed config converts a ripped Fortnite Master Chief FBX.

- **Source:** two materials, `Jupiter_Body` (armor) and `Jupiter_FaceAcc`
  (visor/face); channel-split textures named `T_M_MED_Jupiter_{Body,FaceAcc}_*`.
- **Channel mapping (determined by inspection, not docs):** `_D` → base color,
  `_N` → normal, **`_S_G` → metallic**, **`_S_b` → roughness**, `_FX`/`_E` →
  emission. The visor read solid-white in `_S_G` (metal) and solid-black in
  `_S_b` (smooth) — physically what glass should do. `_S_R` and the `_M_R`/`_M_G`
  pair didn't match any standard PBR input on inspection, so they're unused.
- **Result (verified):** ~2 m tall, feet at Y≈0 (stands on the floor), Y-up,
  textures embedded, full 109-bone skeleton preserved. **No animation clips** —
  the rig is bind-pose only; retargeting an idle onto this UE-style skeleton is a
  separate job (the sibling tool's README covers the Mixamo round-trip).

## Notes

- **Nothing here runs in Docker or at runtime** — it's dev-time asset prep. Only
  the resulting GLB gets committed (into `public/models/`), not the source FBX or
  textures.
- **Round-trips aren't loss-free** and material intent can drift; treat the
  preview render as the source of truth for whether the wiring is right.
