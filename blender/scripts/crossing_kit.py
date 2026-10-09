"""Chapter V's crossing: the fallen conduit over the flooded channel, and the two leaning slabs.

Pieces (each its own object, placed by game/src/world/crossing.ts):
- conduit: a fallen bundle of conduits along +X from x = 0 to x = CONDUIT_LEN, its axis on the
  X axis (the game walks her along the top at z = R): strands twisting round each other, snapped
  ragged ends, a couple of broken branch stubs, grit caught on top
- slab: a broken stone slab, long along X (SLAB_LEN), thin along Y (SLAB_THICK), standing up
  from z = 0 (SLAB_TALL): fractured edges, a chipped top, strata; the game uses it twice
- pinch: the broken block that juts into the gap halfway
- rubble: chips and chunks round the slabs' feet (local to the gap's middle)
Vertex colours match the grove kit: R = baked AO, G = mineral crust, B = rust.

Usage: Blender -b --factory-startup -P crossing_kit.py -- out.glb
"""
import sys, math, random
import bpy, bmesh
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob)

CONDUIT_LEN = 10.22
R = 0.22
SLAB_LEN, SLAB_TALL, SLAB_THICK = 4.6, 3.4, 0.55
rng = random.Random(11)


def link(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    return ob


# ── The conduit bundle ───────────────────────────────────────────────────────
cu = bpy.data.curves.new("conduit", 'CURVE')
cu.dimensions = '3D'; cu.bevel_depth = 1.0; cu.bevel_resolution = 3; cu.use_fill_caps = True; cu.resolution_u = 4


def tube(pts, radii):
    sp = cu.splines.new('NURBS')
    sp.points.add(len(pts) - 1)
    for p, x, r in zip(sp.points, pts, radii):
        p.co = (x.x, x.y, x.z, 1.0); p.radius = r
    sp.order_u = min(4, len(pts)); sp.use_endpoint_u = True


STRANDS = 4
for k in range(STRANDS):
    pts, rad = [], []
    n = 26
    # Snapped: each strand ends a little short or long of the others, ragged.
    x0 = rng.uniform(-0.25, 0.1); x1 = CONDUIT_LEN + rng.uniform(-0.1, 0.3)
    for s in range(n + 1):
        u = s / n
        x = x0 + (x1 - x0) * u
        tw = u * math.pi * 2.6 + k * math.pi * 2 / STRANDS
        rr = R * 0.62 + 0.02 * math.sin(u * 17 + k)
        pts.append(Vector((x, math.cos(tw) * rr, math.sin(tw) * rr)))
        taper = min(1.0, min(u, 1 - u) * 14 + 0.35)
        rad.append(R * (0.4 + 0.05 * math.sin(u * 23 + k * 2)) * taper)
    tube(pts, rad)
# A thin cable wound loosely round the bundle.
pts = [Vector((x, math.cos(x * 2.1) * R * 1.02, math.sin(x * 2.1) * R * 1.02)) for x in [i * 0.2 for i in range(int(CONDUIT_LEN / 0.2) + 1)]]
tube(pts, [0.028] * len(pts))
# Broken branch stubs.
for x, ang, ln in [(2.4, 2.2, 0.7), (6.1, -2.4, 0.55), (8.3, 2.7, 0.4)]:
    base = Vector((x, math.cos(ang) * R * 0.8, math.sin(ang) * R * 0.8))
    d = Vector((0.35, math.cos(ang), math.sin(ang))).normalized()
    tube([base, base + d * ln * 0.5, base + d * ln + Vector((0, 0, -0.08))], [0.07, 0.05, 0.02])
cob = bpy.data.objects.new("conduit", cu)
bpy.context.collection.objects.link(cob)
bpy.ops.object.select_all(action='DESELECT'); cob.select_set(True); bpy.context.view_layer.objects.active = cob
bpy.ops.object.convert(target='MESH')
conduit = bpy.context.object
# Bark relief.
for v in conduit.data.vertices:
    p = v.co
    v.co += v.normal * (0.012 * noise.noise(Vector((p.x * 9, p.y * 3, p.z * 3))) + 0.004 * noise.noise(p * 40))


# ── A slab ───────────────────────────────────────────────────────────────────
def make_slab(name, seed):
    """A slab broken off along fracture planes: an angular top, chipped corners, rough faces."""
    bm = bmesh.new()
    geom = bmesh.ops.create_cube(bm, size=1.0)
    for v in geom["verts"]:
        v.co.x *= SLAB_LEN; v.co.y *= SLAB_THICK; v.co.z = (v.co.z + 0.5) * SLAB_TALL
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=10, use_grid_fill=True)
    off = Vector((seed * 3.1, seed * 1.7, seed * 0.9))
    # Faces: low, broad relief and shallow strata (before the cuts, so cut faces stay flat).
    for v in bm.verts:
        p = v.co
        face = 1 if p.y > 0 else -1
        n1 = noise.noise(p * 0.8 + off)
        strata = 0.018 * math.sin(p.z * 8 + n1 * 2)
        p.y += face * (0.05 * n1 + 0.02 * noise.noise(p * 3 - off) + strata)
    r = random.Random(seed)
    # Broken along planes: a stepped, sloping top, and a chipped end or two.
    cuts = [
        (Vector((-SLAB_LEN * 0.25, 0, SLAB_TALL * 0.93)), Vector((r.uniform(0.15, 0.3), r.uniform(-0.2, 0.2), 1))),
        (Vector((SLAB_LEN * 0.22, 0, SLAB_TALL * 0.8)), Vector((r.uniform(-0.45, -0.25), r.uniform(-0.2, 0.2), 1))),
        (Vector((SLAB_LEN * 0.5, 0, SLAB_TALL * 0.55)), Vector((1, r.uniform(-0.2, 0.2), 0.8))),
        (Vector((-SLAB_LEN * 0.5, 0, SLAB_TALL * 0.75)), Vector((-1, r.uniform(-0.2, 0.2), 1.2))),
        (Vector((0, SLAB_THICK * 0.35, SLAB_TALL)), Vector((0, 1, 1.4))),
    ]
    for co, no in cuts:
        bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no.normalized(), clear_outer=True)
        edges = [e for e in bm.edges if e.is_boundary]
        if edges:
            bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return link(name, bm)


slab = make_slab("slab", 3)

# ── The pinch block and rubble ───────────────────────────────────────────────
def chunk(bm, at, size, seed):
    g = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=size)
    for v in g["verts"]:
        p = v.co
        d = p.normalized()
        # Fracture planes: flatten a few sides, then rough.
        for plane in (Vector((1, 0.2, 0.1)), Vector((-0.3, 1, 0.2)), Vector((0.1, -0.4, -1))):
            k = d.dot(plane.normalized())
            if k > 0.55: p -= plane.normalized() * (k - 0.55) * size * 0.9
        p *= 1 + 0.18 * noise.noise(p * 3 + Vector((seed, 0, 0)))
        v.co = p + at


bm = bmesh.new()
chunk(bm, Vector((0, 0, 0)), 0.36, 1)
for v in bm.verts: v.co.x *= 1.25; v.co.z *= 0.8; v.co.y *= 0.75
pinch = link("pinch", bm)

bm = bmesh.new()
for i in range(16):
    side = rng.choice((-1, 1))
    at = Vector((rng.uniform(-3.2, 3.2), side * rng.uniform(0.75, 2.2), 0.0))
    s = rng.uniform(0.06, 0.28) if i > 2 else rng.uniform(0.35, 0.5)
    at.z = s * 0.35
    chunk(bm, at, s, i)
rubble = link("rubble", bm)

pieces = [conduit, slab, pinch, rubble]
# The conduit is smooth; broken stone keeps its facets.
for ob in pieces:
    for p in ob.data.polygons: p.use_smooth = ob is conduit

# ── Masks ────────────────────────────────────────────────────────────────────
for ob, crust_bias, rust_amt in [(conduit, 0.0, 1.0), (slab, 0.55, 0.25), (pinch, 0.5, 0.2), (rubble, 0.5, 0.2)]:
    me = ob.data
    col = me.color_attributes.new("Col", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = col
    for v in me.vertices:
        p = v.co
        up = max(0.0, v.normal.z)
        crust = max(0.0, min(1.0, crust_bias + (noise.noise(p * 0.8) + 0.05) * 1.5 + up * 0.4))
        rust = max(0.0, min(1.0, (noise.noise(p * 2.3 + Vector((9, 9, 9))) - 0.3) * 2.0)) * rust_amt
        col.data[v.index].color = (1.0, crust, rust, 1.0)

# ── AO bake into R ───────────────────────────────────────────────────────────
bpy.ops.mesh.primitive_plane_add(size=100, location=(0, 0, -0.02))
ground = bpy.context.object
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 48
scene.world = scene.world or bpy.data.worlds.new("w")
scene.world.light_settings.distance = 1.2
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    scene.cycles.device = 'GPU'
except Exception as e:
    print("GPU unavailable", e)
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
    print(ob.name, "tris", sum(len(p.vertices) - 2 for p in me.polygons))
bpy.data.objects.remove(ground)

bpy.ops.object.select_all(action='DESELECT')
for o in pieces: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='NONE',
                          export_normals=True, export_texcoords=False)
print("CROSSING_OK", OUT)
