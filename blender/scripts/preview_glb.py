# Usage: Blender -b -P preview_glb.py -- <file.glb> <outdir> <prefix>
import bpy, sys, math
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:]
path, outdir, prefix = args[0], args[1], args[2]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']

# Normalise: 1.65 m tall, feet at origin.
def bbox():
    pts = [o.matrix_world @ Vector(c) for o in meshes for c in o.bound_box]
    return (Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))),
            Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts))))
mn, mx = bbox()
s = 1.65 / (mx.z - mn.z)
roots = [o for o in bpy.context.scene.objects if o.parent is None]
for r in roots:
    r.scale = (r.scale.x * s, r.scale.y * s, r.scale.z * s)
bpy.context.view_layer.update()
mn, mx = bbox()
for r in roots:
    r.location.z -= mn.z
bpy.context.view_layer.update()
mn, mx = bbox()
print("normalised bbox", mn, mx)

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = 900
scene.render.resolution_y = 1200
scene.render.film_transparent = False
world = bpy.data.worlds.new("w"); scene.world = world
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.45, 0.45, 0.45, 1)
world.node_tree.nodes["Background"].inputs[1].default_value = 0.6
scene.view_settings.view_transform = 'AgX'

def light(name, loc, energy, size=3):
    l = bpy.data.lights.new(name, 'AREA'); l.energy = energy; l.size = size
    o = bpy.data.objects.new(name, l); o.location = loc
    scene.collection.objects.link(o)
    d = Vector((0, 0, 1.0)) - Vector(loc)
    o.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
light("key", (-2.5, -3.5, 2.8), 900)
light("fill", (3, -3, 1.5), 350)
light("rim", (0, 3.5, 2.5), 500)

cam_data = bpy.data.cameras.new("cam")
cam = bpy.data.objects.new("cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

def shoot(name, loc, target, ortho=None, lens=50, res=(900, 1200)):
    scene.render.resolution_x, scene.render.resolution_y = res
    cam.location = loc
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    if ortho:
        cam_data.type = 'ORTHO'; cam_data.ortho_scale = ortho
    else:
        cam_data.type = 'PERSP'; cam_data.lens = lens
    scene.render.filepath = f"{outdir}/{prefix}_{name}.png"
    bpy.ops.render.render(write_still=True)

H = mx.z
shoot("front", (0, -6, H / 2), (0, 0, H / 2), ortho=H * 1.08)
shoot("side", (6, 0, H / 2), (0, 0, H / 2), ortho=H * 1.08)
shoot("back", (0, 6, H / 2), (0, 0, H / 2), ortho=H * 1.08)
headZ = H - 0.13
shoot("face", (0, -0.9, headZ), (0, 0, headZ), lens=85, res=(1000, 1000))
shoot("face34", (-0.55, -0.7, headZ + 0.02), (0, 0, headZ), lens=85, res=(1000, 1000))
shoot("hand", (-0.55, -0.6, 0.8), (-0.3, 0, 0.78), lens=85, res=(1000, 1000))
