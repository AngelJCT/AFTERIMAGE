"""Build the game skeleton from joints.json, skin the mesh, add story sockets, save .blend.
Usage: Blender -b -P build_rig.py -- <prep.blend> <joints.json> <out.blend>"""
import bpy, sys, json, bmesh
import numpy as np
from mathutils import Vector, kdtree

prep, jpath, out = sys.argv[sys.argv.index("--") + 1:][:3]
import os
VOXEL = float(os.environ.get('RIG_VOXEL', 0.004))
bpy.ops.wm.open_mainfile(filepath=prep)
J = {k: Vector(v) for k, v in json.load(open(jpath)).items() if not k.startswith("_") and isinstance(v, list)}
# Mirror left -> right for a symmetric skeleton.
for k in list(J):
    if k.startswith("Left"):
        p = J[k]; J["Right" + k[4:]] = Vector((-p.x, p.y, p.z))
# Average each left/right pair so both sides are exactly mirrored.
for k in list(J):
    if k.startswith("Left"):
        r = "Right" + k[4:]; a, b = J[k], J[r]
        m = Vector(((a.x - b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2))
        J[k] = m; J[r] = Vector((-m.x, m.y, m.z))

body = bpy.data.objects["Woman"]
FINGERS = ["Thumb", "Index", "Middle", "Ring", "Pinky"]
# (bone, parent, tail-joint)
spec = [("Hips", None, "Spine"), ("Spine", "Hips", "Spine1"), ("Spine1", "Spine", "Spine2"),
        ("Spine2", "Spine1", "Neck"), ("Neck", "Spine2", "Head"), ("Head", "Neck", "HeadTop_End")]
for s in ("Left", "Right"):
    spec += [(f"{s}Shoulder", "Spine2", f"{s}Arm"), (f"{s}Arm", f"{s}Shoulder", f"{s}ForeArm"),
             (f"{s}ForeArm", f"{s}Arm", f"{s}Hand"), (f"{s}Hand", f"{s}ForeArm", f"{s}HandMiddle1"),
             (f"{s}UpLeg", "Hips", f"{s}Leg"), (f"{s}Leg", f"{s}UpLeg", f"{s}Foot"),
             (f"{s}Foot", f"{s}Leg", f"{s}ToeBase"), (f"{s}ToeBase", f"{s}Foot", f"{s}Toe_End")]
    for f in FINGERS:
        for i in (1, 2, 3):
            spec.append((f"{s}Hand{f}{i}", f"{s}Hand" if i == 1 else f"{s}Hand{f}{i-1}", f"{s}Hand{f}{i+1}"))

arm_data = bpy.data.armatures.new("WomanRig")
rig = bpy.data.objects.new("WomanRig", arm_data)
bpy.context.scene.collection.objects.link(rig)
bpy.context.view_layer.objects.active = rig
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
for name, parent, tail in spec:
    b = eb.new(name)
    b.head = J[name]; b.tail = J[tail]
    if (b.tail - b.head).length < 0.004:
        b.tail = b.head + Vector((0, 0, 0.01))
    if parent:
        b.parent = eb[parent]
        b.use_connect = (parent != "Hips" and (eb[parent].tail - b.head).length < 1e-4)
# Consistent rolls so authored animation has predictable axes.
bpy.ops.armature.select_all(action='SELECT')
bpy.ops.armature.calculate_roll(type='GLOBAL_POS_Y')

# Non-deform sockets used by the game.
for s, sx in (("Left", 1), ("Right", -1)):
    tip = J[f"{s}HandIndex4"]; d = (tip - J[f"{s}HandIndex3"]).normalized()
    b = eb.new(f"{s}IndexTip"); b.head = tip; b.tail = tip + d * 0.01; b.parent = eb[f"{s}HandIndex3"]; b.use_deform = False

# Shoulder port: find the cyan-emissive texels on her LEFT upper arm.
img = None
for n in body.active_material.node_tree.nodes:
    if n.type == 'TEX_IMAGE' and 'basecolor' in n.image.name: img = n.image
W, H = img.size
px = np.empty(W * H * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(H, W, 4)
me = body.data
uv = np.zeros((len(me.vertices), 2), dtype=np.float32)
for l in me.loops: uv[l.vertex_index] = me.uv_layers.active.data[l.index].uv[:]
xs = np.clip((uv[:, 0] * (W - 1)).astype(int), 0, W - 1); ys = np.clip((uv[:, 1] * (H - 1)).astype(int), 0, H - 1)
c = px[ys, xs]
co = np.array([v.co[:] for v in me.vertices])
cyan = (c[:, 2] > 0.55) & (c[:, 0] < 0.35) & (c[:, 2] - c[:, 0] > 0.3) & (co[:, 0] > 0.1) & (co[:, 2] > 1.1) & (co[:, 2] < 1.36)
print("cyan verts on left shoulder:", int(cyan.sum()))
if cyan.sum() >= 3:
    pc = Vector(co[cyan].mean(0))
    nrm = Vector(np.array([me.vertices[i].normal[:] for i in np.nonzero(cyan)[0]]).mean(0)).normalized()
else:  # fallback: outer deltoid
    pc = J["LeftArm"] + Vector((0.045, 0.0, -0.03)); nrm = Vector((1, 0, 0))
b = eb.new("LeftShoulderPort"); b.head = pc; b.tail = pc + nrm * 0.03; b.parent = eb["LeftArm"]; b.use_deform = False
print("port at", tuple(round(v, 3) for v in pc), "normal", tuple(round(v, 2) for v in nrm))
bpy.ops.object.mode_set(mode='OBJECT')

# Skin: bone-heat on a watertight voxel proxy (the scan has overlapping shells, which
# makes heat weighting fail), then transfer the weights to the real mesh.
proxy = body.copy(); proxy.data = body.data.copy(); proxy.name = "WeightProxy"
bpy.context.scene.collection.objects.link(proxy)
proxy.data.materials.clear()
rm = proxy.modifiers.new("remesh", 'REMESH'); rm.mode = 'VOXEL'; rm.voxel_size = VOXEL; rm.adaptivity = 0.0
bpy.ops.object.select_all(action='DESELECT'); proxy.select_set(True); bpy.context.view_layer.objects.active = proxy
bpy.ops.object.modifier_apply(modifier="remesh")
# Keep only the largest solid: loose shells (hair strands, a hood's lining) make the heat
# solve fail for everything.
bm = bmesh.new(); bm.from_mesh(proxy.data)
seen, islands = set(), []
for v in bm.verts:
    if v.index in seen: continue
    comp, stack = [], [v]
    seen.add(v.index)
    while stack:
        x = stack.pop(); comp.append(x)
        for e in x.link_edges:
            y = e.other_vert(x)
            if y.index not in seen: seen.add(y.index); stack.append(y)
    islands.append(comp)
islands.sort(key=len, reverse=True)
for comp in islands[1:]:
    bmesh.ops.delete(bm, geom=comp, context='VERTS')
bm.to_mesh(proxy.data); bm.free()
print("proxy verts", len(proxy.data.vertices), "islands dropped", len(islands) - 1)
# Bone heat is numerically fragile at metre scale on dense meshes: solve at 100x.
def rescale(objs, k):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True); o.scale = [k * x for x in o.scale]
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
rescale([proxy, rig], 100.0)
bpy.ops.object.select_all(action='DESELECT')
proxy.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
proxy.parent = None
rescale([proxy, rig], 0.01)
pw = sum(1 for v in proxy.data.vertices if any(g.weight > 1e-4 for g in v.groups))
print("proxy weighted", pw, "of", len(proxy.data.vertices))

bpy.ops.object.select_all(action='DESELECT')
body.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_NAME')  # empty groups + armature modifier
dt = body.modifiers.new("weights", 'DATA_TRANSFER')
dt.object = proxy; dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}
dt.vert_mapping = 'POLYINTERP_NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
bpy.context.view_layer.objects.active = body
bpy.ops.object.modifier_move_to_index(modifier="weights", index=0)
bpy.ops.object.modifier_apply(modifier="weights")
bpy.data.objects.remove(proxy)

# Clean-up passes on the weights.
deform = [b.name for b in arm_data.bones if b.use_deform]
vg = body.vertex_groups
gi = {g.name: g.index for g in vg}
def weights_of(v):
    return {vg[g.group].name: g.weight for g in v.groups if g.weight > 1e-4}
# 1) hair and head above the neck move only with Neck/Head.
neckZ = J["Neck"].z; headZ = J["Head"].z
for v in me.vertices:
    p = v.co
    if p.z > headZ - 0.03 and abs(p.x) < 0.17:
        w = weights_of(v)
        keep = {k: w.get(k, 0) for k in ("Head", "Neck")}
        if p.z > headZ + 0.02: keep = {"Head": 1.0, "Neck": 0.0}
        tot = sum(keep.values()) or 1.0
        for g in list(v.groups): vg[g.group].remove([v.index])
        if tot == 0: keep = {"Head": 1.0}
        for k, val in keep.items():
            if val > 0: vg[k].add([v.index], val / tot, 'REPLACE')
# 2) any vertex left unweighted copies its nearest weighted neighbour.
kd = kdtree.KDTree(len(me.vertices))
weighted = [v.index for v in me.vertices if any(g.weight > 1e-4 for g in v.groups)]
for i in weighted: kd.insert(me.vertices[i].co, i)
kd.balance()
empty = [v for v in me.vertices if not any(g.weight > 1e-4 for g in v.groups)]
for v in empty:
    _, j, _ = kd.find(v.co)
    for k, w in weights_of(me.vertices[j]).items(): vg[k].add([v.index], w, 'REPLACE')
print("unweighted fixed:", len(empty), "of", len(me.vertices))
# 3) limit to 4 influences (glTF/WebGPU skinning) and normalise.
bpy.context.view_layer.objects.active = body
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.wm.save_as_mainfile(filepath=out)
print("RIG_OK bones", len(arm_data.bones))
