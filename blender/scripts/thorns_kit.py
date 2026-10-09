"""Thorn vines, after the films: thin dark barbed stems wandering over the ground, arching up and
tangling, set with thorns and rust-red knots (the films' foregrounds and the lacy shadows over
the cracked mud). Placed and instanced by game/src/world/thorns.ts.

Pieces (each its own object, standing on z = 0):
- creeper_a, creeper_b: low mats of stems crossing the ground, ~4 m across, arching a little
- arch_a, arch_b: brambles arching up out of the ground and back down, ~2.5 m long, ~1.2 m high
- tangle_a, tangle_b: upright thorny tangles of spiralling stems, 1.6–2.4 m tall
Vertex colours match the grove kit: R = baked AO, G = mineral crust, B = rust.

Usage: Blender -b --factory-startup -P thorns_kit.py -- out.glb
"""
import sys, math, random
import bpy, bmesh
from mathutils import Vector, Matrix, noise

OUT = sys.argv[sys.argv.index("--") + 1:][0]
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob)


class Stems:
    def __init__(self, name):
        self.cu = bpy.data.curves.new(name, 'CURVE')
        self.cu.dimensions = '3D'; self.cu.bevel_depth = 1.0; self.cu.bevel_resolution = 1
        self.cu.use_fill_caps = True; self.cu.resolution_u = 3
        self.name = name
        self.thorns = []      # (point, direction, size)
        self.knots = []       # (point, size)

    def add(self, pts, radii):
        sp = self.cu.splines.new('NURBS')
        sp.points.add(len(pts) - 1)
        for p, x, r in zip(sp.points, pts, radii):
            p.co = (x.x, x.y, x.z, 1.0); p.radius = r
        sp.order_u = min(4, len(pts)); sp.use_endpoint_u = True

    def mesh(self):
        ob = bpy.data.objects.new(self.name, self.cu)
        bpy.context.collection.objects.link(ob)
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.convert(target='MESH')
        return bpy.context.object


def stem(st, r, start, heading, length, r0, lift, arch=0.0, depth=2, spiral=0.0):
    """A wandering stem: a random walk with a little lift, maybe arching; thorns along it,
    knots at bends, side stems off it."""
    pts, rad = [start.copy()], [r0]
    p, d = start.copy(), heading.normalized()
    n = max(4, int(length / 0.22))
    for s in range(1, n + 1):
        u = s / n
        d = (d + Vector((r.uniform(-0.45, 0.45), r.uniform(-0.45, 0.45), r.uniform(-0.2, 0.2) + lift))).normalized()
        if spiral:
            d = (d + Vector((math.cos(u * spiral), math.sin(u * spiral), 0.9))).normalized()
        step = d * (length / n)
        p = p + step
        if arch:
            p.z = max(0.02, arch * math.sin(u * math.pi) + 0.03 * noise.noise(p * 3))
        elif not spiral:
            p.z = max(0.015, p.z)
        pts.append(p.copy())
        # Knobbly: the stem swells and pinches along its length.
        rad.append(max(0.006, r0 * (1 - 0.6 * u) * (0.85 + 0.3 * abs(noise.noise(p * 4)))))
    st.add(pts, rad)
    # Thorns every few centimetres, pointing out and along; knots here and there.
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]
        ax = (b - a).normalized()
        seg = (b - a).length
        k = 0.0
        while k < seg:
            q = a + ax * k
            out = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-0.3, 1)))
            out = (out - ax * out.dot(ax)).normalized()
            rr = rad[i]
            st.thorns.append((q + out * rr * 0.8, (out + ax * 0.5).normalized(), 0.018 + rr * 1.3 + r.uniform(0, 0.012)))
            k += r.uniform(0.07, 0.13)
        if r.random() < 0.3:
            st.knots.append((a, rad[i] * r.uniform(1.4, 2.2)))
    # Side stems.
    if depth > 0:
        for _ in range(r.randint(1, 3)):
            i = r.randint(1, len(pts) - 2)
            side = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-0.1, 0.5 if not arch else 0.2)))
            stem(st, r, pts[i], side, length * r.uniform(0.3, 0.55), rad[i] * 0.8, lift * 0.5,
                 arch=(arch * 0.5 if arch else 0.0), depth=depth - 1, spiral=spiral * 0.7)
    return pts


def finish(st, name, budget):
    ob = st.mesh()
    ob.name = ob.data.name = name
    bm = bmesh.new(); bm.from_mesh(ob.data)
    thorn_v, knot_v = set(), set()
    for p, d, size in st.thorns:
        g = bmesh.ops.create_cone(bm, cap_ends=False, segments=4, radius1=size * 0.16, radius2=0.0, depth=size)
        rot = Vector((0, 0, 1)).rotation_difference(d).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation(p + d * size * 0.45) @ rot, verts=g["verts"])
        thorn_v.update(g["verts"])
    for p, size in st.knots:
        g = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size)
        for v in g["verts"]:
            v.co = p + Vector((v.co.x * 1.4, v.co.y, v.co.z * 0.9))
        knot_v.update(g["verts"])
    bm.verts.index_update()
    tv = {v.index for v in thorn_v}; kv = {v.index for v in knot_v}
    bm.to_mesh(ob.data); bm.free()
    me = ob.data
    for p in me.polygons: p.use_smooth = True
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    print(name, "tris", tris)
    # Masks: dark stems (little crust), thorn tips and knots rust-red.
    col = me.color_attributes.new("Col", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = col
    for v in me.vertices:
        pp = v.co
        crust = max(0.0, min(0.25, 0.03 + 0.15 * noise.noise(pp * 2.0)))   # near-black stems
        rust = 0.95 if v.index in kv else (0.35 + 0.4 * max(0.0, noise.noise(pp * 9)) if v.index in tv else max(0.0, noise.noise(pp * 4 + Vector((5, 5, 5))) - 0.35))
        col.data[v.index].color = (1.0, crust, min(1.0, rust), 1.0)
    return ob


pieces = []
for name, seed in (("creeper_a", 1), ("creeper_b", 2)):
    r = random.Random(seed); st = Stems(name)
    for k in range(5):
        a = r.uniform(0, math.tau)
        start = Vector((math.cos(a) * r.uniform(0, 1.2), math.sin(a) * r.uniform(0, 1.2), 0.02))
        stem(st, r, start, Vector((math.cos(a + 1.6), math.sin(a + 1.6), 0)), r.uniform(2.2, 3.6), r.uniform(0.024, 0.036),
             0.0, arch=r.uniform(0.08, 0.35), depth=2)
    pieces.append(finish(st, name, 0))
for name, seed in (("arch_a", 3), ("arch_b", 4)):
    r = random.Random(seed); st = Stems(name)
    for k in range(4):
        start = Vector((r.uniform(-0.3, 0.3), r.uniform(-0.4, 0.4), 0.02))
        stem(st, r, start, Vector((1, r.uniform(-0.3, 0.3), 0)), r.uniform(2.2, 2.9), r.uniform(0.03, 0.042),
             0.0, arch=r.uniform(0.8, 1.3), depth=2)
    pieces.append(finish(st, name, 0))
for name, seed in (("tangle_a", 5), ("tangle_b", 6)):
    r = random.Random(seed); st = Stems(name)
    for k in range(5):
        start = Vector((r.uniform(-0.25, 0.25), r.uniform(-0.25, 0.25), 0.0))
        stem(st, r, start, Vector((r.uniform(-0.3, 0.3), r.uniform(-0.3, 0.3), 1)), r.uniform(1.6, 2.4), r.uniform(0.032, 0.048),
             0.35, depth=2, spiral=r.uniform(5, 9))
    pieces.append(finish(st, name, 0))

# AO into R.
bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
ground = bpy.context.object
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 32
scene.world = scene.world or bpy.data.worlds.new("w")
scene.world.light_settings.distance = 0.4
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print("GPU unavailable", e)
for i, ob in enumerate(pieces):
    ob.location.x = i * 8
for ob in pieces:
    me = ob.data
    ao = me.color_attributes.new("AO", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = ao
    me.materials.clear(); me.materials.append(bpy.data.materials.new(ob.name + "_m"))
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type='AO', target='VERTEX_COLORS')
    col = me.color_attributes["Col"]
    for i in range(len(me.vertices)):
        c = col.data[i].color; a = ao.data[i].color[0]
        col.data[i].color = (a, c[1], c[2], 1.0)
    me.color_attributes.remove(ao)
    me.color_attributes.active_color = me.color_attributes["Col"]
for ob in pieces: ob.location.x = 0
bpy.data.objects.remove(ground)

bpy.ops.object.select_all(action='DESELECT')
for o in pieces: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='NONE',
                          export_normals=True, export_texcoords=False)
print("THORNS_OK", OUT)
