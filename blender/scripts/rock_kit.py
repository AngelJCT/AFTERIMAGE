"""Floor kit for the grove: pebbles, fractured chunks, a slab, salt crusts, boulders and fallen thorn twigs.

Each piece starts as an icosphere, is squashed, cut by random fracture planes (flat broken
faces like the film's mineral chunks), roughened with noise, seated on a flat base and
decimated to a budget. Vertex colours carry masks for the game material:
R = baked ambient occlusion, G = pale mineral crust (up-facing), B = dark water stain (low).

Usage: Blender -b --factory-startup -P rock_kit.py -- out.glb
"""
import sys, math, random
import bpy, bmesh
from mathutils import Vector, Matrix, noise

argv = sys.argv[sys.argv.index("--") + 1:]
OUT = argv[0]

for ob in list(bpy.data.objects):
    bpy.data.objects.remove(ob)

# name, seed, size (m), squash (x, y, z), fracture cuts, cut depth, roughness, terrace, tri budget
# The film's floor: low salt-crusted outcrops in the shallows, pale lumps, loose pebbles.
KIT = [
    ("pebble_a", 3, 0.14, (1.0, 0.8, 0.55), 2, 0.25, 0.12, 0.0, 320),
    ("chunk_a", 7, 0.3, (1.0, 0.85, 0.7), 8, 0.45, 0.18, 0.2, 900),
    ("chunk_b", 11, 0.34, (1.3, 0.8, 0.6), 9, 0.42, 0.2, 0.2, 900),
    ("slab", 17, 0.5, (1.4, 1.0, 0.28), 5, 0.3, 0.14, 0.3, 900),
    ("crust_a", 29, 0.9, (1.5, 1.0, 0.2), 6, 0.25, 0.35, 0.5, 2000),
    ("crust_b", 31, 1.3, (1.6, 0.9, 0.16), 7, 0.25, 0.4, 0.5, 2200),
    ("boulder_a", 19, 0.95, (1.2, 1.0, 0.7), 10, 0.45, 0.24, 0.3, 3000),
    ("boulder_b", 23, 1.2, (1.4, 0.9, 0.55), 11, 0.45, 0.26, 0.3, 3000),
]


def rand_unit(r):
    while True:
        v = Vector((r.uniform(-1, 1), r.uniform(-1, 1), r.uniform(-1, 1)))
        if 0.1 < v.length <= 1: return v.normalized()


def build_rock(name, seed, size, squash, cuts, depth, rough, terrace, budget):
    r = random.Random(seed)
    me = bpy.data.meshes.new(name)
    ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=5, radius=1.0)
    off = Vector((r.uniform(0, 50), r.uniform(0, 50), r.uniform(0, 50)))
    planes = []
    for _ in range(cuts):
        n = rand_unit(r)
        n.z *= 0.6          # fewer cuts straight down onto the top
        planes.append((n.normalized(), 1.0 - depth * r.uniform(0.5, 1.2)))
    upper = set()
    for v in bm.verts:
        p = v.co.copy()
        top_side = p.z > 0.25   # strata only on the upper surface
        if v.co.z > 0: upper.add(v.index)
        # Low-frequency lumpiness before the cuts, fine grain after.
        p *= 1.0 + (0.22 + terrace * 0.2) * noise.noise(p * 1.1 + off)
        p = Vector((p.x * squash[0], p.y * squash[1], p.z * squash[2]))
        # Ragged outline for the flat crusts.
        p.x *= 1.0 + terrace * 0.35 * noise.noise(p * 2.6 + off * 3)
        p.y *= 1.0 + terrace * 0.35 * noise.noise(p * 2.6 - off * 3)
        for n, d in planes:
            h = p.dot(n)
            if h > d: p -= n * (h - d) * 0.97
        # Crags: ridged noise (sharp creases) plus pitting.
        crag = noise.ridged_multi_fractal(p * 3.2 + off, 0.9, 2.1, 3, 1.0, 2.0) - 1.0
        p += p.normalized() * rough * (0.14 * crag + 0.2 * noise.noise(p * 5.0 + off * 2))
        p += p.normalized() * rough * 0.09 * noise.noise(p * 14.0 - off)
        # Sediment strata: pull heights toward layers.
        if terrace > 0 and top_side:
            step = 0.06
            q = max(step, round(p.z / step) * step)
            p.z += (q - p.z) * terrace * 0.6
        v.co = p
    # Seat it: flatten everything below 35% of its height onto a base.
    zs = [v.co.z for v in bm.verts]
    lo, hi = min(zs), max(zs)
    base = lo + (hi - lo) * (0.3 - terrace * 0.25)
    for v in bm.verts:
        if v.co.z < base: v.co.z = base + (v.co.z - base) * 0.08
        # The upper surface never sinks through the base (thin crusts would tear).
        if v.index in upper: v.co.z = max(v.co.z, base + (hi - lo) * 0.06)
    for v in bm.verts:
        v.co.z -= base
        v.co *= size / (max(squash) * 1.0)
    bm.to_mesh(me); bm.free()

    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris > budget:
        dec = ob.modifiers.new("dec", 'DECIMATE'); dec.ratio = budget / tris
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier="dec")
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))

    col = me.color_attributes.new("Col", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = col
    top = max(v.co.z for v in me.vertices) or 1.0
    for v in me.vertices:
        p = v.co
        up = max(0.0, v.normal.z)
        upk = max(0.0, min(1.0, (up - 0.35) / 0.45))
        crust = max(0.0, min(1.0, upk * 0.85 + 0.5 * noise.noise(p * (4.0 / size) + off)))
        h = p.z / top
        stain = max(0.0, min(1.0, (0.28 - h) * 3.5 + 0.35 * noise.noise(p * (7.0 / size) - off)))
        col.data[v.index].color = (1.0, crust, stain, 1.0)
    return ob


def build_twig(name, seed, length, forks, budget):
    """A fallen thorn twig lying on the ground: a bent main stem, a few forks, thorns."""
    r = random.Random(seed)
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'; cu.bevel_depth = 1.0; cu.bevel_resolution = 1; cu.use_fill_caps = True; cu.resolution_u = 3

    def stem(start, d, ln, r0, depth):
        pts, rad = [start.copy()], [r0]
        p = start.copy()
        n = 6
        for k in range(1, n + 1):
            d = (d + Vector((r.uniform(-0.35, 0.35), r.uniform(-0.35, 0.35), 0))).normalized()
            p = p + d * (ln / n)
            # Rests on the ground, lifting where it crosses itself or a fork props it up.
            p.z = max(r0, 0.35 * r0 + 0.012 * math.sin(k * 1.7 + seed)) + (0.02 * depth)
            pts.append(p.copy()); rad.append(max(0.002, r0 * (1 - 0.8 * k / n)))
        sp = cu.splines.new('NURBS'); sp.points.add(len(pts) - 1)
        for sp_p, x, rr in zip(sp.points, pts, rad):
            sp_p.co = (x.x, x.y, x.z, 1.0); sp_p.radius = rr
        sp.order_u = 4; sp.use_endpoint_u = True
        # Thorns: short tapered spikes.
        for k in range(1, n):
            if r.random() < 0.7:
                a, b = pts[k], pts[k + 1]
                t = r.random(); base = a.lerp(b, t)
                ax = (b - a).normalized()
                side = Vector((-ax.y, ax.x, 0)) * r.choice((-1, 1))
                tip = base + (side * 0.8 + ax * 0.5 + Vector((0, 0, 0.3))).normalized() * rad[k] * 3.2
                th = cu.splines.new('POLY'); th.points.add(1)
                th.points[0].co = (*base, 1); th.points[0].radius = rad[k] * 0.45
                th.points[1].co = (*tip, 1); th.points[1].radius = 0.0005
        if depth > 0:
            for _ in range(forks):
                k = r.randint(1, n - 2)
                nd = (d + Vector((r.uniform(-1.2, 1.2), r.uniform(-1.2, 1.2), 0))).normalized()
                stem(pts[k], nd, ln * r.uniform(0.3, 0.55), rad[k] * 0.75, depth - 1)

    stem(Vector((-length / 2, 0, 0)), Vector((1, 0, 0)), length, 0.018 * length / 0.8, 2)
    ob = bpy.data.objects.new(name, cu)
    bpy.context.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH')
    ob = bpy.context.object
    me = ob.data
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    if tris > budget:
        dec = ob.modifiers.new("dec", 'DECIMATE'); dec.ratio = budget / tris
        bpy.ops.object.modifier_apply(modifier="dec")
    for p in me.polygons: p.use_smooth = True
    col = me.color_attributes.new("Col", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = col
    off = Vector((seed, seed * 2, 0))
    for v in me.vertices:
        p = v.co
        crust = max(0.0, min(1.0, (noise.noise(p * 6 + off) + 0.1) * 1.5 + max(0.0, v.normal.z) * 0.3))
        rust = max(0.0, min(1.0, (noise.noise(p * 11 - off) - 0.3) * 2.2))
        col.data[v.index].color = (1.0, crust, rust, 1.0)
    return ob



def chunk_verts(bm, r, size, cuts=4, subdiv=1):
    """One small fractured chunk (a few flat broken faces, a little grain) added to bm at the
    origin; returns its verts."""
    verts = bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)["verts"]
    planes = [(rand_unit(r), r.uniform(0.35, 0.75)) for _ in range(cuts)]
    sq = Vector((r.uniform(0.8, 1.3), r.uniform(0.7, 1.1), r.uniform(0.45, 0.85)))
    off = Vector((r.uniform(0, 40), r.uniform(0, 40), r.uniform(0, 40)))
    for v in verts:
        p = v.co.copy()
        for n, d in planes:
            h = p.dot(n)
            if h > d: p -= n * (h - d)
        p += p.normalized() * 0.12 * noise.noise(p * 3.0 + off)
        v.co = Vector((p.x * sq.x, p.y * sq.y, p.z * sq.z)) * size
    return verts


def finish_cluster(name, me, ob, crust_k, stain_k, off):
    """Smooth by angle and paint the masks (G crust, B stain; R AO baked later)."""
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(38))
    col = me.color_attributes.new("Col", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = col
    top = max(v.co.z for v in me.vertices) or 1.0
    for v in me.vertices:
        p = v.co
        up = max(0.0, v.normal.z)
        crust = max(0.0, min(1.0, crust_k * (0.4 + up * 0.6) + 0.25 * noise.noise(p * 5.0 + off)))
        stain = max(0.0, min(1.0, stain_k * (1.0 - p.z / top) + 0.3 * noise.noise(p * 8.0 - off)))
        col.data[v.index].color = (1.0, crust, stain, 1.0)
    return ob


def build_mound(name, seed, radius, height, n, budget):
    """A rubble mound, as round the gate in the boards: a low lumpy dome crowded with
    half-buried fractured chunks, bigger toward the foot, dark and crumbly."""
    r = random.Random(seed)
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    off = Vector((r.uniform(0, 50), r.uniform(0, 50), r.uniform(0, 50)))
    dome = bmesh.ops.create_icosphere(bm, subdivisions=3, radius=1.0)["verts"]
    for v in dome:
        p = v.co.copy()
        p *= 1.0 + 0.18 * noise.noise(p * 1.6 + off) + 0.06 * noise.noise(p * 5.0 - off)
        z = max(p.z, 0.0) * height + min(p.z, 0.0) * 0.05
        v.co = Vector((p.x * radius, p.y * radius * r.uniform(0.75, 0.95), z))
    bm.normal_update()
    from mathutils.bvhtree import BVHTree
    surf = BVHTree.FromBMesh(bm)
    for k in range(n):
        a = r.random() * math.tau; d = math.sqrt(r.random()) * radius * 1.05
        hit, nrm, _, _ = surf.ray_cast(Vector((math.cos(a) * d, math.sin(a) * d, height * 3)), Vector((0, 0, -1)), height * 6)
        if hit is None: hit, nrm = Vector((math.cos(a) * d, math.sin(a) * d, 0)), Vector((0, 0, 1))
        foot = d / radius
        size = r.uniform(0.025, 0.085) * (0.7 + foot * 0.9) * (1.8 if r.random() < 0.07 else 1.0)
        verts = chunk_verts(bm, r, size, subdiv=1 if size > 0.08 else 0)
        rot = rand_unit(r).rotation_difference(Vector((0, 0, 1))).to_matrix().to_4x4()
        bmesh.ops.transform(bm, matrix=Matrix.Translation(hit - nrm * size * 0.35) @ rot, verts=verts)
    bm.to_mesh(me); bm.free()
    # (Built lean and never decimated: collapsing loose chunks smears them into shards.)
    return finish_cluster(name, me, ob, 0.25, 0.75, off)


def build_gravel(name, seed, radius, n):
    """A clump of gravel: small stones scattered thickest in the middle of a patch."""
    r = random.Random(seed)
    me = bpy.data.meshes.new(name); ob = bpy.data.objects.new(name, me)
    bpy.context.collection.objects.link(ob)
    bm = bmesh.new()
    off = Vector((r.uniform(0, 50), r.uniform(0, 50), r.uniform(0, 50)))
    for k in range(n):
        a = r.random() * math.tau; d = (r.random() ** 1.6) * radius
        size = r.uniform(0.012, 0.045) * (1.3 - d / radius * 0.6)
        verts = bmesh.ops.create_icosphere(bm, subdivisions=0, radius=1.0)["verts"]
        sq = Vector((r.uniform(0.8, 1.3), r.uniform(0.7, 1.1), r.uniform(0.35, 0.6))) * size
        rz = r.random() * math.tau
        for v in verts:
            p = Vector((v.co.x * sq.x, v.co.y * sq.y, v.co.z * sq.z))
            p.rotate(Matrix.Rotation(rz, 3, 'Z'))
            v.co = p + Vector((math.cos(a) * d, math.sin(a) * d, sq.z * 0.4))
    bm.to_mesh(me); bm.free()
    return finish_cluster(name, me, ob, 0.45, 0.45, off)


MOUNDS = [("mound_a", 101, 1.3, 0.55, 300, 0), ("mound_b", 103, 0.9, 0.4, 190, 0),
          ("mound_c", 107, 0.7, 0.28, 120, 0)]
GRAVEL = [("gravel_a", 111, 0.6, 160), ("gravel_b", 113, 0.9, 220)]

TWIGS = [("twig_a", 41, 0.8, 2, 700), ("twig_b", 43, 1.2, 3, 900), ("twig_c", 47, 0.5, 1, 450)]

objs = []
for i, spec in enumerate(TWIGS):
    ob = build_twig(*spec)
    ob.location.x = (len(KIT) + i) * 6
    objs.append(ob)
    print(spec[0], "tris", sum(len(p.vertices) - 2 for p in ob.data.polygons))
for i, spec in enumerate(KIT):
    ob = build_rock(*spec)
    ob.location.x = i * 6
    objs.append(ob)
    print(spec[0], "tris", sum(len(p.vertices) - 2 for p in ob.data.polygons))
for i, spec in enumerate(MOUNDS):
    ob = build_mound(*spec)
    ob.location.x = (len(KIT) + len(TWIGS) + i) * 6
    objs.append(ob)
    print(spec[0], "tris", sum(len(p.vertices) - 2 for p in ob.data.polygons))
for i, spec in enumerate(GRAVEL):
    ob = build_gravel(*spec)
    ob.location.x = (len(KIT) + len(TWIGS) + len(MOUNDS) + i) * 6
    objs.append(ob)
    print(spec[0], "tris", sum(len(p.vertices) - 2 for p in ob.data.polygons))

# AO into R, with a ground plane so the base darkens where it meets the floor.
bpy.ops.mesh.primitive_plane_add(size=200, location=(30, 0, -0.01))
ground = bpy.context.object
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 64
scene.world = scene.world or bpy.data.worlds.new("w")
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
    mat = bpy.data.materials.new(ob.name + "_m"); me.materials.append(mat)
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
print("ROCKS_OK", OUT)
