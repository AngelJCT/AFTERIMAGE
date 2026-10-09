"""Raw image-to-3D scan (millions of triangles) -> a game-weight base mesh for the rig pipeline.
Keeps UVs and textures; the scan itself is later baked back as the normal detail.
Usage: Blender -b --factory-startup -P decimate_scan.py -- <scan.glb> <out.glb> [tris]"""
import bpy, sys
args = sys.argv[sys.argv.index("--") + 1:]
src, out = args[0], args[1]
target = int(args[2]) if len(args) > 2 else 60000
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bpy.ops.object.select_all(action='DESELECT'); mesh.select_set(True)
bpy.context.view_layer.objects.active = mesh
tris = sum(len(p.vertices) - 2 for p in mesh.data.polygons)
dec = mesh.modifiers.new("dec", 'DECIMATE'); dec.ratio = target / tris
dec.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier="dec")
for p in mesh.data.polygons: p.use_smooth = True
print("DECIMATE_OK", tris, "->", len(mesh.data.polygons))
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_yup=True,
                          export_image_format='AUTO', export_normals=True, export_texcoords=True)
