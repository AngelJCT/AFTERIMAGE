"""The refuge gate (Part II), after the film's frames:

- a heavy corroded slab with horizontal reinforcing bands, riding vertical guide rails set
  into the jambs and dropping into a floor sill; its thick wet bottom beam is what she braces
- the LEFT jamb (seen from the refuge side) carries the rusty bolt that tears the child's
  sleeve; the wider RIGHT pillar carries the round receiver with its severed supply lead
- a pointed-arch grille crowning the lintel, the same language as the arcade beyond
- ruined stone walls either side, bone paving under shallow water, grove conduits grown in

Blender axes: X along the wall, -Y is the refuge side (where she stands), Z up. The slab's
origin is its bottom centre, so the game lifts it by moving it up (0 = shut).
Vertex colours match the grove kit: R = baked AO, G = mineral crust, B = rust.
Named points the game needs go in the frame's glTF extras, already in glTF (Y-up) space.

Objects: gate_frame, gate_walls, gate_masonry, gate_slab, gate_bolt, gate_receiver,
gate_cable, gate_plug. Walls and masonry carry a separate mineral material tag.

Usage: Blender -b --factory-startup -P gate_kit.py -- out.glb
"""
import sys, math, random
import bpy, bmesh
from mathutils import Vector, Matrix, noise

OUT = sys.argv[sys.argv.index("--") + 1:][0]
for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob)
rng = random.Random(11)

# Layout (metres).
OW, OH = 3.2, 2.75                 # clear opening
XL0, XL1 = -2.25, -OW / 2          # left jamb
XR0, XR1 = OW / 2, 2.85            # right pillar (wider: it holds the receiver)
D = 0.45                           # half depth of jambs and walls
TOP = 6.3                          # top of the jambs / underside of the lintel's cap
SLAB_H, SLAB_T = 2.95, 0.22        # slab height, thickness
SLAB_W = OW / 2 + 0.13             # half width: it runs inside the rails
OPEN = OH - 0.03                   # how far the slab lifts to clear the opening
BOLT = Vector((XL1 - 0.2, -D, 0.92))   # at the child's cuff as she passes, arm reaching back
RECV = Vector(((XR0 + XR1) / 2 + 0.05, -D, 1.75))


def gl(v):
    """Blender Z-up -> glTF Y-up."""
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def new_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


def box(bm, x0, x1, y0, y1, z0, z1):
    vs = bmesh.ops.create_cube(bm, size=1.0)["verts"]
    for v in vs:
        v.co = Vector((x0 + (v.co.x + 0.5) * (x1 - x0), y0 + (v.co.y + 0.5) * (y1 - y0), z0 + (v.co.z + 0.5) * (z1 - z0)))
    return vs


def cyl(bm, at, axis, r, depth, segs=10, r2=None):
    """Capped cylinder (or cone) centred at `at`, running along `axis`."""
    g = bmesh.ops.create_cone(bm, cap_ends=True, segments=segs, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    rot = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(at) @ rot, verts=g["verts"])
    return g["verts"]


def annulus(bm, at, axis, r_in, r_out, depth, segs=24):
    """A flat ring (washer) with an open centre, centred at `at`, along `axis`."""
    rot = Vector((0, 0, 1)).rotation_difference(Vector(axis).normalized()).to_matrix().to_4x4()
    M = Matrix.Translation(at) @ rot
    rings = []
    for r, z in ((r_out, -depth / 2), (r_out, depth / 2), (r_in, depth / 2), (r_in, -depth / 2)):
        rings.append([bm.verts.new(M @ Vector((math.cos(a) * r, math.sin(a) * r, z)))
                      for a in [k * math.tau / segs for k in range(segs)]])
    for i in range(4):
        A, B = rings[i], rings[(i + 1) % 4]
        for k in range(segs):
            bm.faces.new((A[k], A[(k + 1) % segs], B[(k + 1) % segs], B[k]))


def subdivided(bm, vs, cuts):
    edges = list({e for v in vs for e in v.link_edges})
    bmesh.ops.subdivide_edges(bm, edges=edges, cuts=cuts, use_grid_fill=True)


class Curves:
    def __init__(self, name, res=2, ures=3):
        self.cu = bpy.data.curves.new(name, 'CURVE')
        self.cu.dimensions = '3D'; self.cu.bevel_depth = 1.0; self.cu.bevel_resolution = res
        self.cu.use_fill_caps = True; self.cu.resolution_u = ures
        self.name = name

    def add(self, pts, radii, kind='NURBS'):
        sp = self.cu.splines.new(kind)
        sp.points.add(len(pts) - 1)
        for p, x, r in zip(sp.points, pts, radii):
            p.co = (x.x, x.y, x.z, 1.0); p.radius = r
        if kind == 'NURBS':
            sp.order_u = min(4, len(pts)); sp.use_endpoint_u = True

    def mesh(self):
        ob = bpy.data.objects.new(self.name, self.cu)
        bpy.context.collection.objects.link(ob)
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.convert(target='MESH')
        return bpy.context.object


def displace(ob, strength, size, basis='VORONOI_F2'):
    tex = bpy.data.textures.new(ob.name + "_d", 'CLOUDS')
    tex.noise_scale = size; tex.noise_depth = 2; tex.noise_basis = basis
    m = ob.modifiers.new("d", 'DISPLACE'); m.texture = tex; m.strength = strength; m.mid_level = 0.5
    m.texture_coords = 'GLOBAL'
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.modifier_apply(modifier="d")


def bevel(ob, width):
    bpy.context.view_layer.objects.active = ob
    m = ob.modifiers.new('Worn arrises', 'BEVEL')
    m.width = width; m.segments = 3; m.limit_method = 'ANGLE'
    bpy.ops.object.modifier_apply(modifier=m.name)


def masks(ob, crust_bias, rust_amt, crust_scale=1.6, crust_max=1.0):
    """G = crust, B = rust; R is filled by the AO bake later."""
    me = ob.data
    col = me.color_attributes.new("Col", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = col
    for v in me.vertices:
        p = ob.matrix_world @ v.co
        up = max(0.0, v.normal.z)
        crust = crust_bias + (noise.noise(p * 0.7) + 0.05) * crust_scale * 0.5 + up * 0.35
        # Mineral streaks run down from ledges.
        crust += 0.25 * max(0.0, noise.noise(Vector((p.x * 3.0, p.y * 3.0, p.z * 0.25))))
        rust = max(0.0, min(1.0, (noise.noise(p * 2.3 + Vector((9, 9, 9))) - 0.2) * 2.0)) * rust_amt
        # Rust bleeds down under bands and rivets: longer in z.
        rust = max(rust, rust_amt * max(0.0, noise.noise(Vector((p.x * 5, p.y * 5, p.z * 0.8)) + Vector((3, 1, 4))) * 1.4))
        col.data[v.index].color = (1.0, max(0.0, min(crust_max, crust)), min(1.0, rust), 1.0)


def join(name, obs):
    bpy.ops.object.select_all(action='DESELECT')
    for o in obs: o.select_set(True)
    bpy.context.view_layer.objects.active = obs[0]
    bpy.ops.object.join()
    ob = bpy.context.object
    ob.name = ob.data.name = name
    return ob


def decimate(ob, budget):
    tris = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    if tris > budget:
        bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        dec = ob.modifiers.new("dec", 'DECIMATE'); dec.ratio = budget / tris
        bpy.ops.object.modifier_apply(modifier="dec")
    for p in ob.data.polygons: p.use_smooth = True
    print(ob.name, "tris", sum(len(p.vertices) - 2 for p in ob.data.polygons))


# ---------------------------------------------------------------- walls (ruined masonry)
def stone_block(bm, c, size, r, tilt=None):
    """Closed dressed stone with a few broken corners and rounded, worn arrises."""
    block = bmesh.new()
    vs = bmesh.ops.create_cube(block, size=1.0)["verts"]
    for v in vs:
        v.co = Vector((v.co.x * size.x * 2, v.co.y * size.y * 2, v.co.z * size.z * 2))
    # Geometry is cut and capped, rather than folding arbitrary face corners inward.
    for _ in range(r.randint(1, 3)):
        corner = Vector((r.choice((-1, 1)) * size.x, r.choice((-1, 1)) * size.y, size.z))
        normal = Vector((math.copysign(1, corner.x), math.copysign(0.7, corner.y), 1)).normalized()
        bmesh.ops.bisect_plane(block, geom=list(block.verts) + list(block.edges) + list(block.faces),
                              dist=0.00001, plane_co=corner - normal * r.uniform(0.035, 0.095),
                              plane_no=normal, clear_outer=True)
        bmesh.ops.holes_fill(block, edges=[e for e in block.edges if e.is_boundary], sides=0)
    bmesh.ops.bevel(block, geom=list(block.edges), offset=min(0.04, size.z * 0.18),
                    segments=2, profile=0.55, affect='EDGES', clamp_overlap=True)
    for v in block.verts:
        p = v.co
        # Broad, coherent erosion retains planar faces and softened highlights.
        p += Vector((noise.noise(p * 4 + c), noise.noise(p * 3 + c + Vector((7, 1, 2))),
                     noise.noise(p * 5 + c + Vector((1, 9, 3))))) * min(0.009, size.z * 0.08)
    M = Matrix.Translation(c)
    if tilt is not None:
        M = M @ tilt
    copied = {v: bm.verts.new(M @ v.co) for v in block.verts}
    for face in block.faces: bm.faces.new([copied[v] for v in face.verts])
    block.free()


def wall(x0, x1, outer):
    """Coursed stone, standing tall by the gate and broken down toward the far end: blocks of
    uneven length in staggered courses, some fallen out, some loosened, the top stepped and
    ragged, and the fallen ones lying at its foot."""
    bm = bmesh.new()
    r = random.Random(17 if outer < 0 else 29)
    near = x1 if outer < 0 else x0            # the end against the gate
    length = abs(x1 - x0)

    def top_at(x):
        t = min(1.0, abs(x - near) / length)
        return 5.0 * (1 - 0.62 * t * t) + 0.7 * noise.noise(Vector((x * 0.6, 3.3, 1.7))) - 0.25

    z = -0.4
    course = 0
    fallen = []
    while z < 5.2:
        h = r.uniform(0.42, 0.58)
        x = x0 - (r.uniform(0.2, 0.6) if course % 2 else 0.0)
        while x < x1 - 0.05:
            w = r.uniform(0.7, 1.25)
            bx0, bx1 = max(x, x0), min(x + w, x1)
            x += w
            if bx1 - bx0 < 0.2:
                continue
            cx = (bx0 + bx1) / 2
            top = top_at(cx)
            if z + h * 0.5 > top:
                # Above the broken line: gone, and some of it lies at the foot.
                if r.random() < 0.18 and len(fallen) < 14:
                    fallen.append((cx, w))
                continue
            # A few blocks missing out of the face higher up.
            if z > 1.4 and r.random() < 0.05 * (z / 5):
                continue
            gap = 0.014
            size = Vector(((bx1 - bx0) / 2 - gap, D - r.uniform(0.0, 0.04), h / 2 - gap))
            c = Vector((cx, r.uniform(-0.02, 0.02), z + h / 2))
            tilt = None
            # Loosened stones near the ragged top sit askew and stand proud.
            if z + h > top - 0.6 and r.random() < 0.35:
                c.y += r.choice((-1, 1)) * r.uniform(0.03, 0.09)
                tilt = Matrix.Rotation(r.uniform(-0.08, 0.08), 4, 'Y') @ Matrix.Rotation(r.uniform(-0.05, 0.05), 4, 'Z')
            stone_block(bm, c, size, r, tilt)
        z += h
        course += 1
    # The fallen: tumbled blocks half sunk at the foot, on both sides, most toward the broken end.
    for cx, w in fallen:
        side = r.choice((-1, 1))
        c = Vector((cx + r.uniform(-0.6, 0.6), side * (D + r.uniform(0.4, 1.8)), r.uniform(-0.15, 0.05)))
        size = Vector((min(w, 1.1) / 2, r.uniform(0.3, 0.42), r.uniform(0.2, 0.27)))
        tilt = Matrix.Rotation(r.uniform(-0.5, 0.5), 4, 'X') @ Matrix.Rotation(r.uniform(0, math.tau), 4, 'Z')
        stone_block(bm, c, size, r, tilt)
    ob = new_obj("wall", bm)
    masks(ob, 0.78, 0.10, 0.42)
    return ob


walls_left, walls_right = wall(-9.5, XL0 + 0.02, -1), wall(XR1 - 0.02, 9.5, 1)
walls = []   # kept apart from the frame (see gate_walls below): crisp, not smoothed

# ---------------------------------------------------------------- jambs, lintel, sill, rails
bm = bmesh.new()
for x0, x1 in ((XL0, XL1), (XR0, XR1)):
    subdivided(bm, box(bm, x0, x1, -D - 0.05, D + 0.05, -0.3, TOP), 6)
    # Plinths and a cap course.
    box(bm, x0 - 0.08, x1 + 0.08, -D - 0.12, D + 0.12, -0.3, 0.35)
    box(bm, x0 - 0.06, x1 + 0.06, -D - 0.1, D + 0.1, TOP - 0.05, TOP + 0.12)
# Lintel beam across the top of both.
subdivided(bm, box(bm, XL0 - 0.1, XR1 + 0.1, -D - 0.12, D + 0.12, TOP + 0.12, TOP + 0.75), 8)
box(bm, XL0 - 0.2, XR1 + 0.2, -D - 0.18, D + 0.18, TOP + 0.75, TOP + 0.92)
jambs = new_obj("jambs", bm)
bevel(jambs, 0.035)
displace(jambs, 0.018, 0.5)
masks(jambs, 0.78, 0.08, 0.42)

bm = bmesh.new()
for x0, x1 in ((XL0, XL1), (XR0, XR1)):
    for z in (0.98, 2.4, 3.9, 5.4):
        box(bm, x0 - 0.03, x1 + 0.03, -D - 0.09, D + 0.09, z, z + 0.16)
for x_face, s in ((XL1, 1), (XR0, -1)):
    # Channel lips either side of the slab, set into the jamb's inner face.
    for y in (-SLAB_T / 2 - 0.1, SLAB_T / 2 + 0.02):
        box(bm, x_face - s * 0.15, x_face + s * 0.07, y, y + 0.08, -0.12, TOP + 0.1)
    # Rail brackets.
    for z in (0.6, 2.0, 3.4, 4.8):
        box(bm, x_face - s * 0.02, x_face + s * 0.1, -SLAB_T / 2 - 0.16, SLAB_T / 2 + 0.16, z, z + 0.14)
# Sill: a steel channel across the floor that the slab drops into.
for y in (-SLAB_T / 2 - 0.12, SLAB_T / 2 + 0.02):
    box(bm, XL1 - 0.15, XR0 + 0.15, y, y + 0.1, -0.16, 0.035)
# The fixed head panel above the opening, set just behind the slab's plane: shut, the gate
# reads as one solid wall of metal; lifted, the slab slides up in front of it.
subdivided(bm, box(bm, XL1 - 0.1, XR0 + 0.1, SLAB_T / 2 + 0.1, SLAB_T / 2 + 0.26, OH - 0.1, TOP + 0.2), 12)
for z in (OH + 0.6, OH + 1.5, OH + 2.4, OH + 3.2):
    box(bm, XL1 - 0.1, XR0 + 0.1, SLAB_T / 2 + 0.08, SLAB_T / 2 + 0.12, z, z + 0.12)
rails = new_obj("rails", bm)
bevel(rails, 0.008)
masks(rails, 0.0, 0.5, crust_max=0.3)

# ---------------------------------------------------------------- crown: pointed arch grille
arch = Curves("crown", res=2, ures=4)
xs, xe = XL0 + 0.1, XR1 - 0.1
w = (xe - xs) / 2
R = 1.3 * w
th_apex = math.acos((w - R) / R)
zs = TOP + 0.92


def arch_z(x):
    """Height of the arch's underside above x."""
    if x <= xs + w:
        cx = xs + R
    else:
        cx = xe - R
    return zs + math.sqrt(max(0.0, R * R - (x - cx) ** 2))


for side, x0 in ((1, xs), (-1, xe)):
    for y in (-0.22, 0.22):
        pts = [Vector((x0 + side * (R + R * math.cos(th)), y, zs + R * math.sin(th)))
               for th in [math.pi + (th_apex - math.pi) * s / 10 for s in range(11)]]
        arch.add(pts, [0.16 - 0.04 * s / 10 for s in range(11)])
    # Rib ties across the depth.
    for s in (2, 5, 8):
        th = math.pi + (th_apex - math.pi) * s / 10
        p = Vector((x0 + side * (R + R * math.cos(th)), 0, zs + R * math.sin(th)))
        arch.add([p + Vector((0, -0.24, 0)), p + Vector((0, 0.24, 0))], [0.06, 0.06], 'POLY')
# Bars, some bent or missing.
x = xs + 0.3
while x < xe - 0.25:
    top = arch_z(x) - 0.05
    if rng.random() > 0.12 and top > zs + 0.2:
        bend = rng.uniform(-0.06, 0.06) if rng.random() < 0.3 else 0.0
        arch.add([Vector((x, 0, zs)), Vector((x + bend, bend, (zs + top) / 2)), Vector((x, 0, top))], [0.028] * 3)
    x += 0.28
arch.add([Vector((xs, 0, zs + 1.1)), Vector((xe, 0, zs + 1.1))], [0.035, 0.035], 'POLY')
crown = arch.mesh()
masks(crown, 0.15, 0.5)

# ---------------------------------------------------------------- grove grown into it
grow = Curves("grown", res=1, ures=3)


def branch(start, direction, length, r0, depth):
    pts, rad = [start.copy()], [r0]
    d = direction.normalized(); p = start.copy(); n = 5
    for s in range(1, n + 1):
        d = (d + Vector((rng.uniform(-0.35, 0.35), rng.uniform(-0.2, 0.2), rng.uniform(-0.2, 0.3)))).normalized()
        p = p + d * (length / n)
        pts.append(p.copy()); rad.append(max(0.006, r0 * (1 - s / n) ** 1.2))
    grow.add(pts, rad)
    if depth > 0:
        for _ in range(2):
            s = rng.randint(2, n - 1)
            nd = (d + Vector((rng.uniform(-1, 1), rng.uniform(-0.5, 0.5), rng.uniform(-0.3, 0.8)))).normalized()
            branch(pts[s], nd, length * 0.5, rad[s] * 0.8, depth - 1)


# Conduits climbing the walls on the refuge side and over the top of the crown.
for x0 in (-8.2, -6.0, -3.4, 4.1, 6.3, 8.6):
    base = Vector((x0, -D - 0.06, -0.2))
    pts = [base]
    for k in range(1, 6):
        pts.append(Vector((x0 + math.sin(k * 1.3 + x0) * 0.35, -D - 0.08 - 0.04 * math.sin(k), k * 0.75)))
    grow.add(pts, [0.09, 0.08, 0.07, 0.06, 0.045, 0.03])
    branch(pts[3], Vector((rng.choice((-1, 1)), -0.3, 0.6)), rng.uniform(1.0, 1.8), 0.04, 1)
for x0 in (XL0 + 0.2, XR1 - 0.3):
    branch(Vector((x0, -0.3, TOP + 0.8)), Vector((0.1 if x0 < 0 else -0.1, -0.2, 1.0)), 2.6, 0.07, 2)
# Filaments hanging from the lintel on the refuge side.
for _ in range(7):
    x = rng.uniform(XL0, XR1)
    top = Vector((x, -D - 0.2, TOP + 0.2))
    drop = rng.uniform(0.6, 1.8)
    grow.add([top, top + Vector((0.05, -0.04, -drop * 0.5)), top + Vector((rng.uniform(-0.15, 0.15), -0.06, -drop))],
             [0.025, 0.018, 0.008])
grown = grow.mesh()
masks(grown, 0.05, 0.9)

# ---------------------------------------------------------------- paving under the water
# Long courses with worn joints and missing patches; most of the pavement has sunk into
# the silt. The central walking surface stays within 3 cm of the existing analytic floor.
bm = bmesh.new()
rp = random.Random(107)
y = -7.8
row = 0
while y < 4.0:
    depth = rp.uniform(0.65, 1.12)
    x = -9.8 - (0.45 if row % 2 else 0)
    while x < 9.6:
        width = rp.uniform(0.65, 1.4)
        cx, cy = x + width / 2, y + depth / 2
        x += width
        if abs(cy + 0.5) < 0.7 and XL1 - 0.2 < cx < XR0 + 0.2: continue
        # Eroded patches form coherent gaps rather than a regular checkerboard.
        missing = noise.noise(Vector((cx * 0.38, cy * 0.38, 6))) > 0.30
        if missing or rp.random() < 0.07: continue
        z = rp.uniform(-0.116, -0.098)
        stone_block(bm, Vector((cx, cy, z - 0.055)),
                    Vector((width / 2 - 0.012, depth / 2 - 0.012, 0.055)), rp)
    y += depth
    row += 1
paving = new_obj("paving", bm)
masks(paving, 0.82, 0.08, 0.35)

# Old supply runs remain on the side walls. Frayed ends explain the disconnection without
# adding a second usable socket or changing the chapter's receiver and cable.
service = Curves('service_runs', res=2, ures=5)
bm = bmesh.new()
for a, b, z in ((-8.5, -3.0, 0.62), (4.2, 8.4, 1.16)):
    pts = [Vector((a, -D - 0.045, z)), Vector((a + 1.0, -D - 0.06, z + 0.06)),
           Vector((b - 0.35, -D - 0.08, z)), Vector((b, -D - 0.20, z - 0.22))]
    service.add(pts, [0.047, 0.047, 0.042, 0.032])
    for x in (a + 0.3, a + 1.8, b - 0.6):
        box(bm, x - 0.055, x + 0.055, -D - 0.14, -D - 0.015, z - 0.09, z + 0.09)
    for k in range(3):
        tip0 = pts[-1]
        service.add([tip0, tip0 + Vector((0.06, -0.025 * k, -0.12)),
                     tip0 + Vector((0.12 + k * 0.035, -0.04 * k, -0.18 - k * 0.04))], [0.005, 0.004, 0.002])
service_mesh = service.mesh()
clamps = new_obj('service_clamps', bm)
bevel(clamps, 0.008)
for o in (service_mesh, clamps): masks(o, 0.08, 0.6, crust_max=0.3)
frame_parts = [rails, crown, grown, service_mesh, clamps]
masonry = join('gate_masonry', [jambs, paving])
masonry['surface'] = 'masonry'

# ---------------------------------------------------------------- the slab
bm = bmesh.new()
panel = box(bm, -SLAB_W, SLAB_W, -SLAB_T / 2, SLAB_T / 2, 0.0, SLAB_H)
subdivided(bm, panel, 28)
for v in bm.verts:
    p = v.co
    if abs(p.y) > SLAB_T / 2 - 0.001:
        # Pitting and shallow dents in the plate; a few cracks.
        pit = max(0.0, noise.noise(p * 6.0 + Vector((1, 2, 3)))) ** 2
        dent = noise.noise(p * 0.9 + Vector((5, 0, 5)))
        crack = max(0.0, 1 - abs(noise.noise(Vector((p.x * 1.4, p.y, p.z * 1.4)) + Vector((7, 7, 7)))) * 12)
        p.y -= math.copysign(0.012 * pit + 0.01 * max(0.0, dent) + 0.008 * crack, p.y)
# Thick bottom beam (the edge she braces) and the reinforcing bands, both faces.
subdivided(bm, box(bm, -SLAB_W, SLAB_W, -0.17, 0.17, 0.0, 0.32), 10)
for z in (0.98, 1.62, 2.26, 2.84):
    box(bm, -SLAB_W + 0.02, SLAB_W - 0.02, -0.145, 0.145, z - 0.065, z + 0.065)
# Two short vertical straps near the edges (the film's plate is mostly plain).
for x in (-SLAB_W + 0.12, SLAB_W - 0.12):
    box(bm, x - 0.06, x + 0.06, -0.125, 0.125, 0.32, SLAB_H - 0.05)
# Rivets along the bands and the beam, both faces.
for z in (0.98, 1.62, 2.26, 2.84, 0.24):
    y = 0.145 if z > 0.5 else 0.17
    x = -SLAB_W + 0.15
    while x < SLAB_W - 0.1:
        for s in (-1, 1):
            cyl(bm, Vector((x, s * (y + 0.008), z)), (0, s, 0), 0.02, 0.022, 6, 0.012)
        x += 0.24
slab = new_obj("gate_slab", bm)
displace(slab, 0.012, 0.25, 'BLENDER_ORIGINAL')
masks(slab, 0.05, 0.4, 1.2, crust_max=0.55)
# The beam's underside is wet and dark: less crust near z = 0.
col = slab.data.color_attributes["Col"]
for v in slab.data.vertices:
    c = col.data[v.index].color
    k = min(1.0, v.co.z / 0.5)
    col.data[v.index].color = (c[0], c[1] * (0.4 + 0.6 * k), min(1.0, c[2] + 0.25 * (1 - k)), 1.0)

# ---------------------------------------------------------------- the bolt (LEFT jamb)
bm = bmesh.new()
cyl(bm, BOLT + Vector((0, -0.02, 0)), (0, 1, 0), 0.075, 0.04, 6)          # hex washer plate
cyl(bm, BOLT + Vector((0, -0.05, 0)), (0, 1, 0), 0.05, 0.04, 6)           # nut
shaft = Curves("bolt_shaft", res=2, ures=4)
tip = BOLT + Vector((0.01, -0.2, -0.025))                                  # bent a little down
shaft.add([BOLT + Vector((0, -0.04, 0)), BOLT + Vector((0, -0.12, -0.004)), tip], [0.028, 0.027, 0.024])
bolt_parts = [new_obj("bolt_base", bm), shaft.mesh()]
bm = bmesh.new()
cyl(bm, tip + Vector((0, -0.015, 0)), (0, 1, 0), 0.04, 0.03, 8)           # a flat head
bolt_parts.append(new_obj("bolt_head", bm))
for o in bolt_parts:
    masks(o, 0.0, 1.0, crust_max=0.15)
bolt = join("gate_bolt", bolt_parts)

# ---------------------------------------------------------------- the receiver (RIGHT pillar)
bm = bmesh.new()
out = Vector((0, -1, 0))
cyl(bm, RECV + out * 0.03, out, 0.36, 0.06, 24)                             # back plate
for k in range(10):
    a = k * math.tau / 10 + 0.2
    cyl(bm, RECV + Vector((math.cos(a) * 0.31, -0.07, math.sin(a) * 0.31)), out, 0.024, 0.035, 6)
annulus(bm, RECV + out * 0.1, out, 0.15, 0.26, 0.08, 28)                     # housing ring
annulus(bm, RECV + out * 0.15, out, 0.1, 0.19, 0.06, 28)                     # inner ring
annulus(bm, RECV + out * 0.2, out, 0.066, 0.13, 0.05, 24)                    # socket lip
cyl(bm, RECV + out * 0.08, out, 0.15, 0.04, 24)                             # face behind the rings
# The socket: a dark recess (inward-facing tube) with a floor.
g = bmesh.ops.create_cone(bm, cap_ends=False, segments=16, radius1=0.065, radius2=0.065, depth=0.12)
bmesh.ops.reverse_faces(bm, faces=list({f for v in g["verts"] for f in v.link_faces}))
bmesh.ops.transform(bm, matrix=Matrix.Translation(RECV + out * 0.16) @ Matrix.Rotation(math.pi / 2, 4, 'X'), verts=g["verts"])
cyl(bm, RECV + out * 0.105, out, 0.066, 0.01, 16)
# Coupling on the lower right where the power cable leaves.
COUPLE = RECV + Vector((0.2, -0.12, -0.2))
cyl(bm, COUPLE, (0.4, -0.6, -0.7), 0.05, 0.1, 10)
recv = new_obj("recv_body", bm)
lead = Curves("lead", res=2, ures=4)
top = RECV + Vector((-0.05, -0.08, -0.3))
lp = [top, top + Vector((-0.02, -0.03, -0.25)), top + Vector((-0.06, -0.12, -0.45)), top + Vector((-0.1, -0.2, -0.6))]
lead.add(lp, [0.03, 0.03, 0.028, 0.026])
end = lp[-1]
for k in range(5):            # the severed end: frayed wires splaying out
    a = k * math.tau / 5 + 0.3
    d = Vector((math.cos(a) * 0.04, -0.04 + math.sin(a) * 0.03, -0.1 - 0.04 * rng.random()))
    lead.add([end, end + d * 0.5 + Vector((0, 0, -0.01)), end + d + Vector((math.cos(a) * 0.03, 0, 0))], [0.006, 0.005, 0.003])
leadm = lead.mesh()
masks(recv, 0.05, 0.6, crust_max=0.3)
masks(leadm, 0.0, 0.5, crust_max=0.1)
receiver = join("gate_receiver", [recv, leadm])

# ---------------------------------------------------------------- the power cable, at rest
# Ribbed: the radius steps in and out along its length. It hangs from the coupling to the
# floor, where the plug lies.
PLUG = Vector((XR0 - 0.05, -1.25, 0.06))
cab = Curves("gate_cable", res=2, ures=2)
ctrl = [COUPLE + Vector((0.04, -0.06, -0.08)), COUPLE + Vector((0.12, -0.2, -0.5)), Vector((COUPLE.x + 0.05, -0.95, 0.35)),
        Vector((COUPLE.x - 0.2, -1.2, 0.06)), Vector((PLUG.x + 0.55, -1.3, 0.05)), PLUG + Vector((0.14, 0, 0))]
path = []
for i in range(len(ctrl) - 1):
    for s in range(12):
        path.append(ctrl[i].lerp(ctrl[i + 1], s / 12))
path.append(ctrl[-1])
# Smooth the polyline, then rib it.
for _ in range(3):
    path = [path[0]] + [(path[i - 1] + path[i] * 2 + path[i + 1]) / 4 for i in range(1, len(path) - 1)] + [path[-1]]
cab.add(path, [0.034 if i % 2 else 0.028 for i in range(len(path))], 'POLY')
cable = cab.mesh()
masks(cable, 0.0, 0.35, crust_max=0.1)

# The plug: a ribbed collar, a body and the contact nose, pointing along -X, origin at the nose.
bm = bmesh.new()
ax = Vector((-1, 0, 0))
cyl(bm, Vector((0.02, 0, 0)), ax, 0.045, 0.04, 12)                         # nose
cyl(bm, Vector((0.075, 0, 0)), ax, 0.058, 0.07, 14)                        # body
for k in range(4):
    cyl(bm, Vector((0.12 + k * 0.022, 0, 0)), ax, 0.066, 0.012, 14)        # collar ribs
cyl(bm, Vector((0.19, 0, 0)), ax, 0.04, 0.06, 12, 0.034)                   # strain relief
for a in (0.4, 2.5, 4.6):                                                   # contact pins
    cyl(bm, Vector((-0.01, math.cos(a) * 0.022, math.sin(a) * 0.022)), ax, 0.006, 0.03, 6)
plug = new_obj("gate_plug", bm)
masks(plug, 0.0, 0.3, crust_max=0.1)
plug.location = PLUG

# ---------------------------------------------------------------- join, budget
frame = join("gate_frame", frame_parts)
gate_walls = join("gate_walls", [walls_left, walls_right])
for ob, budget in ((frame, 42000), (slab, 12000), (bolt, 600), (receiver, 4000), (cable, 3000), (plug, 1200)):
    decimate(ob, budget)
# The masonry keeps its broad faces and small bevel facets.
for ob in (gate_walls, masonry):
    ob.data.validate(); ob.data.update()
    for p in ob.data.polygons: p.use_smooth = False
    print(ob.name, 'tris', sum(len(p.vertices) - 2 for p in ob.data.polygons))
gate_walls['surface'] = 'masonry'

# AO bake into R, everything in place (slab shut).
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.1))
ground = bpy.context.object
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 48
scene.world = scene.world or bpy.data.worlds.new("w")
scene.world.light_settings.distance = 1.6
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print("GPU unavailable", e)
parts = (frame, gate_walls, masonry, slab, bolt, receiver, cable, plug)
for ob in parts:
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

# Named points for the game (glTF space, relative to the kit's origin).
frame["opening"] = [OW, OH]
frame["slab_open"] = OPEN
frame["bolt_tip"] = gl(tip + Vector((0, -0.03, 0)))
frame["socket"] = gl(RECV + out * 0.225)
frame["cable_anchor"] = gl(COUPLE + Vector((0.04, -0.06, -0.08)))
frame["plug_rest"] = gl(PLUG)
frame["jamb_left"] = [XL0, XL1]
frame["jamb_right"] = [XR0, XR1]
frame["wall"] = [-9.5, 9.5, D]

bpy.ops.object.select_all(action='DESELECT')
for ob in parts: ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='NONE',
                          export_normals=True, export_texcoords=False, export_extras=True)
print("GATE_OK", OUT)
