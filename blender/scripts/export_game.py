"""Export the rigged character for the web. Usage: -- <rigged.blend> <out.glb> [texSize]"""
import bpy, sys
args = sys.argv[sys.argv.index("--") + 1:]
blend, out = args[:2]; size = int(args[2]) if len(args) > 2 else 2048
bpy.ops.wm.open_mainfile(filepath=blend)
for img in bpy.data.images:
    if img.size[0] > size:
        img.scale(size, size)
bpy.ops.object.select_all(action='DESELECT')
rig = bpy.data.objects["WomanRig"]
rig.select_set(True)
for o in rig.children:
    if o.type == 'MESH': o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True, export_yup=True,
    export_skins=True, export_animations=False, export_morph=True, export_morph_normal=False,
    export_image_format='WEBP', export_image_quality=88,
    export_apply=False, export_all_influences=False, export_extras=True,
)
print("EXPORT_OK", out)
