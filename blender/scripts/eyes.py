import bpy, sys
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:]
path, outdir, prefix = args
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
mnz = min(p.z for p in pts); mxz = max(p.z for p in pts); s = 1.65 / (mxz - mnz)
for r in [o for o in bpy.context.scene.objects if o.parent is None]:
    r.scale = [v * s for v in r.scale]; r.location.z -= mnz * s
bpy.context.view_layer.update()
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'; scene.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.5, 1)
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
scene.render.resolution_x, scene.render.resolution_y = 1200, 700
for i, z in enumerate([1.46, 1.49, 1.52]):
    cam.location = (0, -1.4, z); cd.lens = 220
    cam.rotation_euler = (Vector((0, 0, z)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f"{outdir}/{prefix}_eyes{i}.png"
    bpy.ops.render.render(write_still=True)
