"""Forearm twist bones: `<Side>ForeArmTwist`, a child of the forearm from its middle to the
wrist. The distal half of the forearm's skin moves onto it with a smooth ramp, and the game
turns it by part of the hand's roll about the forearm, so a turned wrist spreads the twist
along the forearm instead of pinching at the joint.

Usage: Blender -b -P add_twist.py -- <woman_rigged.blend>
"""
import bpy, sys
from mathutils.geometry import intersect_point_line

blend = sys.argv[sys.argv.index("--") + 1:][0]
bpy.ops.wm.open_mainfile(filepath=blend)
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
body = bpy.data.objects["Woman"]

bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm.data.edit_bones
seg = {}
for side in ("Left", "Right"):
    name = f"{side}ForeArmTwist"
    if name in eb: eb.remove(eb[name])
    fa, hand = eb[f"{side}ForeArm"], eb[f"{side}Hand"]
    b = eb.new(name)
    b.head = fa.head.lerp(hand.head, 0.5)
    b.tail = hand.head.copy()
    b.roll = fa.roll
    b.parent = fa
    b.use_deform = True
    seg[side] = (arm.matrix_world @ fa.head, arm.matrix_world @ hand.head)
bpy.ops.object.mode_set(mode='OBJECT')

M = body.matrix_world
for side in ("Left", "Right"):
    fa_g = body.vertex_groups.get(f"{side}ForeArm")
    tw_g = body.vertex_groups.get(f"{side}ForeArmTwist") or body.vertex_groups.new(name=f"{side}ForeArmTwist")
    a, b = seg[side]
    moved = 0
    for v in body.data.vertices:
        w = next((g.weight for g in v.groups if g.group == fa_g.index), 0.0)
        if w <= 0: continue
        p = M @ v.co
        q, t = intersect_point_line(p, a, b)
        if (p - q).length > 0.1: continue
        # Ramp: none at mid-forearm, most of the forearm's weight by the wrist.
        k = max(0.0, min(1.0, (t - 0.35) / 0.6))
        k = k * k * (3 - 2 * k) * 0.9
        if k <= 0: continue
        fa_g.add([v.index], w * (1 - k), 'REPLACE')
        tw_g.add([v.index], w * k, 'REPLACE')
        moved += 1
    print(side, "twist verts", moved)

bpy.ops.wm.save_as_mainfile(filepath=blend)
print("TWIST_OK")
