# Usage: Blender -b -P closeups.py -- <file.glb> <outdir> <prefix>
import bpy, sys
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:]
path, outdir, prefix = args
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
def bbox():
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))
mn, mx = bbox(); s = 1.65 / (mx.z - mn.z)
for r in [o for o in bpy.context.scene.objects if o.parent is None]:
    r.scale = [v * s for v in r.scale]
bpy.context.view_layer.update(); mn, mx = bbox()
for r in [o for o in bpy.context.scene.objects if o.parent is None]:
    r.location.z -= mn.z
bpy.context.view_layer.update()

# Find the front-most head point (nose tip) to aim the face camera.
o = meshes[0]; M = o.matrix_world
head = [M @ v.co for v in o.data.vertices]
head = [p for p in head if p.z > 1.40 and abs(p.x) < 0.06]
nose = min(head, key=lambda p: p.y)
print("nose", nose)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.5, 0.5, 1)
w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
l = bpy.data.lights.new("key", 'AREA'); l.energy = 60; l.size = 1.5
lo = bpy.data.objects.new("key", l); lo.location = (-0.3, -1.0, nose.z + 0.3)
lo.rotation_euler = (nose - lo.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(lo)
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam

def shoot(name, loc, tgt, lens, res=(1000, 700)):
    scene.render.resolution_x, scene.render.resolution_y = res
    cam.location = loc; cd.lens = lens
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f"{outdir}/{prefix}_{name}.png"
    bpy.ops.render.render(write_still=True)

eyes = nose + Vector((0, 0.02, 0.035))
shoot("eyes", eyes + Vector((0, -0.45, 0)), eyes, 135)
# Left hand (anatomical left = +X in Blender after glTF import? character faces -Y, so her left is +X)
hand_pts = [M @ v.co for v in o.data.vertices if (M @ v.co).x > 0.2 and 0.6 < (M @ v.co).z < 0.9]
hc = sum(hand_pts, Vector()) / max(1, len(hand_pts))
print("hand centre", hc)
shoot("handL_front", hc + Vector((0, -0.5, 0)), hc, 100, (800, 800))
shoot("handL_side", hc + Vector((0.5, 0, 0)), hc, 100, (800, 800))
