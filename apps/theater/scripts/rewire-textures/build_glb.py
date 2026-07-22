"""Rebuild a ripped FBX's PBR materials against local textures and export a GLB.

Runs headlessly in Blender. `cd` into the extracted asset folder first (the
scripts read the working directory as the asset root), then point Blender at
this file:

    cd /path/to/extracted-asset
    blender --background --factory-startup \\
        --python /path/to/apps/theater/scripts/rewire-textures/build_glb.py

Why this exists — and why the sibling `../convert.ts` tool isn't enough: assets
ripped from games bake ABSOLUTE texture paths from the ripper's own machine into
the FBX (e.g. `C:\\Users\\...\\Textures\\body_D.png`). A straight FBX->GLB
conversion keeps those dead references and exports an untextured (white) model.
This script throws away the imported image nodes and rebuilds each material's
Principled BSDF against the PNGs sitting next to the FBX.

The config block below is filled in for the Master Chief asset as a worked
example (see README.md). To convert a different model, edit the file names and
MATERIAL_TEXTURES to match it.

Channel mapping for Master Chief's split specular-mask textures (..._S_R/_G/_b)
was determined by visually inspecting the maps, not from documentation: _S_G
reads as a near-binary mask lining up with the visor glass + metal studs, and
_S_b reads as its inverse (visor smooth/black, plastic rough/gray) -- i.e. a
plausible Metallic and Roughness map respectively. _S_R and the M_R/M_G pair
didn't match any standard PBR input on inspection, so they're left unused.
"""

import bpy
import os

# ─── Per-asset config — EDIT to match the model you're converting ─────────────
# ASSET_DIR is the extracted asset folder. Defaults to the current working
# directory, so `cd` into the folder before running (or export ASSET_DIR=...).
ASSET_DIR = os.environ.get("ASSET_DIR", os.getcwd())

# Paths relative to ASSET_DIR.
FBX_NAME = "Master Chief/Master Chief.fbx"
TEX_SUBDIR = "Master Chief/Textures"
OUT_NAME = "master-chief.glb"

# Map each FBX material name -> which local PNG feeds each PBR channel.
# `base_color`, `normal`, `metallic`, `roughness`, and `emission` are all
# optional per material: omit a key to leave that BSDF input at its default.
# Working out this mapping for a new asset is a manual step — see
# "Adapting to a new asset" in README.md.
MATERIAL_TEXTURES = {
    "Jupiter_Body": {
        "base_color": "T_M_MED_Jupiter_Body_D.png",
        "normal": "T_M_MED_Jupiter_Body_N.png",
        "metallic": "T_M_MED_Jupiter_Body_S_G.png",
        "roughness": "T_M_MED_Jupiter_Body_S_b.png",
        "emission": "T_M_MED_Jupiter_Body_FX.png",
    },
    "Jupiter_FaceAcc": {
        "base_color": "T_M_MED_Jupiter_FaceAcc_D.png",
        "normal": "T_M_MED_Jupiter_FaceAcc_N.png",
        "metallic": "T_M_MED_Jupiter_FaceAcc_S_G.png",
        "roughness": "T_M_MED_Jupiter_FaceAcc_S_b.png",
        "emission": "T_M_MED_Jupiter_FaceAcc_E.png",
    },
}
# ──────────────────────────────────────────────────────────────────────────────

FBX_PATH = os.path.join(ASSET_DIR, FBX_NAME)
TEX_DIR = os.path.join(ASSET_DIR, TEX_SUBDIR)
GLB_PATH = os.path.join(ASSET_DIR, OUT_NAME)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fbx():
    if not os.path.isfile(FBX_PATH):
        raise FileNotFoundError(FBX_PATH)
    bpy.ops.import_scene.fbx(filepath=FBX_PATH)


def merge_duplicate_materials():
    """FBX import can split one base material into e.g. Jupiter_Body and
    Jupiter_Body.001 across different sub-meshes. Collapse duplicates onto the
    base material so every mesh face ends up on the one we rewire -- otherwise
    the .001 copy keeps pointing at the dead baked-in path."""
    for base_name in list(MATERIAL_TEXTURES):
        base = bpy.data.materials.get(base_name)
        if base is None:
            continue
        dupes = [m for m in bpy.data.materials if m.name.startswith(base_name + ".")]
        for dupe in dupes:
            dupe_name = dupe.name
            for obj in bpy.data.objects:
                if obj.type != "MESH":
                    continue
                for slot in obj.material_slots:
                    if slot.material == dupe:
                        slot.material = base
            bpy.data.materials.remove(dupe)
            print(f"merged duplicate material {dupe_name!r} into {base_name!r}")


def load_image(filename, non_color):
    path = os.path.join(TEX_DIR, filename)
    if not os.path.isfile(path):
        raise FileNotFoundError(path)
    img = bpy.data.images.load(path, check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    return img


def wire_material(material, textures):
    material.use_nodes = True
    tree = material.node_tree

    for node in list(tree.nodes):
        if node.type in {"TEX_IMAGE", "NORMAL_MAP"}:
            tree.nodes.remove(node)

    bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = tree.nodes.new("ShaderNodeBsdfPrincipled")
        output = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
        tree.links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

    x0 = bsdf.location.x - 500

    def add_tex_node(filename, non_color, y):
        node = tree.nodes.new("ShaderNodeTexImage")
        node.image = load_image(filename, non_color)
        node.location = (x0, y)
        return node

    # Base color and emission carry sRGB color; normal/metallic/roughness are
    # raw data and MUST be flagged Non-Color (load_image handles that) or the
    # PBR math comes out wrong.
    if "base_color" in textures:
        node = add_tex_node(textures["base_color"], False, 300)
        tree.links.new(node.outputs["Color"], bsdf.inputs["Base Color"])

    # A normal map can't feed the BSDF directly — it needs a Normal Map node
    # between the (Non-Color) image and the BSDF's Normal input.
    if "normal" in textures:
        node = add_tex_node(textures["normal"], True, 0)
        normal_map_node = tree.nodes.new("ShaderNodeNormalMap")
        normal_map_node.location = (x0 + 250, 0)
        tree.links.new(node.outputs["Color"], normal_map_node.inputs["Color"])
        tree.links.new(normal_map_node.outputs["Normal"], bsdf.inputs["Normal"])

    if "metallic" in textures:
        node = add_tex_node(textures["metallic"], True, -300)
        tree.links.new(node.outputs["Color"], bsdf.inputs["Metallic"])

    if "roughness" in textures:
        node = add_tex_node(textures["roughness"], True, -600)
        tree.links.new(node.outputs["Color"], bsdf.inputs["Roughness"])

    if "emission" in textures:
        node = add_tex_node(textures["emission"], False, -900)
        tree.links.new(node.outputs["Color"], bsdf.inputs["Emission Color"])
        bsdf.inputs["Emission Strength"].default_value = 2.0


def wire_all_materials():
    for name, textures in MATERIAL_TEXTURES.items():
        material = bpy.data.materials.get(name)
        if material is None:
            raise LookupError(f"material {name!r} not found after FBX import")
        wire_material(material, textures)
        print(f"wired material: {name}")


def export_glb():
    bpy.ops.export_scene.gltf(
        filepath=GLB_PATH,
        export_format="GLB",
        export_yup=True,
        export_apply=True,
        export_image_format="AUTO",
        export_materials="EXPORT",
    )
    print(f"exported: {GLB_PATH} ({os.path.getsize(GLB_PATH)} bytes)")


if __name__ == "__main__":
    reset_scene()
    import_fbx()
    merge_duplicate_materials()
    wire_all_materials()
    export_glb()
