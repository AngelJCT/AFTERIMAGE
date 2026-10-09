"""Render the swapped head: face, 3/4, neck seam, full body, and a posed head turn. -- <rigged.blend> <outdir>"""
import bpy, sys, math
from mathutils import Vector, Quaternion, Matrix
blend, outdir = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.open_mainfile(filepath=blend)
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'; scene.view_settings.view_transform = 'AgX'
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.42, 0.42, 0.44, 1)
for nm, loc, e in (("key", (-1.5, -2.5, 2.4), 500), ("fill", (2, -2, 1.6), 200), ("rim", (0, 2.5, 2.2), 300)):
    l = bpy.data.lights.new(nm, 'AREA'); l.energy = e; l.size = 2
    o = bpy.data.objects.new(nm, l); o.location = loc; scene.collection.objects.link(o)
    o.rotation_euler = (Vector((0, 0, 1.4)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
def shoot(name, loc, tgt, lens, res=(800, 800)):
    scene.render.resolution_x, scene.render.resolution_y = res
    cam.location = loc; cd.lens = lens
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f"{outdir}/hc_{name}.png"; bpy.ops.render.render(write_still=True)
F = Vector((0, 0, 1.5))
shoot("face", F + Vector((0, -0.9, 0.0)), F, 120)
E = Vector((0, 0, 1.488))
shoot("eyes", E + Vector((0, -0.9, 0)), E, 240, (1200, 520))
shoot("q34", F + Vector((-0.5, -0.7, 0.02)), F + Vector((0, 0, -0.02)), 100)
shoot("seam", Vector((0.55, -0.45, 1.4)), Vector((0, 0, 1.37)), 90)
shoot("back", Vector((0.2, 0.8, 1.45)), Vector((0, 0, 1.42)), 85)
shoot("body", Vector((0, -4.2, 0.9)), Vector((0, 0, 0.85)), 45, (700, 1000))
rig = bpy.data.objects["WomanRig"]
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='POSE')
def rot_world(name, axis, deg):
    pb = rig.pose.bones[name]; bpy.context.view_layer.update()
    Mw = rig.matrix_world @ pb.matrix; T = Matrix.Translation(Mw.to_translation())
    pb.matrix = rig.matrix_world.inverted() @ (T @ Quaternion(Vector(axis), math.radians(deg)).to_matrix().to_4x4() @ T.inverted() @ Mw)
    bpy.context.view_layer.update()
rot_world("Neck", (0, 0, 1), 20); rot_world("Head", (0, 0, 1), 25); rot_world("Head", (1, 0, 0), 15)
shoot("turn", F + Vector((-0.2, -0.9, -0.05)), F + Vector((0, 0, -0.04)), 85)
