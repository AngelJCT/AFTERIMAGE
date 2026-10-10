"""The refuge's arcade, seen far off at the end of Part I (Part II takes place inside it).

From the Part II production guide: an open-roof biomechanical refuge of branching dark conduit
arches and bone-coloured mineral paving; its ruins belong to the metallic grove; the safe
elevated route continues toward screen-left.

Built along +X (across the line of sight), origin at the middle pier's foot, Z up:
- piers: bundles of conduits rooted in the ground, twisting up, splitting left and right
  into two-centred pointed arches that meet at the apex
- side branches off the ribs (the grove grown into the architecture)
- the elevated deck (bone paving) on the apexes, one span broken with a slab hanging down
- hanging conduits under the deck
Vertex colours match the grove kit: R = baked AO, G = mineral crust, B = rust.

Usage: Blender -b --factory-startup -P arches_kit.py -- out.glb [triBudget]
"""
import sys, math, random
import bpy, bmesh
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]
BUDGET = int(argv[1]) if len(argv) > 1 else 48000

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob)

N, SPAN, H = 9, 6.2, 9.5          # spans, pier spacing, apex height (matches the old procedural set)
W = SPAN / 2
R = 1.3 * W                        # two-centred arch radius (pointed)
TH_APEX = math.acos((W - R) / R)
RISE = R * math.sin(TH_APEX)
Z_SPRING = H - RISE
DECK_Z = H + 0.55
BROKEN_SPAN = 6                    # this span's ribs and deck are ruined
rng = random.Random(7)


def pier_x(i):
    return (i - N / 2) * SPAN


class Curves:
    """Many tapered tubes in one curve datablock (radius per point)."""

    def __init__(self, name, res=2):
        self.cu = bpy.data.curves.new(name, 'CURVE')
        self.cu.dimensions = '3D'
        self.cu.bevel_depth = 1.0
        self.cu.bevel_resolution = res
        self.cu.use_fill_caps = True
        self.cu.resolution_u = 3
        self.name = name

    def add(self, pts, radii):
        sp = self.cu.splines.new('NURBS')
        sp.points.add(len(pts) - 1)
        for p, (x, r) in zip(sp.points, zip(pts, radii)):
            p.co = (x.x, x.y, x.z, 1.0)
            p.radius = r
        sp.order_u = min(4, len(pts))
        sp.use_endpoint_u = True

    def mesh(self):
        ob = bpy.data.objects.new(self.name, self.cu)
        bpy.context.collection.objects.link(ob)
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.convert(target='MESH')
        return bpy.context.object


conduits = Curves("arcade", res=2)


def arc_point(x0, side, th):
    """Point on the rib springing from the pier at x0 toward `side` (+1 / -1)."""
    return Vector((x0 + side * (R + R * math.cos(th)), 0.0, Z_SPRING + R * math.sin(th)))


def strand(i, k, side, broken=False):
    """One conduit: root -> twisting shaft -> spring -> pointed arch -> up into the deck."""
    x0 = pier_x(i)
    a = k * 2.1 + i * 0.7
    pts, rad = [], []
    root = Vector((x0 + math.cos(a) * 1.5, math.sin(a) * 1.5, -0.5))
    pts += [root, Vector((x0 + math.cos(a) * 0.9, math.sin(a) * 0.9, 0.1))]
    rad += [0.22, 0.2]
    # Shaft: strands wind around each other.
    for z in (1.2, 2.6, 4.0, Z_SPRING - 0.4):
        t = a + z * 0.45
        rr = 0.3 + 0.08 * math.sin(z * 1.3 + k)
        pts.append(Vector((x0 + math.cos(t) * rr + side * 0.05 * z / Z_SPRING, math.sin(t) * rr, z)))
        rad.append(0.17)
    # Arch: keep a small offset around the rib line so the bundle reads as several conduits.
    steps = 9
    end = TH_APEX if not broken else math.pi - (math.pi - TH_APEX) * rng.uniform(0.35, 0.6)
    for s in range(steps + 1):
        th = math.pi + (end - math.pi) * s / steps
        p = arc_point(x0, side, th)
        tw = a + s * 0.5
        p += Vector((0, math.cos(tw) * 0.24, math.sin(tw) * 0.2))
        pts.append(p)
        rad.append(0.16 - 0.05 * s / steps)
    if broken:
        # Snapped rib: a short ragged end that droops.
        last = pts[-1]
        pts.append(last + Vector((side * 0.4, 0.1, -0.6)))
        rad.append(0.04)
    else:
        top = pts[-1]
        pts.append(Vector((top.x, top.y * 0.5, DECK_Z - 0.1)))
        rad.append(0.1)
    conduits.add(pts, rad)
    return pts


def branch(start, direction, length, r0, depth):
    pts, rad = [start.copy()], [r0]
    d = direction.normalized()
    p = start.copy()
    n = 5
    for s in range(1, n + 1):
        d = (d + Vector((rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), rng.uniform(-0.15, 0.25)))).normalized()
        p = p + d * (length / n)
        pts.append(p.copy())
        rad.append(max(0.008, r0 * (1 - s / n) ** 1.2))
    conduits.add(pts, rad)
    if depth > 0:
        for _ in range(2):
            s = rng.randint(2, n - 1)
            nd = (d + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-0.2, 0.8)))).normalized()
            branch(pts[s], nd, length * 0.5, rad[s] * 0.8, depth - 1)


ribs = []
for i in range(N + 1):
    for k in range(6):
        side = 1 if k % 2 == 0 else -1
        j = i if side > 0 else i - 1          # span index this strand arches over
        broken = j < 0 or j >= N or j == BROKEN_SPAN
        pts = strand(i, k, side, broken)
        ribs.append(pts)

# Side branches sprouting off the ribs, mostly outward and up.
for pts in ribs[::2]:
    if rng.random() < 0.55:
        s = rng.randint(7, len(pts) - 3)
        base = pts[s]
        out = Vector((rng.uniform(-0.5, 0.5), rng.choice((-1, 1)) * rng.uniform(0.6, 1.0), rng.uniform(0.1, 0.9)))
        branch(base, out, rng.uniform(1.2, 3.0), 0.07, 1)

# Hanging conduits under the deck: droops and sagging loops.
for j in range(N):
    for _ in range(3):
        x = pier_x(j) + rng.uniform(0.6, SPAN - 0.6)
        y = rng.uniform(-0.9, 0.9)
        top = Vector((x, y, DECK_Z - 0.3))
        if rng.random() < 0.5:
            drop = rng.uniform(1.5, 4.0)
            sw = rng.uniform(-0.5, 0.5)
            pts = [top, top + Vector((0.1 + sw * 0.3, 0.05, -drop * 0.3)), top + Vector((sw, 0.15, -drop * 0.7)),
                   top + Vector((sw * 1.4 + 0.2, 0.1, -drop))]
        else:
            w = rng.uniform(1.2, 2.4); sag = rng.uniform(1.0, 2.2)
            pts = [top, top + Vector((w * 0.5, 0.1, -sag)), top + Vector((w, 0, 0))]
        conduits.add(pts, [0.06, 0.05, 0.045, 0.03][:len(pts)])

arcade = conduits.mesh()

# Small structural collars bind the grown conduits at the piers. The outer radius stays
# inside the existing 0.55 m blocker; the branching silhouette above remains open.
bm = bmesh.new(); bm.from_mesh(arcade.data)
for i in range(N + 1):
    for z in (1.2, Z_SPRING - 0.65):
        rings = []
        for radius, zz in ((0.44, z - 0.075), (0.44, z + 0.075), (0.34, z + 0.075), (0.34, z - 0.075)):
            rings.append([bm.verts.new((pier_x(i) + radius * math.cos(k * math.tau / 16),
                                       radius * math.sin(k * math.tau / 16), zz)) for k in range(16)])
        for a, b in zip(rings, rings[1:] + rings[:1]):
            for k in range(16): bm.faces.new((a[k], a[(k + 1) % 16], b[(k + 1) % 16], b[k]))
bm.to_mesh(arcade.data); bm.free(); arcade.data.update()

# Deck: bone paving along the apexes, continuing left past the arcade. Each piece is a base slab
# carrying worn pavers, and its own object, named by position along the arcade (deck_00 is the far
# left end) so the route can give way piece by piece (the search). The pavers' tops sit at the
# old slab top (DECK_Z + 0.21), where the game walks her.
from mathutils import Matrix
PAVE = 0.08                        # paver thickness
TOP = DECK_Z + 0.21
rd = random.Random(31)


def base_slab(bm, x0, x1, z_top, z_bot):
    geom = bmesh.ops.create_cube(bm, size=1.0)
    vs = geom["verts"]
    for v in vs:
        v.co.x = x0 + (v.co.x + 0.5) * (x1 - x0)
        v.co.y *= 2.6
        v.co.z = z_bot + (v.co.z + 0.5) * (z_top - z_bot)
    bmesh.ops.subdivide_edges(bm, edges=list({e for v in vs for e in v.link_edges}), cuts=5, use_grid_fill=True)
    new = [v for v in bm.verts]
    off = Vector((3.1, 7.7, 1.3))
    for v in new:
        p = v.co
        edge = max(0.0, abs(p.y) - 1.0)
        v.co.y += math.copysign(0.3 * noise.noise(p * 0.8 + off), p.y) * min(1.0, edge * 2)
        if p.z < z_top - 0.01:
            v.co.z += 0.1 * noise.noise(p * 0.5)       # a ragged underside


def paver(bm, x0, x1, y0, y1, broken):
    before = set(bm.verts)
    g = bmesh.ops.create_cube(bm, size=1.0)
    vs = g["verts"]
    for v in vs:
        v.co = Vector((x0 + (v.co.x + 0.5) * (x1 - x0), y0 + (v.co.y + 0.5) * (y1 - y0), TOP - PAVE + (v.co.z + 0.5) * PAVE))
    edges = list({e for v in vs for e in v.link_edges})
    bmesh.ops.bevel(bm, geom=vs + edges, offset=0.018, segments=1, profile=0.5, affect='EDGES')
    allv = [v for v in bm.verts if v not in before]
    c = Vector(((x0 + x1) / 2, (y0 + y1) / 2, TOP))
    # Worn: tops dished a little, a corner knocked off now and then, some set askew.
    tilt = Matrix.Rotation(rd.uniform(-0.03, 0.03), 4, 'X') @ Matrix.Rotation(rd.uniform(-0.03, 0.03), 4, 'Y') if rd.random() < 0.25 else Matrix.Identity(4)
    for v in allv:
        p = v.co
        if p.z > TOP - 0.01:
            p.z -= 0.012 * max(0.0, 1 - ((p.x - c.x) ** 2 + (p.y - c.y) ** 2) / 0.12)
        p.x += rd.uniform(-0.006, 0.006); p.y += rd.uniform(-0.006, 0.006)
        if rd.random() < 0.06 and p.z > TOP - 0.02:
            p.z -= 0.03
    bmesh.ops.transform(bm, matrix=Matrix.Translation(c) @ tilt @ Matrix.Translation(-c), verts=allv)


def pave(bm, x0, x1):
    """Pavers over a slab from x0 to x1: courses across the route, joints staggered."""
    x = x0 + 0.04
    row = 0
    while x < x1 - 0.2:
        w = min(rd.uniform(0.5, 0.72), x1 - 0.04 - x)
        y = -1.24 + (0.2 if row % 2 else 0.0)
        ys = [-1.24]
        while True:
            y += rd.uniform(0.45, 0.62)
            if y > 1.2: break
            ys.append(y)
        ys.append(1.24)
        for a, b in zip(ys[:-1], ys[1:]):
            if b - a < 0.15 or rd.random() < 0.04:        # missing: the slab shows through
                continue
            if rd.random() < 0.08:                      # cracked across
                m = (a + b) / 2 + rd.uniform(-0.06, 0.06)
                paver(bm, x, x + w - 0.018, a, m - 0.012, True)
                paver(bm, x, x + w - 0.018, m + 0.012, b - 0.018, True)
            else:
                paver(bm, x, x + w - 0.018, a, b - 0.018, False)
        x += w
        row += 1


def deck_piece(x0, x1, name):
    bm = bmesh.new()
    base_slab(bm, x0, x1, TOP - PAVE, DECK_Z - 0.21)
    pave(bm, x0, x1)
    # A recessed lower course gives the deck thickness and a shadow line. Segments break
    # at the same places as the playable slabs; no deck top or route boundary is moved.
    for side in (-1, 1):
        x = x0 + 0.04
        while x < x1 - 0.12:
            end = min(x1 - 0.04, x + 1.35)
            vs = bmesh.ops.create_cube(bm, size=1)["verts"]
            for v in vs:
                v.co = Vector((x + (v.co.x + 0.5) * (end - x),
                               side * 1.28 + v.co.y * 0.14, DECK_Z - 0.14 + v.co.z * 0.15))
            edges = list({e for v in vs for e in v.link_edges})
            bmesh.ops.bevel(bm, geom=edges, offset=0.016, segments=2, affect='EDGES')
            x = end + 0.035
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


decks = []
edges = [pier_x(0) - W - 8.0] + [pier_x(j) + W for j in range(N)] + [pier_x(N) + 3.0]
for j in range(len(edges) - 1):
    x0, x1 = edges[j], edges[j + 1]
    if j - 1 == BROKEN_SPAN:
        # Broken: two stubs, and a slab hanging down between them.
        decks.append(deck_piece(x0, x0 + 1.2, "deck_stub_a"))
        decks.append(deck_piece(x1 - 0.9, x1, "deck_stub_b"))
        bm = bmesh.new()
        hang = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        for v in hang:
            v.co.x *= 2.2; v.co.y *= 2.2; v.co.z *= 0.38
        for v in hang: v.co.x += 1.1          # hinge edge at local x = 0
        rot = Vector((0, 0, 1)).rotation_difference(Vector((0.95, 0.12, 0.25)).normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=rot, verts=hang)
        bmesh.ops.translate(bm, verts=hang, vec=Vector((x0 + 1.2, 0.2, DECK_Z - 0.1)))
        me = bpy.data.meshes.new("deck_hang"); bm.to_mesh(me); bm.free()
        ob = bpy.data.objects.new("deck_hang", me); bpy.context.collection.objects.link(ob)
        decks.append(ob)
        continue
    if j == 0 or j == len(edges) - 2:
        decks.append(deck_piece(x0, x1, "deck_end"))       # the long ends stay whole
    else:
        xm = (x0 + x1) / 2
        decks.append(deck_piece(x0, xm, "deck_a"))
        decks.append(deck_piece(xm, x1, "deck_b"))
decks.sort(key=lambda o: sum(v.co.x for v in o.data.vertices) / max(1, len(o.data.vertices)))
for i, o in enumerate(decks):
    o.name = o.data.name = f"deck_{i:02d}"
    for p in o.data.polygons: p.use_smooth = False
print("deck pieces", len(decks))

# Decimate to budget (arcade gets most of it).
deck_tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in decks)
print("deck tris", deck_tris)
for ob, share in [(arcade, 0.85)]:
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    budget = int(BUDGET * share)
    if tris > budget:
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        dec = ob.modifiers.new("dec", 'DECIMATE'); dec.ratio = budget / tris
        bpy.ops.object.modifier_apply(modifier="dec")
    for p in ob.data.polygons: p.use_smooth = True
    print(ob.name, "tris", sum(len(p.vertices) - 2 for p in ob.data.polygons))

# Masks.
for ob, crust_bias, rust_amt in [(arcade, 0.0, 1.0)] + [(o, 0.75, 0.3) for o in decks]:
    me = ob.data
    col = me.color_attributes.new("Col", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = col
    for v in me.vertices:
        p = v.co
        up = max(0.0, v.normal.z)
        crust = max(0.0, min(1.0, crust_bias + (noise.noise(p * 0.7) + 0.05) * 1.6 + up * 0.35))
        rust = max(0.0, min(1.0, (noise.noise(p * 2.3 + Vector((9, 9, 9))) - 0.3) * 2.0)) * rust_amt
        col.data[v.index].color = (1.0, crust, rust, 1.0)

# AO bake into R.
bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
ground = bpy.context.object
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 48
scene.world = scene.world or bpy.data.worlds.new("w")
scene.world.light_settings.distance = 2.5
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print("GPU unavailable", e)
for ob in [arcade] + decks:
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
bpy.data.objects.remove(ground)

bpy.ops.object.select_all(action='DESELECT')
arcade.select_set(True)
for o in decks: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='NONE',
                          export_normals=True, export_texcoords=False)
print("ARCHES_OK", OUT)
