"""Inspect the hands of the rigged character: close-up renders and finger-web statistics.

Usage: Blender -b work/woman_rigged.blend -P hand_check.py -- <outdir>
Each hand vertex is assigned to the nearest finger bone segment; faces whose vertices belong
to two different fingers past the knuckles are 'web' faces (fingers fused together).
"""
import bpy, sys, json
from mathutils import Vector
from mathutils.geometry import intersect_point_line

out = sys.argv[sys.argv.index("--") + 1:][0]
body = bpy.data.objects["Woman"]
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
J = {}
for b in arm.data.bones:
    J[b.name] = arm.matrix_world @ b.head_local
    J[b.name + "_tail"] = arm.matrix_world @ b.tail_local
for s_ in ("Left", "Right"):
    for f in ["Thumb", "Index", "Middle", "Ring", "Pinky"]:
        J[f"{s_}Hand{f}4"] = J[f"{s_}Hand{f}3_tail"]
me = body.data
M = body.matrix_world
FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"]

for side in ("Left", "Right"):
    segs = []
    for f in FINGERS:
        for i in range(1, 4):
            a, b = J[f"{side}Hand{f}{i}"], J[f"{side}Hand{f}{i+1}"]
            segs.append((f, i, a, b))
    wrist = J[f"{side}Hand"]
    owner = {}
    for v in me.vertices:
        p = M @ v.co
        if (p - wrist).length > 0.2: continue
        best, bd = None, 1e9
        for f, i, a, b in segs:
            q, t = intersect_point_line(p, a, b)
            t = max(0.0, min(1.0, t)); q = a.lerp(b, t)
            d = (p - q).length
            if d < bd: bd, best = d, (f, i, t)
        if bd < 0.03: owner[v.index] = best
    web = 0; pairs = {}
    for poly in me.polygons:
        fs = {owner[i][0] for i in poly.vertices if i in owner and (owner[i][1] > 1 or owner[i][2] > 0.35)}
        if len(fs) > 1:
            web += 1
            k = "-".join(sorted(fs)); pairs[k] = pairs.get(k, 0) + 1
    print(side, "hand verts", len(owner), "web faces", web, pairs)

# Renders: right hand from back, palm and side.
scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x, scene.render.resolution_y = 900, 700
w = bpy.data.worlds.new("w"); scene.world = w; w.use_nodes = True
w.node_tree.nodes["Background"].inputs[1].default_value = 2.5
sun = bpy.data.lights.new("s", "SUN"); sun.energy = 3; so = bpy.data.objects.new("s", sun); so.rotation_euler = (0.6, 0.2, 0.5); scene.collection.objects.link(so)
cd = bpy.data.cameras.new("c"); cam = bpy.data.objects.new("c", cd); scene.collection.objects.link(cam); scene.camera = cam
cd.lens = 60
for side in ("Right",):
    c = (J[f"{side}HandMiddle1"] + J[f"{side}HandMiddle3"]) / 2
    for name, off in (("back", Vector((0.0, 0.0, 0.0))),):
        pass
    views = {"out": Vector((-0.22, 0, 0)) if side == "Right" else Vector((0.35, 0, 0)),
             "front": Vector((0, -0.22, 0)), "in": Vector((0.22, 0, 0)) if side == "Right" else Vector((-0.35, 0, 0))}
    for name, off in views.items():
        cam.location = c + off
        cam.rotation_euler = (c - cam.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = f"{out}/hand_{side}_{name}.png"
        bpy.ops.render.render(write_still=True)
