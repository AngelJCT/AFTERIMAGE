"""Bake tangent-space normals from the 2M Tripo mesh onto the prepared quad mesh, then blend
them into Tripo's own normal map by region (body gets the 2M detail; head, hair, hands and the
shoulder port keep the original, which is aligned with the painted colour). Saves the blend
back into <prep.blend> so the rig/export steps pick it up.
Usage: Blender -b -P bake_hi_normals.py -- <prep.blend> <hi.glb> <out_normal.png> [size]"""
import bpy, sys
import numpy as np
from mathutils import Vector
args = sys.argv[sys.argv.index("--") + 1:]
prep, hi_path, out_png = args[:3]; size = int(args[3]) if len(args) > 3 else 4096
bpy.ops.wm.open_mainfile(filepath=prep)
low = bpy.data.objects["Woman"]
before = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=hi_path)
parts = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
for o in [o for o in bpy.data.objects if o not in before and o.type != 'MESH']:
    for c in o.children:
        mw = c.matrix_world.copy(); c.parent = None; c.matrix_world = mw
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
hi = bpy.context.object; hi.name = "Hi"
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
# Normalise exactly like prep_mesh.py (1.65 m, centred in x/y, feet at 0).
co = np.empty(len(hi.data.vertices) * 3, dtype=np.float32); hi.data.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
s = 1.65 / (co[:, 2].max() - co[:, 2].min())
off = np.array([(co[:, 0].max() + co[:, 0].min()) / 2, (co[:, 1].max() + co[:, 1].min()) / 2, co[:, 2].min()])
co = (co - off) * s
hi.data.vertices.foreach_set("co", co.ravel()); hi.data.update()

# Alignment report
from mathutils.bvhtree import BVHTree
import bmesh
bm = bmesh.new(); bm.from_mesh(hi.data); tree = BVHTree.FromBMesh(bm)
d = sorted(tree.find_nearest(v.co)[3] for v in list(low.data.vertices)[::7])
print(f"ALIGN median={d[len(d)//2]*1000:.1f}mm p90={d[int(len(d)*.9)]*1000:.1f}mm p99={d[int(len(d)*.99)]*1000:.1f}mm")

img = bpy.data.images.new("hi_normal", size, size, float_buffer=False)
img.colorspace_settings.name = 'Non-Color'
mat = low.active_material
node = mat.node_tree.nodes.new("ShaderNodeTexImage"); node.image = img
mat.node_tree.nodes.active = node
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 1
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print("GPU unavailable", e)
bpy.ops.object.select_all(action='DESELECT')
hi.select_set(True); low.select_set(True); bpy.context.view_layer.objects.active = low
scene.render.bake.use_selected_to_active = True
scene.render.bake.cage_extrusion = 0.012
scene.render.bake.max_ray_distance = 0.03
scene.render.bake.margin = 16
bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
bpy.data.objects.remove(hi)

# Region mask per vertex -> baked into UV space through an emission bake.
me = low.data
port = Vector((0.179, 0.039, 1.291))
def ramp(x, a, b):
    return max(0.0, min(1.0, (x - a) / (b - a)))
attr = me.color_attributes.new("detailMask", 'FLOAT_COLOR', 'POINT')
for v in me.vertices:
    p = v.co
    m = 0.85
    m *= 1 - ramp(p.z, 1.36, 1.40)                                  # head, face, hair
    m *= 1 - ramp(abs(p.x), 0.245, 0.265) * (1 - ramp(p.z, 0.92, 0.95))  # hands
    m *= ramp((p - port).length, 0.045, 0.065)                       # shoulder port
    attr.data[v.index].color = (m, m, m, 1)
mask_img = bpy.data.images.new("detail_mask", size, size, float_buffer=False)
mask_img.colorspace_settings.name = 'Non-Color'
tmp = bpy.data.materials.new("maskbake"); tmp.use_nodes = True
nt = tmp.node_tree; nt.nodes.remove(nt.nodes["Principled BSDF"])
a = nt.nodes.new("ShaderNodeAttribute"); a.attribute_name = "detailMask"
e = nt.nodes.new("ShaderNodeEmission"); nt.links.new(a.outputs["Color"], e.inputs["Color"])
nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs[0])
t = nt.nodes.new("ShaderNodeTexImage"); t.image = mask_img; nt.nodes.active = t
orig_mat = me.materials[0]; me.materials[0] = tmp
bpy.ops.object.select_all(action='DESELECT'); low.select_set(True); bpy.context.view_layer.objects.active = low
scene.render.bake.use_selected_to_active = False
bpy.ops.object.bake(type='EMIT')
me.materials[0] = orig_mat
mat.node_tree.nodes.remove(node)

# Blend in tangent space.
def arr(im):
    a = np.empty(size * size * 4, dtype=np.float32); im.pixels.foreach_get(a); return a.reshape(size, size, 4)
tri_node = [n for n in mat.node_tree.nodes if n.type == 'TEX_IMAGE' and 'normal' in n.image.name][0]
tri = tri_node.image
if tri.size[0] != size: tri.scale(size, size)
A = arr(tri)[..., :3] * 2 - 1
B = arr(img)[..., :3] * 2 - 1
M = arr(mask_img)[..., :1]
N = A * (1 - M) + B * M
N /= np.linalg.norm(N, axis=2, keepdims=True) + 1e-6
outp = np.concatenate([N * 0.5 + 0.5, np.ones((size, size, 1), np.float32)], axis=2)
comb = bpy.data.images.new("normal_detail", size, size, float_buffer=False)
comb.colorspace_settings.name = 'Non-Color'
comb.pixels.foreach_set(outp.ravel())
comb.filepath_raw = out_png; comb.file_format = 'PNG'; comb.save()
comb.pack()
tri_node.image = comb
me.color_attributes.remove(me.color_attributes["detailMask"])
bpy.ops.wm.save_as_mainfile(filepath=prep)
print("BAKE_OK", out_png)
