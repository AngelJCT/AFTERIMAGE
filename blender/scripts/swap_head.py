"""Replace the rigged body's head with a separate head scan.
Cuts both meshes at the neck (inside the feather collar), decimates the scan, bakes its detail
into a normal map, copies skin weights from the body, and binds it to the same skeleton.
Usage: Blender -b -P swap_head.py -- <rigged.blend> <head.glb> <xform.json> <workdir> [tris] [cutZ]"""
import bpy, sys, json, bmesh
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
rigged, head_glb, xform_path, workdir = args[:4]
TARGET_TRIS = int(args[4]) if len(args) > 4 else 45000
CUT = float(args[5]) if len(args) > 5 else 1.385
bpy.ops.wm.open_mainfile(filepath=rigged)
rig = bpy.data.objects["WomanRig"]; body = bpy.data.objects["Woman"]
scene = bpy.context.scene

# ── Import + place the scan.
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=head_glb)
new = [o for o in bpy.data.objects if o not in before]
head = [o for o in new if o.type == 'MESH'][0]
for o in new:
    if o is not head: bpy.data.objects.remove(o)
for o in list(bpy.data.objects):
    if o.type == 'EMPTY' and o.name.startswith('ROOT'): bpy.data.objects.remove(o)
mw = head.matrix_world.copy(); head.parent = None; head.matrix_world = mw; head.name = "WomanHeadHi"
X = json.load(open(xform_path))
R = Matrix([list(r) + [0] for r in X["R"]] + [[0, 0, 0, 1]])
M = Matrix.Translation(Vector(X["t"])) @ R @ Matrix.Scale(X["s"], 4)
head.matrix_world = M @ head.matrix_world
bpy.ops.object.select_all(action='DESELECT'); head.select_set(True); bpy.context.view_layer.objects.active = head
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def cut_below(obj, z, keep_above=True):
    bm = bmesh.new(); bm.from_mesh(obj.data)
    kill = [v for v in bm.verts if (v.co.z < z) == keep_above]
    bmesh.ops.delete(bm, geom=kill, context='VERTS')
    bm.to_mesh(obj.data); bm.free(); obj.data.update()

# Scan keeps everything above the cut (head, hair, upper neck); a little overlap below.
cut_below(head, CUT - 0.006, keep_above=True)
bm = bmesh.new(); bm.from_mesh(head.data)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00002)
bm.to_mesh(head.data); bm.free()
print("scan tris above cut:", sum(len(p.vertices) - 2 for p in head.data.polygons))

# ── Low-poly copy for the game.
low = head.copy(); low.data = head.data.copy(); low.name = "WomanHead"
scene.collection.objects.link(low)
tris = sum(len(p.vertices) - 2 for p in low.data.polygons)
# Spend the budget on the face: eyes, lashes, nose and mouth resist collapse.
grp = low.vertex_groups.new(name="faceDetail")
eyes = Vector((0.0, -0.1, 1.488))
for v in low.data.vertices:
    p = v.co
    front = max(0.0, min(1.0, (-0.03 - p.y) / 0.04))             # facing forward
    near = max(0.0, 1.0 - ((p - eyes) * Vector((1.0, 0.6, 1.1))).length / 0.075)
    wgt = front * min(1.0, near * 1.6)
    if wgt > 0.001: grp.add([v.index], wgt, 'REPLACE')
dec = low.modifiers.new("dec", 'DECIMATE'); dec.decimate_type = 'COLLAPSE'
dec.ratio = min(1.0, TARGET_TRIS / tris); dec.use_collapse_triangulate = True
dec.vertex_group = "faceDetail"; dec.invert_vertex_group = True; dec.vertex_group_factor = 1.0
bpy.ops.object.select_all(action='DESELECT'); low.select_set(True); bpy.context.view_layer.objects.active = low
bpy.ops.object.modifier_apply(modifier="dec")
for p in low.data.polygons: p.use_smooth = True
print("head low tris:", sum(len(p.vertices) - 2 for p in low.data.polygons))

# ── Bake scan detail (geometry + its own normal map) onto the low head.
mat = low.active_material.copy(); low.data.materials[0] = mat
size = 4096
img = bpy.data.images.new("head_normal", size, size); img.colorspace_settings.name = 'Non-Color'
node = mat.node_tree.nodes.new("ShaderNodeTexImage"); node.image = img; mat.node_tree.nodes.active = node
scene.render.engine = 'CYCLES'; scene.cycles.samples = 1
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print("GPU unavailable", e)
bpy.ops.object.select_all(action='DESELECT')
head.select_set(True); low.select_set(True); bpy.context.view_layer.objects.active = low
scene.render.bake.use_selected_to_active = True
scene.render.bake.cage_extrusion = 0.004
scene.render.bake.max_ray_distance = 0.012
scene.render.bake.margin = 16
bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
img.filepath_raw = f"{workdir}/head_normal.png"; img.file_format = 'PNG'; img.save(); img.pack()
nt = mat.node_tree
old_nrm = [n for n in nt.nodes if n.type == 'NORMAL_MAP'][0]
old_nrm.inputs["Color"].default_value = (0.5, 0.5, 1, 1)
for l in list(old_nrm.inputs["Color"].links): nt.links.remove(l)
nt.links.new(node.outputs["Color"], old_nrm.inputs["Color"])
bpy.data.objects.remove(head)

# ── Skin weights from the body (before trimming it), then bind.
dt = low.modifiers.new("w", 'DATA_TRANSFER')
dt.object = body; dt.use_vert_data = True; dt.data_types_verts = {'VGROUP_WEIGHTS'}
dt.vert_mapping = 'POLYINTERP_NEAREST'; dt.layers_vgroup_select_src = 'ALL'; dt.layers_vgroup_select_dst = 'NAME'
bpy.ops.object.select_all(action='DESELECT'); low.select_set(True); bpy.context.view_layer.objects.active = low
bpy.ops.object.datalayout_transfer(modifier="w")
bpy.ops.object.modifier_apply(modifier="w")
low.parent = rig
am = low.modifiers.new("Armature", 'ARMATURE'); am.object = rig
bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
bpy.ops.object.mode_set(mode='OBJECT')

# ── Trim the body's old head, overlapping slightly inside the new neck.
cut_below(body, CUT + 0.006, keep_above=False)
bpy.ops.wm.save_as_mainfile(filepath=rigged)
print("SWAP_OK")
