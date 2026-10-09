import bpy, sys, bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree
args = sys.argv[sys.argv.index("--") + 1:]
qpath, tpath = args

def load(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.data.objects if o not in before]
    mesh = [o for o in objs if o.type == 'MESH'][0]
    # bake transforms, normalise to 1.65m, feet at 0
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True); bpy.context.view_layer.objects.active = mesh
    mw = mesh.matrix_world.copy(); mesh.parent = None; mesh.matrix_world = mw
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    zs = [v.co.z for v in mesh.data.vertices]
    s = 1.65 / (max(zs) - min(zs)); mnz = min(zs)
    for v in mesh.data.vertices:
        v.co = Vector((v.co.x * s, v.co.y * s, (v.co.z - mnz) * s))
    return mesh

bpy.ops.wm.read_factory_settings(use_empty=True)
q = load(qpath); t = load(tpath)

for name, o in (("quads", q), ("triangles", t)):
    bm = bmesh.new(); bm.from_mesh(o.data)
    n0 = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.00005)
    nonman = sum(1 for e in bm.edges if not e.is_manifold)
    boundary = sum(1 for e in bm.edges if e.is_boundary)
    # islands
    seen = set(); islands = 0; sizes = []
    for v in bm.verts:
        if v.index in seen: continue
        islands += 1; stack = [v]; c = 0
        while stack:
            x = stack.pop()
            if x.index in seen: continue
            seen.add(x.index); c += 1
            stack.extend(e.other_vert(x) for e in x.link_edges if e.other_vert(x).index not in seen)
        sizes.append(c)
    sizes.sort(reverse=True)
    # trial tris->quads
    bm2 = bm.copy()
    bmesh.ops.join_triangles(bm2, faces=bm2.faces, angle_face_threshold=0.7, angle_shape_threshold=0.7, cmp_seam=False, cmp_sharp=False, cmp_uvs=True)
    quads = sum(1 for f in bm2.faces if len(f.verts) == 4); tris = sum(1 for f in bm2.faces if len(f.verts) == 3)
    print(f"{name}: verts {n0}->{len(bm.verts)} nonManifold={nonman} boundary={boundary} islands={islands} largest={sizes[:5]} smallIslands(<50v)={sum(1 for s in sizes if s < 50)}")
    print(f"   tris->quads: quads={quads} tris={tris}")
    bm.free(); bm2.free()

# Head alignment: distance from quad-model head verts to the triangle model surface.
tb = bmesh.new(); tb.from_mesh(t.data); tree = BVHTree.FromBMesh(tb)
for label, zlo, zhi in (("face/head", 1.40, 1.60), ("torso", 1.0, 1.3), ("hands", 0.7, 0.9)):
    ds = []
    for v in q.data.vertices:
        if zlo < v.co.z < zhi:
            loc, n, i, d = tree.find_nearest(v.co)
            if d is not None: ds.append(d)
    ds.sort()
    print(f"align {label}: n={len(ds)} median={ds[len(ds)//2]*1000:.1f}mm p90={ds[int(len(ds)*0.9)]*1000:.1f}mm")
# Face-front only (y<-0.07)
ds = []
for v in q.data.vertices:
    if 1.42 < v.co.z < 1.56 and v.co.y < -0.07 and abs(v.co.x) < 0.07:
        loc, n, i, d = tree.find_nearest(v.co); ds.append(d)
ds.sort(); print(f"align face-front: n={len(ds)} median={ds[len(ds)//2]*1000:.1f}mm p90={ds[int(len(ds)*0.9)]*1000:.1f}mm")
