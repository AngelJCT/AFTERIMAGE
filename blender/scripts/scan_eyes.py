"""Render the original (full-res) head scan's eyes, placed with the fitted transform. -- <head.glb> <xform.json> <out.png>"""
import bpy, sys, json
from mathutils import Matrix, Vector
glb, xf, out = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
head = [o for o in bpy.data.objects if o.type == 'MESH'][0]
X = json.load(open(xf))
R = Matrix([list(r) + [0] for r in X["R"]] + [[0, 0, 0, 1]])
head.matrix_world = Matrix.Translation(Vector(X["t"])) @ R @ Matrix.Scale(X["s"], 4) @ head.matrix_world
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'; scene.view_settings.view_transform = 'AgX'
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.42, 0.44, 1)
for nm, loc, e in (("key", (-1.5, -2.5, 2.4), 500), ("fill", (2, -2, 1.6), 200), ("rim", (0, 2.5, 2.2), 300)):
    l = bpy.data.lights.new(nm, 'AREA'); l.energy = e; l.size = 2
    o = bpy.data.objects.new(nm, l); o.location = loc; scene.collection.objects.link(o)
    o.rotation_euler = (Vector((0, 0, 1.4)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
E = Vector((0, 0, 1.488)); cam.location = E + Vector((0, -0.9, 0)); cd.lens = 240
cam.rotation_euler = (E - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.render.resolution_x, scene.render.resolution_y = 1200, 520
scene.render.filepath = out; bpy.ops.render.render(write_still=True)
