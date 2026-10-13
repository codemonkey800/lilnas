"""Headless Blender converter between GLB/glTF, FBX, and OBJ.

Driven by ``scripts/convert.ts``; not meant to be run by hand (though you can:
``blender --background --python blender_convert.py -- jobs.json``).

Reads a JSON file whose path is the first argument after ``--``. The JSON is a
list of ``{"input": "...", "output": "..."}`` jobs. For each job we reset to an
empty scene, import the input by extension, and export to the output by
extension. A ``.zip`` output produces a Mixamo-ready bundle (OBJ + .mtl +
textures in one archive). Progress is printed as ``[[CONVERT]] ok|fail ...``
marker lines that the TS wrapper parses in quiet mode. A non-zero exit code
signals that at least one job failed.
"""

import json
import os
import shutil
import sys
import tempfile
import zipfile

import bpy

MARKER = "[[CONVERT]]"
GLTF_EXTS = (".glb", ".gltf")
FBX_EXT = ".fbx"
OBJ_EXT = ".obj"
ZIP_EXT = ".zip"


def _args_after_double_dash():
    """Return CLI args passed after the ``--`` separator (Blender ignores them)."""
    if "--" in sys.argv:
        return sys.argv[sys.argv.index("--") + 1 :]
    return []


def _reset_scene():
    """Drop everything and start from an empty file so jobs don't accumulate."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _import_file(path):
    ext = os.path.splitext(path)[1].lower()
    if ext in GLTF_EXTS:
        # glTF importer handles KHR_mesh_quantization natively; EXT_meshopt_
        # compression is NOT supported and will raise here (documented limitation).
        bpy.ops.import_scene.gltf(filepath=path)
    elif ext == FBX_EXT:
        # automatic_bone_orientation gives clean, glTF-friendly bone axes for
        # Mixamo rigs instead of Blender's default leaf-heavy orientation.
        bpy.ops.import_scene.fbx(filepath=path, automatic_bone_orientation=True)
    elif ext == OBJ_EXT:
        bpy.ops.wm.obj_import(filepath=path)
    else:
        raise ValueError("unsupported input extension: %s" % ext)


def _apply_object_scale(extra_scale=1.0):
    """Bake object-level scale into the data.

    Mixamo FBX files import with the armature (and mesh) carrying a 0.01 object
    scale (the cm->m unit conversion is left on the transform rather than baked).
    glTF has no export-scale option, so without this the exported model comes out
    100x too small. Applying scale bakes it into the geometry/rig so the glTF is
    at correct real-world metres.

    ``extra_scale`` corrects a *different* problem: some ripped/auto-rigged
    source files carry no such Mixamo convention and instead encode the mesh
    itself at the wrong absolute size (e.g. a game asset authored in
    non-metre units). There's no reliable signal to detect that automatically,
    so it's an explicit per-conversion override (``convert.ts --scale``)
    layered on top of the automatic cm->m correction.

    Only parent-less (root) objects get the multiplier — typically just the
    armature, with meshes parented to it. Scale inherits down the parent
    chain, so also multiplying the (already-scaled) children would compound
    into a much larger, wrong factor.
    """
    ctx = bpy.context
    ctx.view_layer.objects.active = None
    bpy.ops.object.select_all(action="SELECT")
    if ctx.selected_objects:
        ctx.view_layer.objects.active = ctx.selected_objects[0]
        if extra_scale != 1.0:
            for obj in ctx.selected_objects:
                if obj.parent is None:
                    obj.scale = tuple(s * extra_scale for s in obj.scale)
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bpy.ops.object.select_all(action="DESELECT")


def _stage_textures(dest_dir, prefix=""):
    """Write every image to ``dest_dir`` as a named PNG and repoint its filepath.

    glTF-imported textures are *packed* with an empty ``filepath``, so exporters
    reference them with a blank name. The pixel bytes still travel, but viewers
    and Mixamo map a texture to its material *by filename* — with no name they
    can't, and the model renders untextured (all white). Writing each image to a
    real, named PNG fixes that for FBX, OBJ, and zip alike. ``prefix`` namespaces
    the files (e.g. by model name) so a batch landing in one folder can't collide.
    """
    used = set()
    for idx, img in enumerate(bpy.data.images):
        if img.packed_file is None and not img.filepath and not img.has_data:
            continue  # nothing to write for this image
        base = (img.name or ("Image_%d" % idx)).replace("/", "_").replace("\\", "_")
        stem, suffix = prefix + base, 1
        while stem in used:
            stem, suffix = "%s%s_%d" % (prefix, base, suffix), suffix + 1
        used.add(stem)
        try:
            os.makedirs(dest_dir, exist_ok=True)
            dest = os.path.join(dest_dir, stem + ".png")
            img.filepath_raw = dest
            img.file_format = "PNG"
            img.save()
            img.filepath = dest
        except RuntimeError:
            pass  # image without usable pixel data — skip it


def _export_gltf(path, ext):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB" if ext == ".glb" else "GLTF_SEPARATE",
        export_animations=True,
        export_yup=True,  # glTF is Y-up; Blender is Z-up
    )


def _export_fbx(path):
    # Name textures into the sibling .fbm folder (FBX convention) so they resolve.
    _stage_textures(os.path.splitext(path)[0] + ".fbm")
    bpy.ops.export_scene.fbx(
        filepath=path,
        path_mode="COPY",  # copy referenced textures next to / into the file
        embed_textures=True,  # ...and embed them so the .fbx is self-contained
        add_leaf_bones=False,  # don't pollute the rig with export-only leaf bones
        bake_anim=True,  # bake actions into FBX takes
        apply_scale_options="FBX_SCALE_ALL",  # keep units sane on the way out
    )


def _export_obj(out_dir, base):
    """Export ``<base>.obj`` + ``.mtl`` + textures into ``out_dir`` (flat)."""
    # OBJ textures are always external; write them flat next to the .obj, prefixed
    # with the model name so batches into a shared folder don't collide.
    _stage_textures(out_dir, prefix=base + "_")
    bpy.ops.wm.obj_export(
        filepath=os.path.join(out_dir, base + ".obj"),
        export_materials=True,
        path_mode="COPY",
    )


def _export_zip(path):
    """Bundle an OBJ + .mtl + textures into one .zip (the format Mixamo ingests)."""
    base = os.path.splitext(os.path.basename(path))[0]
    staging = tempfile.mkdtemp(prefix="lilnas-obj-zip-")
    try:
        _export_obj(staging, base)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
            for entry in sorted(os.listdir(staging)):
                archive.write(os.path.join(staging, entry), arcname=entry)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def _export_file(path):
    ext = os.path.splitext(path)[1].lower()
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    if ext == FBX_EXT:
        _export_fbx(path)
    elif ext in GLTF_EXTS:
        _export_gltf(path, ext)
    elif ext == OBJ_EXT:
        _export_obj(os.path.dirname(os.path.abspath(path)), os.path.splitext(os.path.basename(path))[0])
    elif ext == ZIP_EXT:
        _export_zip(path)
    else:
        raise ValueError("unsupported output extension: %s" % ext)


def _convert(job):
    src = job["input"]
    dst = job["output"]
    _reset_scene()
    _import_file(src)
    _apply_object_scale(job.get("scale", 1.0))
    _export_file(dst)


def main():
    args = _args_after_double_dash()
    if not args:
        print("%s fail <none> :: missing jobs file path" % MARKER, flush=True)
        sys.exit(2)

    with open(args[0], encoding="utf-8") as handle:
        jobs = json.load(handle)

    failures = 0
    for job in jobs:
        src = job.get("input", "<unknown>")
        dst = job.get("output", "<unknown>")
        try:
            _convert(job)
            print("%s ok %s -> %s" % (MARKER, src, dst), flush=True)
        except Exception as err:  # noqa: BLE001 - report every failure, keep going
            failures += 1
            print("%s fail %s :: %s" % (MARKER, src, err), flush=True)

    if failures:
        sys.exit(1)


if __name__ == "__main__":
    main()
