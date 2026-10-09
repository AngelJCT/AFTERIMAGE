"""Build the grove's tree kit in Blender and export it as one GLB of named meshes.

Each tree: a branching skeleton -> swept curves with closed fork joints -> bark
displacement -> thorns and rust nodules -> decimate. Per-vertex colours carry the masks the
game material uses: R = baked ambient occlusion, G = pale mineral crust, B = rust.
Usage: Blender -b -P grove_kit.py -- <out.glb> [trisPerTree]"""
import bpy, bmesh, sys, math, random
from mathutils import Vector, Matrix, noise
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index("--") + 1:]
OUT = args[0]
TRIS = int(args[1]) if len(args) > 1 else 9000
# --bake: also bake a tangent-space normal map per tree from a round, finely ridged sweep. Tried
# for the October pass: at game distances it changed almost nothing (the faceting that showed was
# in the silhouette, which a normal map can't round), for 1.2 MB of textures. Off by default.
BAKE = "--bake" in args
bpy.ops.wm.read_factory_settings(use_empty=True)
# Cycles on the GPU for the bakes.
bpy.context.scene.render.engine = 'CYCLES'
try:
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'; prefs.get_devices()
    for dv in prefs.devices: dv.use = True
    bpy.context.scene.cycles.device = 'GPU'
except Exception as e:
    print("GPU unavailable", e)

def rand_unit(r):
    v = Vector((r.gauss(0, 1), r.gauss(0, 1), r.gauss(0, 1)))
    return v.normalized() if v.length > 1e-6 else Vector((0, 0, 1))

class Skeleton:
    def __init__(self):
        self.pos, self.rad, self.parent = [], [], []
    def add(self, p, r, parent):
        self.pos.append(p.copy()); self.rad.append(r); self.parent.append(parent)
        return len(self.pos) - 1

def grow(sk, r, start, parent, d, length, radius, depth, droop, seg):
    """One branch as a chain of nodes; spawns children along it."""
    n = max(3, int(length / seg))
    p = start.copy(); d = d.copy(); idx = parent
    chain = []
    # A slow coil about the branch's own axis: the limbs twist like old vines (the boards).
    # (From their own random stream, so each tree keeps the skeleton, and the footprint in the
    # grove, it always had: paths and framed shots were laid out round those.)
    rc = random.Random(len(sk.pos) * 7919 + depth * 104729 + int(length * 1000))
    coil_axis = rand_unit(rc); coil_phase = rc.random() * math.tau; coil = 0.07 + 0.06 * rc.random()
    # Beads: knots strung along the limb at a spacing that follows its thickness.
    bead_every = max(2.0, min(4.0, radius * 11)); bead_phase = rc.random() * math.tau
    for i in range(1, n + 1):
        t = i / n
        twist = coil_axis.cross(d) * math.sin(i * 0.55 + coil_phase) * coil
        d = (d + rand_unit(r) * 0.22 + twist + Vector((0, 0, -droop * (0.4 + t)))).normalized()
        p = p + d * (length / n)
        # Slow taper with knuckles and burls: grown, biomechanical, not a clean twig.
        burl = 1 + 0.12 * math.sin(i * 1.7 + depth) + (0.4 if r.random() < 0.08 else 0.0)
        bead = 0.6 * max(0.0, math.sin(i / bead_every * math.tau + bead_phase)) ** 4
        taper = 0.45 if depth > 0 else 0.8          # the last twigs run out to points
        rad = radius * (1 - taper * t) * (burl + bead)
        idx = sk.add(p, max(rad, 0.003), idx)
        chain.append((idx, t, d.copy()))
    if depth <= 0:
        return
    kids = 2 + (1 if r.random() < 0.65 else 0) + (1 if depth >= 2 and r.random() < 0.5 else 0)
    for k in range(kids):
        idx0, t, dd = chain[min(len(chain) - 1, int(len(chain) * (0.35 + 0.55 * r.random())))]
        side = rand_unit(r); side = (side - dd * side.dot(dd)).normalized()
        cd = (dd * 0.55 + side * (0.8 + 0.4 * r.random()) + Vector((0, 0, 0.25))).normalized()
        grow(sk, r, sk.pos[idx0], idx0, cd, length * (0.55 + 0.2 * r.random()),
             sk.rad[idx0] * (0.8 if depth > 1 else 0.62), depth - 1, droop * 1.35 + 0.02, seg * 0.85)

BAKE_SIZE = {"shrub": 512, "fallen": 512}
def bake_bark(ob, name, kind, sk, children, sweep):
    """Bake the bark's relief into a tangent-space normal map on the game mesh: a round, dense
    sweep of the same skeleton with finer bark (ridges, pits, the knots) is the source. The
    game mesh is unwrapped into [0.03, 1]²; the corner below stays flat for what's attached
    afterwards (thorns, beads, scales), whose UVs sit at (0, 0)."""
    hi = sweep(name + "_hi", 3, lambda r: True, 4)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = hi; hi.select_set(True)
    bpy.ops.object.convert(target='MESH')
    bm = bmesh.new(); bm.from_mesh(hi.data)
    for i, kids in enumerate(children):
        if len(kids) < 2: continue
        verts = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=sk.rad[i] * 1.06)["verts"]
        bmesh.ops.translate(bm, vec=sk.pos[i], verts=verts)
    bm.to_mesh(hi.data); bm.free(); hi.data.update()
    from mathutils.kdtree import KDTree
    kd = KDTree(len(sk.pos))
    for i, p in enumerate(sk.pos): kd.insert(p, i)
    kd.balance()
    for v in hi.data.vertices:
        _, i, _ = kd.find(v.co)
        a = min(0.02, sk.rad[i] * 0.1)
        co = v.co
        # Coarse lumps, bark ridges stretched along the limb's length, fine pits.
        ridge = 1 - abs(noise.noise(Vector((co.x * 9, co.y * 9, co.z * 2.2))))
        pit = noise.noise(co * 42.0)
        v.co += v.normal * (noise.noise(co * 13.0) * a + (ridge ** 3 - 0.4) * a * 0.6 + pit * a * 0.2)
    hi.data.update()
    # Unwrap the game mesh, leaving the corner free.
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    uvl = ob.data.uv_layers.active.data
    for l in uvl: l.uv = l.uv * 0.97 + Vector((0.03, 0.03))
    size = BAKE_SIZE.get(kind, 1024)
    img = bpy.data.images.new(name + "_n", size, size, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    mat = bpy.data.materials.new(name + "_bark"); mat.use_nodes = True
    nt = mat.node_tree; bsdf = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tex.outputs["Color"], nmap.inputs["Color"]); nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    nt.nodes.active = tex
    ob.data.materials.clear(); ob.data.materials.append(mat)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'; scene.cycles.samples = 4
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = 0.04
    scene.render.bake.max_ray_distance = 0.12
    scene.render.bake.margin = 4
    bpy.ops.object.select_all(action='DESELECT')
    hi.select_set(True); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT')
    # The flat corner for attachments.
    px = list(img.pixels)
    for y in range(int(size * 0.025)):
        for x in range(int(size * 0.025)):
            k = (y * size + x) * 4
            px[k:k + 4] = [0.5, 0.5, 1.0, 1.0]
    img.pixels = px
    img.pack()
    scene.render.bake.use_selected_to_active = False
    bpy.data.objects.remove(hi)

def build_tree(name, seed, kind):
    r = random.Random(seed)
    sk = Skeleton()
    base = Vector((0, 0, -0.35))
    root = sk.add(base, 0.42 if kind != "shrub" else 0.16, -1)
    if kind == "tall":
        grow(sk, r, base, root, Vector((r.gauss(0, .12), r.gauss(0, .12), 1)).normalized(), 6.5, 0.34, 3, 0.03, 0.3)
    elif kind == "arch":
        # Two heavy limbs that lean out and bow back to the ground: the grove's "conduit arches".
        grow(sk, r, base, root, Vector((0.1, 0, 1)).normalized(), 2.2, 0.36, 0, 0.0, 0.3)
        top = len(sk.pos) - 1
        for s in (-1, 1):
            grow(sk, r, sk.pos[top], top, Vector((0.9 * s, r.gauss(0, .2), 0.55)).normalized(), 5.8, 0.25, 3, 0.11, 0.3)
    elif kind == "leaning":
        grow(sk, r, base, root, Vector((0.55, r.gauss(0, .2), 1)).normalized(), 5.5, 0.3, 2, 0.05, 0.3)
    elif kind == "shrub":
        for k in range(4):
            a = k / 4 * math.tau + r.random()
            grow(sk, r, base, root, Vector((math.cos(a) * 0.8, math.sin(a) * 0.8, 1)).normalized(), 1.7, 0.09, 1, 0.08, 0.16)
    elif kind == "fallen":
        grow(sk, r, base + Vector((0, 0, 0.3)), root, Vector((1, r.gauss(0, .1), 0.12)).normalized(), 6.0, 0.32, 1, 0.02, 0.3)

    # Relax only interior chain nodes; preserve roots, tips and branch junctions.
    # This removes the segmented hose silhouette without changing the kit's footprint.
    children = [[] for _ in sk.pos]
    for i, parent in enumerate(sk.parent):
        if parent >= 0: children[parent].append(i)
    for i, kids in enumerate(children):
        if not kids: sk.rad[i] = min(sk.rad[i], 0.003)
        elif len(kids) > 1: sk.rad[i] = max(sk.rad[i], max(sk.rad[k] for k in kids) * 0.9)
    for _ in range(3):
        points = [p.copy() for p in sk.pos]
        for i, kids in enumerate(children):
            if sk.parent[i] >= 0 and len(kids) == 1:
                mid = (points[sk.parent[i]] + points[kids[0]]) * 0.5
                sk.pos[i] = points[i].lerp(mid, 0.35)

    # Sweep connected branch paths. Blender's Skin modifier could leave open faces at
    # dense forks; smoothing/decimation then exposed conspicuous gaps in the trunk.
    # Two sweeps: limbs at eight sides, thin twigs (the last few centimetres thick) at four,
    # so the triangles go where they're seen. Joined after.
    def sweep(cname, sides_res, keep, res_u=2):
        curve = bpy.data.curves.new(cname, 'CURVE')
        curve.dimensions = '3D'; curve.resolution_u = res_u
        curve.bevel_depth = 1.0; curve.bevel_resolution = sides_res; curve.use_fill_caps = True
        for start, kids in enumerate(children):
            if sk.parent[start] >= 0 and len(kids) == 1: continue
            for child in kids:
                chain = [start, child]
                while len(children[chain[-1]]) == 1: chain.append(children[chain[-1]][0])
                if not keep(sk.rad[chain[1]]): continue
                spline = curve.splines.new('BEZIER'); spline.bezier_points.add(len(chain) - 1)
                for point, index in zip(spline.bezier_points, chain):
                    point.co = sk.pos[index]; point.radius = sk.rad[index]
                    point.handle_left_type = 'AUTO'; point.handle_right_type = 'AUTO'
        o = bpy.data.objects.new(cname, curve)
        bpy.context.scene.collection.objects.link(o)
        return o
    # Thick limbs (seen up close, silhouettes against the sky) at twelve sides.
    THIN, THICK = 0.03, 0.11
    ob = sweep(name, 2, lambda r: r >= THICK)
    mid = sweep(name + "_mid", 1, lambda r: THIN <= r < THICK, 1)
    twigs = sweep(name + "_twigs", 0, lambda r: r < THIN, 1)
    parts = [o for o in (ob, mid, twigs) if o.data.splines]
    for o in (mid, twigs):
        if o not in parts: bpy.data.objects.remove(o)
    if ob not in parts:  # (a tree with no thick limb)
        bpy.data.objects.remove(ob); ob = parts[0]
    for o in parts:
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = o
        o.select_set(True)
        bpy.ops.object.convert(target='MESH')
    if len(parts) > 1:
        bpy.ops.object.select_all(action='DESELECT')
        for o in parts: o.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.join()
    ob.name = name
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me)
    # Closed collars overlap every fork. A slight organic swelling also gives the
    # mineral crust a place to collect, as in the reference grove.
    for i, kids in enumerate(children):
        if len(kids) < 2: continue
        verts = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=sk.rad[i] * 1.06)["verts"]
        bmesh.ops.translate(bm, vec=sk.pos[i], verts=verts)
    bm.to_mesh(me); bm.free(); me.update()
    # Small geometric bark relief, limited on thin twigs so their tips remain intact.
    from mathutils.kdtree import KDTree
    centers = KDTree(len(sk.pos))
    for i, p in enumerate(sk.pos): centers.insert(p, i)
    centers.balance()
    for v in me.vertices:
        _, i, _ = centers.find(v.co)
        amount = min(0.014, sk.rad[i] * 0.08)
        v.co += v.normal * noise.noise(v.co * 13.0) * amount
    me.update()
    # The limbs get their share of the budget now; what's attached after (thorns, beads, scales)
    # is built lean and kept whole, since decimating it would erase the small detail first.
    bark_budget = int(TRIS * 0.8 * {"shrub": 0.5, "fallen": 0.75, "arch": 1.4}.get(kind, 1.0))
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    print(name, "bark tris", tris, "budget", bark_budget)
    if tris > bark_budget:
        dec = ob.modifiers.new("dec", 'DECIMATE'); dec.ratio = bark_budget / tris
        bpy.ops.object.modifier_apply(modifier="dec")
        me = ob.data
    if BAKE: bake_bark(ob, name, kind, sk, children, sweep)
    me = ob.data

    # Thorns (pointing out and slightly up the branch) and rust nodules along the branches.
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me); bm.normal_update()
    surface = BVHTree.FromBMesh(bm)
    crust_candidates = [(v.co.copy(), v.normal.copy()) for v in bm.verts
                        if v.co.z > 0.1 and noise.noise(v.co * 0.8) > -0.05]
    rust_verts, crust_verts, attach_verts = set(), set(), set()
    # Crowded, short thorns (the boards' limbs bristle), a few long ones among them.
    n_thorn = {"tall": 360, "arch": 400, "leaning": 330, "shrub": 200, "fallen": 260}[kind]
    for k in range(n_thorn):
        i = r.randrange(1, len(sk.pos))
        pa = sk.parent[i]
        if pa < 0: continue
        a, b = sk.pos[pa], sk.pos[i]
        t = r.random(); p = a.lerp(b, t); rad = sk.rad[pa] * (1 - t) + sk.rad[i] * t
        axis = (b - a).normalized()
        out = rand_unit(r); out = (out - axis * out.dot(axis)).normalized()
        nodule = r.random() < 0.1
        size = (rad * (0.8 + 0.7 * r.random()) + 0.02) if r.random() < 0.12 else (rad * (0.35 + 0.45 * r.random()) + 0.012)
        hit, normal, _, _ = surface.ray_cast(p, out, rad * 3 + 0.3)
        if hit is None: continue
        if nodule:
            geom = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=size * 0.55)
        else:
            geom = bmesh.ops.create_cone(bm, cap_ends=False, segments=5, radius1=size * 0.27, radius2=0.0, depth=size * 1.8)
        verts = geom["verts"]
        dirn = (normal + axis * 0.35).normalized()
        rot = Vector((0, 0, 1)).rotation_difference(dirn).to_matrix().to_4x4()
        off = hit + dirn * (size * 0.65 if not nodule else -size * 0.08)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(off) @ rot, verts=verts)
        attach_verts.update(verts)
        if nodule or r.random() < 0.18:
            rust_verts.update(verts)
    # Bead clusters: crowds of small round nodules crusting the limbs (the boards' beaded
    # bark), pale like the crust, packed on the surface round a few dozen spots per tree.
    bead_spots = 32 if kind != 'shrub' else 12
    for k in range(bead_spots):
        if not crust_candidates: break
        c, normal = r.choice(crust_candidates)
        _, ci, _ = centers.find(c)
        lr = max(0.02, sk.rad[ci])
        tang = rand_unit(r); tang = (tang - normal * tang.dot(normal)).normalized()
        bit = normal.cross(tang)
        spread = lr * r.uniform(0.6, 1.3)
        for j in range(r.randint(6, 16)):
            a = r.random() * math.tau; dist = spread * math.sqrt(r.random())
            q = c + (tang * math.cos(a) + bit * math.sin(a)) * dist
            hit, nrm, _, _ = surface.ray_cast(q + normal * lr * 0.6, -normal, lr * 1.8)
            if hit is None: continue
            size = lr * r.uniform(0.09, 0.2) * (1.25 - dist / spread * 0.5)
            verts = bmesh.ops.create_icosphere(bm, subdivisions=0, radius=size)["verts"]
            bmesh.ops.translate(bm, vec=hit + nrm * size * 0.45, verts=verts)
            crust_verts.update(verts); attach_verts.update(verts)
    # Thin, overlapping mineral scales break the silhouette and catch the low sun.
    # Attach to the evaluated bark surface rather than floating around the branch centreline.
    for k in range(60 if kind == 'shrub' else 150):
        if not crust_candidates: break
        p, normal = r.choice(crust_candidates)
        size = r.uniform(0.025, 0.085)
        verts = bmesh.ops.create_icosphere(bm, subdivisions=0, radius=1)["verts"]
        rot = Vector((0, 0, 1)).rotation_difference(normal).to_matrix().to_4x4()
        scale = Matrix.Diagonal((size, size * r.uniform(0.45, 0.8), size * 0.12, 1))
        bmesh.ops.transform(bm, matrix=Matrix.Translation(p + normal * size * 0.025) @ rot @ scale, verts=verts)
        crust_verts.update(verts); attach_verts.update(verts)
    bm.verts.index_update()
    rust_vi = [v.index for v in rust_verts]
    crust_vi = [v.index for v in crust_verts]
    attach_vi = [v.index for v in attach_verts]
    bm.to_mesh(me); bm.free()
    # Carry the rust marks through decimation as a vertex group.
    vg = ob.vertex_groups.new(name="rust")
    if rust_vi: vg.add(rust_vi, 1.0, 'REPLACE')
    vg = ob.vertex_groups.new(name="mineral_scales")
    if crust_vi: vg.add(crust_vi, 1.0, 'REPLACE')
    # Everything attached to the limbs: the far silhouettes leave it off (decimated, loose bits
    # collapse into big stray shards).
    vg = ob.vertex_groups.new(name="attached")
    if attach_vi: vg.add(attach_vi, 1.0, 'REPLACE')

    # Only if the attachments ran far over (they're already lean): decimate to a ceiling.
    budget = int(TRIS * 1.75 * {"shrub": 0.5, "fallen": 0.75, "arch": 1.25}.get(kind, 1.0))
    tris = sum(len(p.vertices) - 2 for p in me.polygons)
    print(name, "with attachments", tris, "ceiling", budget)
    if tris > budget:
        dec = ob.modifiers.new("dec", 'DECIMATE'); dec.ratio = budget / tris
        bpy.ops.object.modifier_apply(modifier="dec")
    # Decimation can leave obsolete edge/custom-data entries. Clean these
    # before painting/baking masks, rather than letting the exporter repair them later.
    me.validate()
    me.update()
    for p in me.polygons: p.use_smooth = True

    # Masks: G = crust (up-facing + noise), B = rust (nodules/thorn tips + noise). R = AO (baked).
    col = me.color_attributes.new("Col", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = col
    gi = ob.vertex_groups["rust"].index
    ci = ob.vertex_groups["mineral_scales"].index
    rust_v = {v.index for v in me.vertices if any(g.group == gi and g.weight > 0.5 for g in v.groups)}
    crust_v = {v.index for v in me.vertices if any(g.group == ci and g.weight > 0.5 for g in v.groups)}
    for v in me.vertices:
        p = v.co
        up = max(0.0, v.normal.z)
        crust = 1.0 if v.index in crust_v else max(0.0, min(1.0,
            0.46 + noise.noise(p * 0.9) * 0.85 + up * 0.24 + noise.noise(p * 5.5) * 0.08))
        rust = 1.0 if v.index in rust_v else max(0.0, min(1.0, (noise.noise(p * 3.1 + Vector((9, 9, 9))) - 0.35) * 2.2))
        col.data[v.index].color = (1.0, crust, rust, 1.0)
    return ob

KIT = [("tree_tall_a", 11, "tall"), ("tree_tall_b", 23, "tall"), ("tree_arch_a", 37, "arch"),
       ("tree_arch_b", 41, "arch"), ("tree_leaning", 53, "leaning"), ("shrub_a", 61, "shrub"),
       ("shrub_b", 67, "shrub"), ("log_fallen", 71, "fallen")]
objs = []
for i, (n, seed, kind) in enumerate(KIT):
    ob = build_tree(n, seed, kind)
    ob.location.x = i * 12   # spread out so AO bakes don't shadow each other
    objs.append(ob)
    print(n, "tris", sum(len(p.vertices) - 2 for p in ob.data.polygons))

# Bake ambient occlusion into R of the vertex colours (a ground plane under each tree).
bpy.ops.mesh.primitive_plane_add(size=200, location=(40, 0, -0.35))
ground = bpy.context.object
scene = bpy.context.scene
scene.render.engine = 'CYCLES'; scene.cycles.samples = 48
for ob in objs:
    me = ob.data
    ao = me.color_attributes.new("AO", 'BYTE_COLOR', 'POINT')
    me.color_attributes.active_color = ao
    if not me.materials:
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

# Low-detail copies of the big forms for the far ring (giant silhouettes deep in the haze):
# the same shape, baked colours carried through, at about a ninth of the triangles.
FAR_TRIS = 2000
for ob in [o for o in objs if o.name.startswith("tree_")]:
    far = ob.copy(); far.data = ob.data.copy()
    far.name = far.data.name = ob.name + "_far"
    bpy.context.collection.objects.link(far)
    bpy.ops.object.select_all(action='DESELECT'); far.select_set(True); bpy.context.view_layer.objects.active = far
    ai = far.vertex_groups["attached"].index if "attached" in far.vertex_groups else -1
    bm = bmesh.new(); bm.from_mesh(far.data)
    dl = bm.verts.layers.deform.active
    if dl is not None and ai >= 0:
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v[dl].get(ai, 0.0) > 0.5], context='VERTS')
    bm.to_mesh(far.data); bm.free(); far.data.update()
    tris = sum(len(p.vertices) - 2 for p in far.data.polygons)
    dec = far.modifiers.new("dec", 'DECIMATE'); dec.ratio = min(1.0, FAR_TRIS / tris)
    bpy.ops.object.modifier_apply(modifier="dec")
    print(far.name, "tris", sum(len(p.vertices) - 2 for p in far.data.polygons))
    objs.append(far)

bpy.ops.object.select_all(action='DESELECT')
for ob in objs: ob.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_yup=True,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False, export_materials='EXPORT' if BAKE else 'NONE',
                          export_normals=True, export_texcoords=BAKE, export_tangents=BAKE, export_image_format='WEBP')
print("GROVE_OK", OUT)
