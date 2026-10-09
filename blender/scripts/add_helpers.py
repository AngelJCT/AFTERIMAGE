"""Add corrective "half-rotation" helper bones at the big joints and move the blend band's
skin onto them, so bent joints keep their volume (linear skinning otherwise pinches).
A helper <X>Helper shares X's parent, head and rest orientation; the game (and joint_test.py)
drives it to half of X's rotation. Usage: Blender -b -P add_helpers.py -- <rigged.blend>"""
import bpy, sys
from mathutils import Vector

blend = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.open_mainfile(filepath=blend)
rig = bpy.data.objects["WomanRig"]; body = bpy.data.objects["Woman"]

# joint bone -> (radius of influence m, max share)
JOINTS = {"Leg": (0.10, 0.9), "ForeArm": (0.08, 0.8), "Arm": (0.11, 0.75), "UpLeg": (0.13, 0.7)}

bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = rig.data.edit_bones
heads = {}
for side in ("Left", "Right"):
    for j in JOINTS:
        x = eb[f"{side}{j}"]
        name = f"{side}{j}Helper"
        if name in eb: eb.remove(eb[name])
        h = eb.new(name)
        h.head = x.head.copy(); h.tail = x.head + (x.tail - x.head) * 0.25; h.roll = x.roll
        h.parent = x.parent; h.use_connect = False; h.use_deform = True
        heads[name] = (x.head.copy(), x.name)
bpy.ops.object.mode_set(mode='OBJECT')

vg = body.vertex_groups
me = body.data
for name, (head, xname) in heads.items():
    j = xname.replace("Left", "").replace("Right", "")
    radius, share = JOINTS[j]
    g = vg.get(name) or vg.new(name=name)
    gx = vg[xname].index
    moved = 0
    for v in me.vertices:
        d = (v.co - head).length
        if d > radius: continue
        wx = next((e.weight for e in v.groups if e.group == gx), 0.0)
        if wx <= 0.02 or wx >= 0.98: continue
        band = 1.0 - abs(2.0 * wx - 1.0)          # 1 at a 50/50 blend, 0 at either side
        h = share * band * (1.0 - (d / radius) ** 2)
        if h < 0.02: continue
        for e in v.groups: e.weight *= (1.0 - h)
        g.add([v.index], h, 'ADD')
        moved += 1
    print(f"{name}: {moved} verts")

bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.wm.save_as_mainfile(filepath=blend)
print("HELPERS_OK")
