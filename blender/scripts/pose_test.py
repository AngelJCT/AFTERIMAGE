"""Render the rigged body in stress poses. Usage: -- <rigged.blend> <outdir>"""
import bpy, sys, math
from mathutils import Vector, Euler, Quaternion
blend, outdir = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.open_mainfile(filepath=blend)
rig = bpy.data.objects["WomanRig"]; body = bpy.data.objects["Woman"]
scene = bpy.context.scene
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='POSE')

def rot_world(name, axis, deg):
    """Rotate a pose bone about a WORLD axis (so tests don't depend on bone rolls)."""
    pb = rig.pose.bones[name]
    bpy.context.view_layer.update()
    M = rig.matrix_world @ pb.matrix
    q = Quaternion(Vector(axis), math.radians(deg))
    R = q.to_matrix().to_4x4()
    loc = M.to_translation()
    newM = (R @ (M - __import__('mathutils').Matrix.Translation(loc) @ __import__('mathutils').Matrix.Identity(4)) ) if False else None
    T = __import__('mathutils').Matrix.Translation(loc)
    newM = T @ R @ T.inverted() @ M
    pb.matrix = rig.matrix_world.inverted() @ newM
    bpy.context.view_layer.update()

def reset():
    for pb in rig.pose.bones:
        pb.rotation_mode = 'QUATERNION'; pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
    bpy.context.view_layer.update()

scene.render.engine = 'BLENDER_EEVEE'; scene.view_settings.view_transform = 'AgX'
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[0].default_value = (0.4, 0.4, 0.42, 1)
for nm, loc, e in (("key", (-2.5, -3.5, 2.8), 900), ("fill", (3, -3, 1.5), 350), ("rim", (0, 3.5, 2.5), 500)):
    l = bpy.data.lights.new(nm, 'AREA'); l.energy = e; l.size = 3
    o = bpy.data.objects.new(nm, l); o.location = loc; scene.collection.objects.link(o)
    o.rotation_euler = (Vector((0, 0, 1)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
def shoot(name, loc, tgt, lens=50, res=(800, 1000)):
    scene.render.resolution_x, scene.render.resolution_y = res
    cam.location = loc; cd.lens = lens
    cam.rotation_euler = (Vector(tgt) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = f"{outdir}/pose_{name}.png"; bpy.ops.render.render(write_still=True)

# Pose 1: arms down + elbows bent, fingers curled, head turned, one knee raised.
reset()
rot_world("LeftArm", (0, 1, 0), 32); rot_world("RightArm", (0, 1, 0), -32)
rot_world("LeftForeArm", (1, 0, 0), 70); rot_world("RightForeArm", (1, 0, 0), 45)
for s in ("Left", "Right"):
    for f in ("Index", "Middle", "Ring", "Pinky"):
        for i, a in ((1, 50), (2, 60), (3, 40)):
            rot_world(f"{s}Hand{f}{i}", (1, 0, 0) if s == "Left" else (1, 0, 0), a if s == "Right" else 0)
rot_world("Head", (0, 0, 1), 30); rot_world("Spine1", (1, 0, 0), 12)
rot_world("LeftUpLeg", (1, 0, 0), -70); rot_world("LeftLeg", (1, 0, 0), 90)
shoot("p1_front", (0.6, -3.6, 1.0), (0, 0, 0.9), 45)
shoot("p1_side", (3.4, -1.2, 1.0), (0, 0, 0.9), 45)
# Pose 2: right arm reaching forward-down, index extended (the water touch).
reset()
rot_world("RightArm", (1, 0, 0), -35); rot_world("RightArm", (0, 1, 0), -40)
rot_world("RightHand", (1, 0, 0), -20)
for f, a in (("Middle", 55), ("Ring", 65), ("Pinky", 70)):
    for i in (1, 2): rot_world(f"RightHand{f}{i}", (1, 0, 0), a)
rot_world("Spine", (1, 0, 0), 20); rot_world("Spine1", (1, 0, 0), 15)
hand = rig.matrix_world @ rig.pose.bones["RightHand"].head
shoot("p2_hand", hand + Vector((-0.25, -0.35, 0.05)), hand + Vector((0, -0.05, -0.05)), 60, (900, 900))
shoot("p2_full", (-2.2, -2.6, 1.1), (0, 0, 0.9), 45)

# Pose 3: arms raised overhead-forward (gate brace), deep kneel.
reset()
rot_world("LeftArm", (1, 0, 0), -120); rot_world("RightArm", (1, 0, 0), -120)
rot_world("LeftArm", (0, 1, 0), -20); rot_world("RightArm", (0, 1, 0), 20)
rot_world("LeftForeArm", (1, 0, 0), -30); rot_world("RightForeArm", (1, 0, 0), -30)
rot_world("LeftUpLeg", (1, 0, 0), -100); rot_world("LeftLeg", (1, 0, 0), 120)
rot_world("RightUpLeg", (1, 0, 0), -20); rot_world("RightLeg", (1, 0, 0), 100)
sh = rig.matrix_world @ rig.pose.bones["LeftArm"].head
shoot("p3_full", (2.6, -2.4, 1.2), (0, 0, 1.0), 45)
shoot("p3_shoulder", sh + Vector((0.55, -0.35, -0.1)), sh + Vector((0, 0, 0.05)), 70, (900, 900))
kn = rig.matrix_world @ rig.pose.bones["LeftLeg"].head
shoot("p3_knee", kn + Vector((0.6, -0.3, 0.1)), kn, 70, (900, 900))
