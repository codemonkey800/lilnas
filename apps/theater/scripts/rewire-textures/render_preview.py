"""Render a PNG preview of the rewired model, to verify the materials visually.

Run the same way as build_glb.py (`cd` into the asset folder first):

    cd /path/to/extracted-asset
    blender --background --factory-startup \\
        --python /path/to/apps/theater/scripts/rewire-textures/render_preview.py

Reuses build_glb's import + material wiring, then frames a camera on the model,
adds basic lighting, and renders `preview.png` into the asset folder so the
wiring can be sanity-checked instead of trusting the export log. It also dumps
every material name plus any image datablock still pointing at a dead source
path -- that report is how the duplicate-material bug (see README) was caught.
"""

import bpy
import os
import sys
import mathutils

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_glb as bg  # noqa: E402

PREVIEW_PATH = os.path.join(bg.ASSET_DIR, "preview.png")


def report_materials_and_dead_images():
    print("\n--- materials in file ---")
    for mat in bpy.data.materials:
        print(f"  {mat.name!r}")
    print("--- images in file ---")
    for img in bpy.data.images:
        size = tuple(img.size) if img.has_data else "NO DATA"
        print(f"  {img.name!r} filepath={img.filepath!r} size={size}")
    print("--- image nodes still referencing an absolute source path ---")
    for mat in bpy.data.materials:
        if not mat.use_nodes:
            continue
        for node in mat.node_tree.nodes:
            path = node.image.filepath if node.type == "TEX_IMAGE" and node.image else ""
            if path and ("Users" in path or ":\\" in path):
                print(f"  material {mat.name!r} node {node.name!r} -> {path!r}")
    print("--- end report ---\n")


def frame_camera_on_scene():
    min_co = mathutils.Vector((float("inf"),) * 3)
    max_co = mathutils.Vector((float("-inf"),) * 3)
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            world_corner = obj.matrix_world @ mathutils.Vector(corner)
            min_co = mathutils.Vector(min(a, b) for a, b in zip(min_co, world_corner))
            max_co = mathutils.Vector(max(a, b) for a, b in zip(max_co, world_corner))

    center = (min_co + max_co) / 2
    size = (max_co - min_co).length

    cam_data = bpy.data.cameras.new("PreviewCam")
    cam_obj = bpy.data.objects.new("PreviewCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    cam_obj.location = center + mathutils.Vector((0, -size * 1.3, size * 0.15))
    direction = center - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam_obj

    sun_data = bpy.data.lights.new("PreviewSun", type="SUN")
    sun_data.energy = 3.0
    sun_obj = bpy.data.objects.new("PreviewSun", sun_data)
    bpy.context.scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (0.6, 0.2, 0.8)

    world = bpy.data.worlds.new("PreviewWorld")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.08, 0.08, 0.09, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
    bpy.context.scene.world = world


def set_render_engine():
    scene = bpy.context.scene
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "CYCLES"):
        try:
            scene.render.engine = engine
            print(f"using render engine: {engine}")
            return
        except TypeError:
            continue
    raise RuntimeError("no usable render engine found")


def render():
    scene = bpy.context.scene
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.filepath = PREVIEW_PATH
    bpy.ops.render.render(write_still=True)
    print(f"rendered preview: {PREVIEW_PATH}")


if __name__ == "__main__":
    bg.reset_scene()
    bg.import_fbx()
    report_materials_and_dead_images()
    bg.merge_duplicate_materials()
    bg.wire_all_materials()
    frame_camera_on_scene()
    set_render_engine()
    render()
