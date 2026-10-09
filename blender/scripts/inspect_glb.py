# Usage: Blender -b -P inspect_glb.py -- <file.glb>
import bpy, sys, bmesh
from mathutils import Vector

path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)

print("\n=== ", path)
for o in bpy.context.scene.objects:
    line = f"obj {o.name!r} type={o.type} parent={o.parent.name if o.parent else None} loc={tuple(round(v,3) for v in o.location)} rot={tuple(round(v,3) for v in o.rotation_euler)} scale={tuple(round(v,3) for v in o.scale)}"
    print(line)
    if o.type == 'MESH':
        me = o.data
        sizes = {}
        for p in me.polygons:
            sizes[p.loop_total] = sizes.get(p.loop_total, 0) + 1
        tris = sum((n - 2) * c for n, c in sizes.items())
        ws = [o.matrix_world @ Vector(c) for c in o.bound_box]
        mn = Vector((min(v.x for v in ws), min(v.y for v in ws), min(v.z for v in ws)))
        mx = Vector((max(v.x for v in ws), max(v.y for v in ws), max(v.z for v in ws)))
        print(f"  verts={len(me.vertices)} faces={len(me.polygons)} tris={tris} faceSizes={dict(sorted(sizes.items()))}")
        print(f"  bbox min={tuple(round(v,3) for v in mn)} max={tuple(round(v,3) for v in mx)} size={tuple(round(v,3) for v in (mx-mn))}")
        print(f"  uvLayers={[u.name for u in me.uv_layers]} colorAttrs={[a.name for a in me.color_attributes]} materials={[m.name if m else None for m in me.materials]}")
        bm = bmesh.new(); bm.from_mesh(me)
        islands = 0
        seen = set()
        for v in bm.verts:
            if v.index in seen: continue
            islands += 1
            stack = [v]
            while stack:
                x = stack.pop()
                if x.index in seen: continue
                seen.add(x.index)
                for e in x.link_edges:
                    y = e.other_vert(x)
                    if y.index not in seen: stack.append(y)
        nonman = sum(1 for e in bm.edges if not e.is_manifold)
        print(f"  connectedPieces={islands} nonManifoldEdges={nonman}")
        bm.free()
for m in bpy.data.materials:
    if m.use_nodes:
        texs = [(n.label or n.name, n.image.name if n.image else None) for n in m.node_tree.nodes if n.type == 'TEX_IMAGE']
        print(f"mat {m.name!r}: textures={texs}")
for im in bpy.data.images:
    print(f"img {im.name!r} size={tuple(im.size)} colorspace={im.colorspace_settings.name}")
