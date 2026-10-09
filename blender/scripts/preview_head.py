"""Preview a head scan: full, face front, 3/4, eyes. -- <glb> <outdir> <prefix>"""
import bpy, sys
from mathutils import Vector
path, outdir, prefix = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
o = [x for x in bpy.data.objects if x.type == 'MESH'][0]
pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
mn = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
mx = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
c = (mn + mx) / 2; H = mx.z - mn.z
print("bbox", mn, mx)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'; scene.view_settings.view_transform = 'Standard'
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.55, 0.55, 0.55, 1)
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
def shoot(name, loc, tgt, lens, res=(900, 900), ortho=None):
    scene.render.resolution_x, scene.render.resolution_y = res
    cam.location = loc
    if ortho: cd.type = 'ORTHO'; cd.ortho_scale = ortho
    else: cd.type = 'PERSP'; cd.lens = lens
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f"{outdir}/{prefix}_{name}.png"; bpy.ops.render.render(write_still=True)
shoot("front", c + Vector((0, -5 * H, 0)), c, 50, ortho=H * 1.05)
shoot("side", c + Vector((5 * H, 0, 0)), c, 50, ortho=H * 1.05)
shoot("q34", c + Vector((-1.6 * H, -2.4 * H, 0.1 * H)), c, 50, ortho=H * 1.05)
