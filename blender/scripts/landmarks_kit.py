"""Landmarks for the places off Part I's route (found by wandering; no narration).

- fallen_giant: a huge dead tree of the metallic grove lying along +X, its root plate torn
  up at -X with a clod of pale earth, broken limbs reaching up, thorns. ~15 m long.
- conduit_ruins: remains of the refuge's architecture sunk into a rise: conduit bundles that
  arch out of the ground and dive back in, a snapped rib, a tilted bone-paving slab, and
  loose conduit lengths. The same language as the distant arcade (arches_kit.py).
Vertex colours match the grove kit: R = baked AO, G = mineral crust, B = rust.

Usage: Blender -b --factory-startup -P landmarks_kit.py -- out.glb
"""
import sys, math, random
import bpy, bmesh
from mathutils import Vector, Matrix, noise

OUT = sys.argv[sys.argv.index("--") + 1:][0]
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob)


class Curves:
    def __init__(self, name, res=3):
        self.cu = bpy.data.curves.new(name, 'CURVE')
        self.cu.dimensions = '3D'; self.cu.bevel_depth = 1.0; self.cu.bevel_resolution = res
        self.cu.use_fill_caps = True; self.cu.resolution_u = 4
        self.name = name

    def add(self, pts, radii, order=4):
        sp = self.cu.splines.new('NURBS')
        sp.points.add(len(pts) - 1)
        for p, x, r in zip(sp.points, pts, radii):
            p.co = (x.x, x.y, x.z, 1.0); p.radius = r
        sp.order_u = min(order, len(pts)); sp.use_endpoint_u = True

    def cone(self, base, tip, r):
        sp = self.cu.splines.new('POLY'); sp.points.add(1)
        sp.points[0].co = (*base, 1); sp.points[0].radius = r
        sp.points[1].co = (*tip, 1); sp.points[1].radius = 0.002

    def mesh(self):
        ob = bpy.data.objects.new(self.name, self.cu)
        bpy.context.collection.objects.link(ob)
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.convert(target='MESH')
        return bpy.context.object


def displace(ob, strength, size, seed):
    tex = bpy.data.textures.new(ob.name + "_bark", 'CLOUDS')
    tex.noise_scale = size; tex.noise_depth = 2; tex.noise_basis = 'VORONOI_F2'
    m = ob.modifiers.new("bark", 'DISPLACE'); m.texture = tex; m.strength = strength; m.mid_level = 0.5
    m.texture_coords = 'GLOBAL'
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="bark")


def finish(ob, budget):
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris > budget:
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        dec = ob.modifiers.new("dec", 'DECIMATE'); dec.ratio = budget / tris
        bpy.ops.object.modifier_apply(modifier="dec")
    for p in ob.data.polygons: p.use_smooth = True
    print(ob.name, "tris", sum(len(p.vertices) - 2 for p in ob.data.polygons))


def masks(ob, crust_bias=0.0, rust_amt=1.0, crust_mask=None):
    me = ob.data
    col = me.color_attributes.new("Col", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = col
    for v in me.vertices:
        p = v.co
        up = max(0.0, v.normal.z)
        crust = max(0.0, min(1.0, crust_bias + (noise.noise(p * 0.9) + 0.05) * 1.6 + up * 0.35))
        if crust_mask: crust = max(crust, crust_mask(p))
        rust = max(0.0, min(1.0, (noise.noise(p * 2.7 + Vector((9, 9, 9))) - 0.3) * 2.0)) * rust_amt
        col.data[v.index].color = (1.0, crust, rust, 1.0)


# ── fallen giant ──────────────────────────────────────────────────────────
r = random.Random(11)
giant = Curves("fallen_giant", res=4)
L = 15.0
trunk = []
for k in range(9):
    u = k / 8
    x = -L / 2 + u * L
    z = 1.5 * (1 - u) ** 1.4 + 0.35 + 0.15 * math.sin(u * 5)
    y = 0.4 * math.sin(u * 2.3)
    trunk.append(Vector((x, y, z)))
rad = [0.85 - 0.55 * (k / 8) ** 0.8 for k in range(9)]
giant.add(trunk, rad)
# Root plate: roots radiating in the upturned plane at the base (the YZ plane at -L/2).
base = trunk[0]
for i in range(30):
    a = i / 30 * 2 * math.pi + r.uniform(-0.1, 0.1)
    reach = r.uniform(2.2, 3.6)
    d = Vector((r.uniform(-0.5, -0.1), math.cos(a), math.sin(a) * 0.9 + 0.1)).normalized()
    pts = [base + Vector((0.3, 0, 0))]
    p = pts[0].copy()
    for s in range(4):
        d = (d + Vector((r.uniform(-0.35, 0.15), r.uniform(-0.4, 0.4), r.uniform(-0.45, 0.2)))).normalized()
        p = p + d * reach / 4
        p.z = max(p.z, 0.05)
        pts.append(p.copy())
    giant.add(pts, [0.42, 0.26, 0.15, 0.07, 0.015])
    if r.random() < 0.5:        # a side root
        s0 = pts[2]; dd = (d + Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-0.5, 0.3)))).normalized()
        giant.add([s0, s0 + dd * 0.6, s0 + dd * 1.2 + Vector((0, 0, -0.2))], [0.08, 0.05, 0.01])
# Broken limbs: some up into the air, some snapped short.
for i in range(9):
    u = r.uniform(0.35, 0.95)
    k = int(u * 8); t = u * 8 - k
    k = min(k, 7)
    p0 = trunk[k].lerp(trunk[k + 1], t)
    up = r.random() < 0.6
    d = Vector((r.uniform(0.2, 0.8), r.uniform(-1, 1), r.uniform(0.6, 1.4) if up else r.uniform(-0.2, 0.4))).normalized()
    ln = r.uniform(1.5, 4.5) * (1.0 if up else 0.5)
    pts, rr = [p0], [0.25 * (1 - u) + 0.08]
    p = p0.copy()
    for s in range(6):
        d = (d + Vector((r.uniform(-0.5, 0.5), r.uniform(-0.5, 0.5), r.uniform(-0.25, 0.3)))).normalized()
        p = p + d * ln / 6
        p.z = max(p.z, 0.08)
        pts.append(p.copy()); rr.append(rr[0] * (1 - (s + 1) / 6.8))
    giant.add(pts, rr)
    for _ in range(2):          # forks
        s0 = r.randint(2, 4)
        dd = (d + Vector((r.uniform(-1.2, 1.2), r.uniform(-1.2, 1.2), r.uniform(-0.2, 0.9)))).normalized()
        q0 = pts[s0]; fp, fr = [q0], [rr[s0] * 0.7]
        for s in range(3):
            dd = (dd + Vector((r.uniform(-0.4, 0.4), r.uniform(-0.4, 0.4), r.uniform(-0.2, 0.3)))).normalized()
            fp.append(fp[-1] + dd * ln * 0.12); fr.append(fr[0] * (1 - (s + 1) / 3.4))
        giant.add(fp, fr)
    pts = pts[:5]; rr = rr[:5]
    for s in range(1, 4):          # thorns along the limb
        for _ in range(2):
            b = pts[s].lerp(pts[s + 1], r.random())
            out = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-0.3, 1))).normalized()
            giant.cone(b, b + out * rr[s] * 4, rr[s] * 0.5)
g_ob = giant.mesh()
displace(g_ob, 0.07, 0.22, 3)   # bark relief, not lumps
# The clod of earth held in the roots.
bm = bmesh.new()
bmesh.ops.create_icosphere(bm, subdivisions=4, radius=1.0)
for v in bm.verts:
    p = v.co.copy()
    p = Vector((p.x * 0.55, p.y * 1.5, p.z * 1.2))
    p *= 1 + 0.25 * noise.noise(p * 2.0 + Vector((4, 1, 7)))
    v.co = p + base + Vector((0.2, 0, -0.2))
clod_scale = 1.35
for v in bm.verts: v.co = base + (v.co - base) * clod_scale
clod_me = bpy.data.meshes.new("clod"); bm.to_mesh(clod_me); bm.free()
clod = bpy.data.objects.new("clod", clod_me); bpy.context.collection.objects.link(clod)
bpy.ops.object.select_all(action='DESELECT'); g_ob.select_set(True); clod.select_set(True)
bpy.context.view_layer.objects.active = g_ob
bpy.ops.object.join()
g_ob = bpy.context.object; g_ob.name = "fallen_giant"
print("giant raw tris", sum(len(p.vertices) - 2 for p in g_ob.data.polygons))
finish(g_ob, 36000)
bx = base.copy()
masks(g_ob, crust_mask=lambda p: max(0.0, 1.0 - ((p - bx) * Vector((2.2, 0.6, 0.8))).length / 1.2))

# ── conduit ruins ─────────────────────────────────────────────────────────
r = random.Random(23)
ru = Curves("conduit_ruins", res=2)
ru.cu.resolution_u = 3


def bundle(p0, p1, rise, strands=4, radius=0.13, snap=None):
    """An arching bundle of conduits from p0 to p1 (both at/below ground)."""
    for k in range(strands):
        a = k * 2 * math.pi / strands
        pts = []
        n = 10
        end = n if snap is None else int(n * snap)
        for s in range(end + 1):
            u = s / n
            c = p0.lerp(p1, u)
            c.z += rise * math.sin(u * math.pi) ** 0.85
            tw = a + u * 3.0
            # Strands wound round each other with space between (they read apart, not as a band).
            c += Vector((0, math.cos(tw) * 0.3, math.sin(tw) * 0.26))
            pts.append(c)
        if snap is not None:
            pts.append(pts[-1] + Vector((0.2, 0.1, -0.5)))
        rk = radius * (0.8 + 0.4 * ((k * 7) % 5) / 4)
        ru.add(pts, [rk * (1 - 0.2 * i / len(pts)) for i in range(len(pts))])


bundle(Vector((-2.8, -0.5, -0.6)), Vector((2.6, 0.4, -0.6)), 3.6)           # whole arch emerging
bundle(Vector((1.8, 2.8, -0.5)), Vector((5.0, 4.4, -0.5)), 2.6, snap=0.55)   # snapped rib
bundle(Vector((-4.5, 2.5, -0.6)), Vector((-2.0, 4.2, -0.6)), 1.2, strands=3) # low hoop, mostly buried
# Loose conduit lengths lying on the rise.
for i in range(6):
    p = Vector((r.uniform(-5, 5), r.uniform(-4, 4), 0.05))
    d = Vector((r.uniform(-1, 1), r.uniform(-1, 1), 0)).normalized()
    ln = r.uniform(1.2, 3.0)
    pts = [p, p + d * ln * 0.5 + Vector((0, 0, 0.12)), p + d * ln + Vector((r.uniform(-0.3, 0.3), 0, 0))]
    ru.add(pts, [0.08, 0.08, 0.07])
# Hanging filaments off the arch top.
for i in range(5):
    top = Vector((r.uniform(-1.2, 1.2), r.uniform(-0.3, 0.3), 2.8))
    ru.add([top, top + Vector((0.1, 0, -0.8)), top + Vector((r.uniform(-0.2, 0.2), 0.1, -r.uniform(1.4, 2.4)))], [0.04, 0.03, 0.012])
# A burst length of casing: the outer shell of a big conduit split open, cables spilling out.
for i, (p0, d, ln) in enumerate([(Vector((3.0, -2.6, 0.15)), Vector((1, -0.4, 0.05)), 2.6)]):
    d = d.normalized()
    for k in range(9):
        a = k / 9 * math.pi * 2
        start = p0 + Vector((0, math.cos(a) * 0.12, math.sin(a) * 0.1 + 0.1))
        pts = [start, start + d * ln * 0.4 + Vector((0, math.cos(a + 1) * 0.25, 0.05)),
               start + d * ln * 0.8 + Vector((r.uniform(-0.6, 0.6), r.uniform(-0.8, 0.8), -0.1)),
               start + d * ln * (1.0 + r.uniform(0, 0.4)) + Vector((r.uniform(-0.8, 0.8), r.uniform(-1, 1), -0.12))]
        ru.add(pts, [0.035, 0.032, 0.028, 0.015])
r_ob = ru.mesh()
displace(r_ob, 0.025, 0.2, 5)

# The shell itself: a half pipe, torn along its edges.
bm = bmesh.new()
g = bmesh.ops.create_cone(bm, cap_ends=False, segments=18, radius1=0.42, radius2=0.4, depth=2.4)
for v in g["verts"]:
    p = v.co
    ang = math.atan2(p.y, p.x)
    if ang < -0.4:                      # open underneath / torn away
        p.x *= 0.2; p.y = min(p.y, 0.0) * 0.15
    p += p.normalized() * 0.02 * noise.noise(p * 5) if p.length > 0 else Vector()
bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=0.035)
rot = Vector((0, 0, 1)).rotation_difference(Vector((1, -0.4, 0.05)).normalized()).to_matrix().to_4x4()
bmesh.ops.transform(bm, matrix=Matrix.Translation(Vector((2.6, -2.45, 0.28))) @ rot, verts=bm.verts[:])
shell_me = bpy.data.meshes.new("shell"); bm.to_mesh(shell_me); bm.free()
shell = bpy.data.objects.new("shell", shell_me); bpy.context.collection.objects.link(shell)


def stone_block(bm, c, size, rr, tilt=None):
    before = set(bm.verts)
    g = bmesh.ops.create_cube(bm, size=1.0)
    vs = g["verts"]
    for v in vs:
        v.co = Vector((v.co.x * size.x * 2, v.co.y * size.y * 2, v.co.z * size.z * 2))
    edges = list({e for v in vs for e in v.link_edges})
    bmesh.ops.bevel(bm, geom=vs + edges, offset=min(0.03, size.z * 0.12), segments=1, profile=0.5, affect='EDGES')
    allv = [v for v in bm.verts if v not in before]
    for v in allv:
        v.co += Vector((rr.uniform(-1, 1), rr.uniform(-1, 1), rr.uniform(-1, 1))) * 0.012
    M = Matrix.Translation(c) @ (tilt if tilt is not None else Matrix.Identity(4))
    bmesh.ops.transform(bm, matrix=M, verts=allv)


# Stone plinths where the whole arch meets the ground, and tumbled blocks round the rise.
bm = bmesh.new()
rs = random.Random(5)
for foot in (Vector((-2.8, -0.5, -0.3)), Vector((2.6, 0.4, -0.3))):
    z = foot.z
    for course in range(3):
        h = rs.uniform(0.3, 0.38)
        n = 3 - course // 2
        for k in range(n):
            x = foot.x + (k - (n - 1) / 2) * 0.62 + (0.2 if course % 2 else 0)
            if course == 2 and rs.random() < 0.4:
                continue
            stone_block(bm, Vector((x, foot.y + rs.uniform(-0.05, 0.05), z + h / 2)),
                        Vector((0.29, 0.38, h / 2 - 0.015)), rs,
                        Matrix.Rotation(rs.uniform(-0.05, 0.05), 4, 'Z'))
        z += h
for i in range(9):
    c = Vector((rs.uniform(-5, 5), rs.uniform(-4, 4), rs.uniform(-0.1, 0.05)))
    tilt = Matrix.Rotation(rs.uniform(-0.6, 0.6), 4, 'X') @ Matrix.Rotation(rs.uniform(0, 6.28), 4, 'Z')
    stone_block(bm, c, Vector((rs.uniform(0.2, 0.35), rs.uniform(0.18, 0.3), rs.uniform(0.12, 0.2))), rs, tilt)
# Loose paving tiles, cracked and askew, round the tilted slab.
for i in range(7):
    c = Vector((-1.5 + rs.uniform(-2.4, 2.4), -3.2 + rs.uniform(-1.8, 1.8), rs.uniform(0.02, 0.08)))
    tilt = Matrix.Rotation(rs.uniform(-0.15, 0.15), 4, 'X') @ Matrix.Rotation(rs.uniform(-0.15, 0.15), 4, 'Y') @ Matrix.Rotation(rs.uniform(0, 6.28), 4, 'Z')
    stone_block(bm, c, Vector((rs.uniform(0.35, 0.55), rs.uniform(0.3, 0.5), 0.06)), rs, tilt)
stones_me = bpy.data.meshes.new("stones"); bm.to_mesh(stones_me); bm.free()
stones = bpy.data.objects.new("stones", stones_me); bpy.context.collection.objects.link(stones)
# Tilted slab of bone paving, half buried.
bm = bmesh.new()
geom = bmesh.ops.create_cube(bm, size=1.0)
for v in geom["verts"]:
    v.co = Vector((v.co.x * 3.0, v.co.y * 2.2, v.co.z * 0.35))
bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=5, use_grid_fill=True)
for v in bm.verts:
    v.co += Vector((0, 0, 0.05 * noise.noise(v.co * 3)))
    ex = max(0.0, abs(v.co.x) - 1.1)
    v.co.y *= 1 + 0.15 * noise.noise(v.co * 1.3) * min(1.0, ex)
rot = Vector((0, 0, 1)).rotation_difference(Vector((0.42, -0.1, 0.9)).normalized()).to_matrix().to_4x4()
bmesh.ops.transform(bm, matrix=rot, verts=bm.verts[:])
bmesh.ops.translate(bm, verts=bm.verts[:], vec=Vector((-1.5, -3.2, 0.25)))
slab_me = bpy.data.meshes.new("slab"); bm.to_mesh(slab_me); bm.free()
slab = bpy.data.objects.new("slab", slab_me); bpy.context.collection.objects.link(slab)
bpy.ops.object.select_all(action='DESELECT'); r_ob.select_set(True); slab.select_set(True)
bpy.data.objects.remove(shell)   # the torn casing read as a lump; the spilled cables stay
bpy.context.view_layer.objects.active = r_ob
bpy.ops.object.join()
r_ob = bpy.context.object; r_ob.name = "conduit_ruins"
print("ruins raw tris", sum(len(p.vertices) - 2 for p in r_ob.data.polygons))
finish(r_ob, 30000)
# The stones join after smoothing so they keep their facets.
for p in stones.data.polygons: p.use_smooth = False
bpy.ops.object.select_all(action='DESELECT'); r_ob.select_set(True); stones.select_set(True)
bpy.context.view_layer.objects.active = r_ob
bpy.ops.object.join()
r_ob = bpy.context.object; r_ob.name = "conduit_ruins"
masks(r_ob, crust_mask=lambda p: 1.0 if (p - Vector((-1.5, -3.2, 0.25))).length < 2.6 and abs(p.z - 0.25 - 0.4 * (p.x + 1.5)) < 0.4 else 0.0)

# AO bake into R.
objs = [g_ob, r_ob]
g_ob.location.x = -12; r_ob.location.x = 12
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
ground = bpy.context.object
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 48
scene.world = scene.world or bpy.data.worlds.new("w")
scene.world.light_settings.distance = 1.5
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print("GPU unavailable", e)
for ob in objs:
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
    ob.location.x = 0
bpy.data.objects.remove(ground)

bpy.ops.object.select_all(action='DESELECT')
for ob in objs: ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='NONE',
                          export_normals=True, export_texcoords=False)
print("LANDMARKS_OK", OUT)
