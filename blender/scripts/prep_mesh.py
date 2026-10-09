# Step 1 of the character pipeline.
# Import the Tripo quad GLB, bake transforms, scale to 1.65 m (feet at 0, facing -Y),
# weld UV-seam duplicates, rebuild quads, save a working .blend and a numpy dump for analysis.
# Usage: Blender -b -P prep_mesh.py -- <in.glb> <out.blend> <out.npz>
import bpy, sys, bmesh
import numpy as np
from mathutils import Vector

src, out_blend, out_npz = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
mesh = [o for o in bpy.data.objects if o.type == 'MESH'][0]
for o in list(bpy.data.objects):
    if o is not mesh and o.type == 'EMPTY':
        mw = mesh.matrix_world.copy(); mesh.parent = None; mesh.matrix_world = mw
        bpy.data.objects.remove(o)
bpy.ops.object.select_all(action='DESELECT')
mesh.select_set(True); bpy.context.view_layer.objects.active = mesh
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

me = mesh.data
co = np.array([v.co[:] for v in me.vertices])
s = 1.65 / (co[:, 2].max() - co[:, 2].min())
off = np.array([(co[:, 0].max() + co[:, 0].min()) / 2, (co[:, 1].max() + co[:, 1].min()) / 2, co[:, 2].min()])
for v in me.vertices:
    v.co = Vector(((v.co.x - off[0]) * s, (v.co.y - off[1]) * s, (v.co.z - off[2]) * s))

bm = bmesh.new(); bm.from_mesh(me)
bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00005)
bmesh.ops.join_triangles(bm, faces=bm.faces, angle_face_threshold=0.7, angle_shape_threshold=0.7,
                         cmp_seam=False, cmp_sharp=False, cmp_uvs=True)
bm.to_mesh(me); bm.free()
me.update()
for p in me.polygons: p.use_smooth = True
mesh.name = "Woman"; me.name = "WomanMesh"

co = np.array([v.co[:] for v in me.vertices], dtype=np.float32)
nrm = np.array([v.normal[:] for v in me.vertices], dtype=np.float32)
# vertex -> UV (first loop) so we can sample textures (e.g. find the cyan port)
uv = np.zeros((len(me.vertices), 2), dtype=np.float32)
uvl = me.uv_layers.active.data
for l in me.loops:
    uv[l.vertex_index] = uvl[l.index].uv[:]
edges = np.array([e.vertices[:] for e in me.edges], dtype=np.int32)
# Base colour under each vertex (skin vs clothing, the painted port, ...).
col = np.zeros((len(me.vertices), 3), dtype=np.float32)
img = next((n.image for n in mesh.active_material.node_tree.nodes
            if n.type == 'TEX_IMAGE' and n.image and 'basecolor' in n.image.name.lower()), None) if mesh.active_material else None
if img is not None:
    W, H = img.size
    px = np.empty(W * H * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(H, W, 4)[..., :3]
    col = px[np.clip((uv[:, 1] * (H - 1)).astype(int), 0, H - 1), np.clip((uv[:, 0] * (W - 1)).astype(int), 0, W - 1)]
np.savez(out_npz, co=co, nrm=nrm, uv=uv, edges=edges, col=col)
bpy.ops.wm.save_as_mainfile(filepath=out_blend)
print("PREP_OK verts", len(me.vertices), "faces", len(me.polygons),
      "quads", sum(1 for p in me.polygons if p.loop_total == 4))
