"""Render stress poses focused on joints. -- <rigged.blend> <outdir> <tag>
Helper bones (<Bone>Helper), if present, are driven to half their bone's rotation, like the game does."""
import bpy, sys, math
from mathutils import Vector, Quaternion, Matrix
blend, outdir, tag = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.open_mainfile(filepath=blend)
rig = bpy.data.objects["WomanRig"]
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'; scene.view_settings.view_transform = 'AgX'
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.4, 0.4, 0.42, 1)
for nm, loc, e in (("key", (-2.5, -3.5, 2.8), 900), ("fill", (3, -3, 1.5), 400), ("rim", (0, 3.5, 2.5), 500)):
    l = bpy.data.lights.new(nm, 'AREA'); l.energy = e; l.size = 3
    o = bpy.data.objects.new(nm, l); o.location = loc; scene.collection.objects.link(o)
    o.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
bpy.context.view_layer.objects.active = rig; bpy.ops.object.mode_set(mode='POSE')

def rot_world(name, axis, deg):
    pb = rig.pose.bones[name]; bpy.context.view_layer.update()
    Mw = rig.matrix_world @ pb.matrix; T = Matrix.Translation(Mw.to_translation())
    pb.matrix = rig.matrix_world.inverted() @ (T @ Quaternion(Vector(axis), math.radians(deg)).to_matrix().to_4x4() @ T.inverted() @ Mw)
    bpy.context.view_layer.update()

def drive_helpers():
    for pb in rig.pose.bones:
        if pb.name.endswith("Helper"):
            src = rig.pose.bones[pb.name[:-6]]
            pb.rotation_mode = 'QUATERNION'
            src.rotation_mode = 'QUATERNION'
            pb.rotation_quaternion = Quaternion().slerp(src.rotation_quaternion, 0.5)
    bpy.context.view_layer.update()

def shoot(name, loc, tgt, lens=70, res=(700, 700)):
    scene.render.resolution_x, scene.render.resolution_y = res
    cam.location = loc; cd.lens = lens
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f"{outdir}/jt_{tag}_{name}.png"; bpy.ops.render.render(write_still=True)

for pb in rig.pose.bones: pb.rotation_mode = 'QUATERNION'
# Knee: deep bend. Elbow: 130°. Shoulder: arm raised overhead. Hip: thigh up 100°.
rot_world("LeftUpLeg", (1, 0, 0), -100); rot_world("LeftLeg", (1, 0, 0), 125)
rot_world("LeftArm", (1, 0, 0), -125); rot_world("LeftForeArm", (1, 0, 0), -120)
drive_helpers()
kn = rig.matrix_world @ rig.pose.bones["LeftLeg"].head
el = rig.matrix_world @ rig.pose.bones["LeftForeArm"].head
sh = rig.matrix_world @ rig.pose.bones["LeftArm"].head
hp = rig.matrix_world @ rig.pose.bones["LeftUpLeg"].head
shoot("knee", kn + Vector((0.55, -0.15, 0.05)), kn, 70)
shoot("elbow", el + Vector((0.5, 0.1, 0.1)), el, 70)
shoot("shoulder", sh + Vector((0.45, -0.35, -0.15)), sh + Vector((0, 0, 0.03)), 60)
shoot("hip", hp + Vector((0.6, 0.05, -0.05)), hp + Vector((0, -0.05, -0.02)), 60)
