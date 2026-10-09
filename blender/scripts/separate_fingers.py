"""Give the image-to-3D body separate fingers.

The scan's index/middle/ring/pinky are fused by skin webbing up to about mid-finger, and the
mesh there is too coarse and ambiguous to cut apart cleanly. So those four fingers are rebuilt:
1. each hand vertex is assigned to its nearest finger segment (bone rest positions);
2. the fused finger geometry past the knuckles is removed and the palm is capped;
3. each finger is regenerated as a tapered tube along its three bones: an oval cross-section
   (flatter dorso-palmar, width limited by the space to its neighbours), slight knuckle
   bulges, a rounded tip. Its base sinks into the palm like a ceramic joint, which suits her
   plated body;
4. every new vertex takes its UV from the nearest point of the original surface (so the
   painted plates and the normal map carry over) and is weighted to its own finger's bones,
   blended at the joints and into the hand at the base.
The thumb was never fused and keeps its original geometry.

Usage: Blender -b -P separate_fingers.py -- <woman_rigged.blend>
"""
import bpy, bmesh, sys, math
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_point_line
from mathutils.geometry import barycentric_transform

blend = sys.argv[sys.argv.index("--") + 1:][0]
bpy.ops.wm.open_mainfile(filepath=blend)
body = bpy.data.objects["Woman"]
arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
M = body.matrix_world
Mi = M.inverted()
FINGERS = ["Index", "Middle", "Ring", "Pinky"]
CUT = 0.22            # remove original finger geometry past this fraction of the proximal phalanx
RING_STEP = 0.0045    # metres between cross-sections
SIDES = 12
bone = {b.name: (arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local) for b in arm.data.bones}
bone0 = dict(bone)   # as detected: where the fused finger mass is (used for cutting)

# Finger bones, rebuilt with anatomical proportions. Tip detection on the fused mesh left the
# ring and pinky crooked and too short, with their knuckles almost on top of each other.
RATIO = {"Index": 0.94, "Middle": 1.0, "Ring": 0.95, "Pinky": 0.76}     # of the middle finger
FAN = {"Index": 4.0, "Middle": 0.0, "Ring": -3.0, "Pinky": -7.0}       # spread, degrees
RECEDE = {"Index": -0.002, "Middle": 0.003, "Ring": -0.001, "Pinky": -0.008}  # knuckle arc
PHAL = (0.46, 0.30, 0.24)
CURL = (14.0, 18.0, 12.0)                                              # rest flexion, degrees
from mathutils import Matrix
new_bones = {}
for side in ("Left", "Right"):
    g = lambda n: bone0[f"{side}Hand{n}"]
    ki, kp = g("Index1")[0], g("Pinky1")[0]
    mid_dir = (g("Middle3")[1] - g("Middle1")[0]).normalized()
    hand_dir = (g("Middle1")[0] - bone0[f"{side}Hand"][0]).normalized()
    d0 = (mid_dir + hand_dir).normalized()
    across = (ki - kp); across -= d0 * across.dot(d0); across.normalize()
    palm_n0 = across.cross(d0).normalized()
    if (g("Middle3")[1] - g("Middle1")[0]).dot(palm_n0) < 0 and (g("Index3")[1] - g("Index1")[0]).dot(palm_n0) < 0:
        palm_n0 = -palm_n0
    mtot = sum((g(f"Middle{i}")[1] - g(f"Middle{i}")[0]).length for i in (1, 2, 3))
    mtot = max(0.074, min(0.09, mtot))
    for j, f in enumerate(["Index", "Middle", "Ring", "Pinky"]):
        k = ki.lerp(kp, j / 3.0) + d0 * RECEDE[f]
        fa = math.radians(FAN[f])          # + fans toward the index side (`across` points pinky -> index)
        d = (d0 * math.cos(fa) + across * math.sin(fa)).normalized()
        axis = d.cross(palm_n0).normalized()        # flexion axis
        p = k.copy()
        for i in range(3):
            d = Matrix.Rotation(math.radians(CURL[i]), 3, axis) @ d
            q = p + d * (mtot * RATIO[f] * PHAL[i])
            new_bones[f"{side}Hand{f}{i+1}"] = (p.copy(), q.copy())
            p = q
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
AWi = arm.matrix_world.inverted()
eb = arm.data.edit_bones
for n, (h, t) in new_bones.items():
    e = eb[n]
    e.use_connect = False
    e.head = AWi @ h; e.tail = AWi @ t
for side in ("Left", "Right"):
    tip = eb.get(f"{side}IndexTip")
    if tip:
        h, t = new_bones[f"{side}HandIndex3"]
        dd = (t - h).normalized()
        tip.head = AWi @ t; tip.tail = AWi @ (t + dd * 0.01)
bpy.ops.object.mode_set(mode='OBJECT')
bone = {b.name: (arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local) for b in arm.data.bones}

me = body.data
bm = bmesh.new()
bm.from_mesh(me)
bm.verts.ensure_lookup_table(); bm.faces.ensure_lookup_table()
deform = bm.verts.layers.deform.active
uvl = bm.loops.layers.uv.active
new_geo = bm.faces.layers.int.new("new_geo")

# Original surface for UV lookup (world space), before anything changes.
orig = bm.copy()
orig.transform(M)
bmesh.ops.triangulate(orig, faces=orig.faces[:])
orig.faces.ensure_lookup_table()
bvh = BVHTree.FromBMesh(orig)
ouv = orig.loops.layers.uv.active

vg = {g.name: g.index for g in body.vertex_groups}


def group(n):
    if n not in vg:
        vg[n] = body.vertex_groups.new(name=n).index
    return vg[n]


def face_uvs(face):
    """UVs for a new face, all read from the one original triangle nearest its centre
    (extrapolated linearly), so a face never straddles two islands of the texture atlas."""
    c = M @ face.calc_center_median()
    _, _, fi, _ = bvh.find_nearest(c)
    t = orig.faces[fi]
    A, B, C = (v.co for v in t.verts)
    ua, ub, uc = (Vector((l[ouv].uv.x, l[ouv].uv.y, 0.0)) for l in t.loops)
    for l in face.loops:
        q = barycentric_transform(M @ l.vert.co, A, B, C, ua, ub, uc)
        l[uvl].uv = (q.x, q.y)


made = 0
for side in ("Left", "Right"):
    segs = []
    for f in FINGERS + ["Thumb"]:
        for i in (1, 2, 3):
            a, b = bone0[f"{side}Hand{f}{i}"]
            segs.append((f, i, a, b))
    wrist = bone0[f"{side}Hand"][0]
    owner = {}
    for v in bm.verts:
        p = M @ v.co
        if (p - wrist).length > 0.22: continue
        best, bd = None, 1e9
        for f, i, a, b in segs:
            _, t = intersect_point_line(p, a, b)
            t = max(0.0, min(1.0, t)); q = a.lerp(b, t)
            d = (p - q).length
            if d < bd: bd, best = d, (f, i, t, q, d)
        if bd < 0.035: owner[v] = best

    # Palm frame: across the knuckles, and the palm normal (toward the palm side).
    k_index, k_pinky = bone[f"{side}HandIndex1"][0], bone[f"{side}HandPinky1"][0]
    across = (k_index - k_pinky).normalized()
    fwd = (bone[f"{side}HandMiddle1"][1] - bone[f"{side}HandMiddle1"][0]).normalized()
    palm_n = across.cross(fwd).normalized()
    # Make palm_n point to the palm: the fingers' rest curl bends that way.
    m1, m3 = bone[f"{side}HandMiddle1"][0], bone[f"{side}HandMiddle3"][1]
    if (m3 - m1).dot(palm_n) < 0: palm_n = -palm_n

    # Cross-section sizes from the original (median distance of each finger's own vertices;
    # the web inflates them, so lateral size is also capped by the neighbour spacing).
    size = {}
    for v, (f, i, t, q, d) in owner.items():
        if f == "Thumb": continue
        size.setdefault((f, i), []).append(d)
    size = {k: sorted(r)[int(len(r) * 0.6)] for k, r in size.items()}
    axes = {f: [bone[f"{side}Hand{f}1"][0], bone[f"{side}Hand{f}2"][0], bone[f"{side}Hand{f}3"][0], bone[f"{side}Hand{f}3"][1]] for f in FINGERS}

    # 2. Remove the fused fingers past the knuckles; cap the palm.
    def free(v):
        o = owner.get(v)
        return o is not None and o[0] != "Thumb" and (o[1] > 1 or o[2] > CUT)
    kill = [f for f in bm.faces if any(free(v) for v in f.verts)]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    # Relax the cut edge so the cap has no spikes.
    bnd_v = {v for e in bm.edges if e.is_boundary for v in e.verts if (M @ v.co - wrist).length < 0.2}
    for _ in range(3):
        new_co = {}
        for v in bnd_v:
            nb = [e.other_vert(v) for e in v.link_edges if e.is_boundary]
            if len(nb) == 2: new_co[v] = v.co * 0.5 + (nb[0].co + nb[1].co) * 0.25
        for v, c in new_co.items(): v.co = c
    edges = [e for e in bm.edges if e.is_boundary and all((M @ v.co - wrist).length < 0.2 for v in e.verts)]
    caps = bmesh.ops.holes_fill(bm, edges=edges, sides=0)["faces"]
    caps = bmesh.ops.triangulate(bm, faces=caps, quad_method='BEAUTY', ngon_method='BEAUTY')["faces"]
    for f in caps:
        f.smooth = True
        f[new_geo] = 1
        if uvl: face_uvs(f)

    # 3. Rebuild each finger.
    for fi, f in enumerate(FINGERS):
        pts = axes[f]
        L = [(pts[k + 1] - pts[k]).length for k in range(3)]
        total = sum(L)
        # Smooth centreline through the joints (Catmull-Rom), sampled by arc length.
        P = [pts[0] * 2 - pts[1]] + pts + [pts[3] * 2 - pts[2]]
        def cr(seg, u):
            p0, p1, p2, p3 = P[seg], P[seg + 1], P[seg + 2], P[seg + 3]
            return 0.5 * ((2 * p1) + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u * u + (-p0 + 3 * p1 - 3 * p2 + p3) * u ** 3)
        def centre(k, t):
            return cr(k, t)
        # Neighbour spacing caps the width.
        nbrs = [axes[g][0] for g in FINGERS if g != f]
        spacing = min((pts[0] - n).length for n in nbrs)
        start = -0.012          # begin inside the palm
        rings = []
        s = start
        while s <= total + 1e-6:
            rings.append(s); s += RING_STEP
        tip_r = None
        verts_rings = []
        for s in rings:
            ss = max(0.0, s)
            k = 0
            while k < 2 and ss > L[k]: ss -= L[k]; k += 1
            t = min(1.0, ss / L[k])
            if s >= 0:
                c = centre(k, t)
                tan = (centre(k, min(1.0, t + 0.02)) - centre(k, max(0.0, t - 0.02))).normalized()
            else:
                tan = (pts[1] - pts[0]).normalized()
                c = pts[0] + tan * s
            n = (palm_n - tan * palm_n.dot(tan)).normalized()
            lat = tan.cross(n).normalized()
            # Anatomical half-widths for a hand this size (the scan's own are inflated by the web).
            hand = sum((axes["Middle"][q + 1] - axes["Middle"][q]).length for q in range(3)) / 0.08
            base_w = {"Index": 0.0086, "Middle": 0.0089, "Ring": 0.0083, "Pinky": 0.0073}[f] * max(0.85, min(1.15, hand))
            taper = 1.0 - 0.22 * (max(0.0, s) / total)
            w = min(base_w * taper, spacing * 0.5)                           # lateral
            h = w * 0.88                                                      # dorso-palmar
            # Knuckle bulge at the joints.
            jd = min(abs(max(0.0, s) - sum(L[:j])) for j in (1, 2))
            bulge = 1.0 + 0.07 * max(0.0, 1 - jd / 0.006)
            # Round the tip over its last few millimetres.
            rem = total - max(0.0, s)
            tipk = math.sqrt(max(0.0, min(1.0, rem / (h * 1.2))))
            ring = []
            for j in range(SIDES):
                a = 2 * math.pi * j / SIDES
                off = lat * (math.cos(a) * w) + n * (math.sin(a) * h * (0.92 if math.sin(a) < 0 else 1.0))
                ring.append(c + off * bulge * max(0.15, tipk))
            verts_rings.append((ring, k, t, s, c))
        # Tip cap point.
        tip = pts[3] + (pts[3] - pts[2]).normalized() * 0.001

        new = []
        for ring, k, t, s, c in verts_rings:
            new.append([bm.verts.new(Mi @ p) for p in ring])
        tv = bm.verts.new(Mi @ tip)
        faces = []
        for r in range(len(new) - 1):
            A, B = new[r], new[r + 1]
            for j in range(SIDES):
                faces.append(bm.faces.new((A[j], A[(j + 1) % SIDES], B[(j + 1) % SIDES], B[j])))
        last = new[-1]
        for j in range(SIDES):
            faces.append(bm.faces.new((last[j], last[(j + 1) % SIDES], tv)))
        for fc in faces:
            fc.smooth = True
            fc[new_geo] = 1

        # 4. UVs from the original surface, weights along the chain.
        names = [f"{side}Hand{f}{k}" for k in (1, 2, 3)]
        def weights(k, t, s):
            if s < 0.004:
                b = min(1.0, max(0.0, (0.004 - s) / 0.012)) * 0.6
                return {names[0]: 1 - b, f"{side}Hand": b}
            w = {names[k]: 1.0}
            if t < 0.15 and k > 0:
                b = 0.5 * (1 - t / 0.15); w = {names[k]: 1 - b, names[k - 1]: b}
            elif t > 0.85 and k < 2:
                b = 0.5 * (t - 0.85) / 0.15; w = {names[k]: 1 - b, names[k + 1]: b}
            return w
        for (ring, k, t, s, c), vs in zip(verts_rings, new):
            for v in vs:
                dv = v[deform]
                for nme, x in weights(k, t, s).items(): dv[group(nme)] = x
        tv[deform][group(names[2])] = 1.0
        if uvl:
            # Where each new vertex sits on its finger (segment, fraction, axis point).
            info = {}
            for (ring, k, t, s_, c), vs in zip(verts_rings, new):
                for v in vs: info[v] = (k, t, c)
            info[tv] = (2, 1.0, pts[3])
            o_pts = [bone0[f"{side}Hand{f}{i}"] for i in (1, 2, 3)]
            def o_axis(k, t):
                return o_pts[k][0].lerp(o_pts[k][1], t)
            for fc in faces:
                # Ray from the ORIGINAL finger's axis, outward in this face's direction: the
                # hit is where this patch of finger was painted on the fused scan.
                cw = M @ fc.calc_center_median()
                ks = [info[v] for v in fc.verts]
                ac = sum((x[2] for x in ks), Vector()) / len(ks)
                kt = max(ks, key=lambda x: (x[0], x[1]))
                radial = cw - ac
                if radial.length < 1e-6:
                    face_uvs(fc); continue
                radial.normalize()
                o = o_axis(kt[0], kt[1])
                hit, _, fi_, _ = bvh.ray_cast(o, radial, 0.04)
                if hit is None:
                    face_uvs(fc); continue
                tri_ = orig.faces[fi_]
                A, B, C = (v.co for v in tri_.verts)
                ua, ub, uc = (Vector((l[ouv].uv.x, l[ouv].uv.y, 0.0)) for l in tri_.loops)
                nrm = (B - A).cross(C - A).normalized()
                for l in fc.loops:
                    k_, t_, a_ = info[l.vert]
                    rd = (M @ l.vert.co) - a_
                    rd = rd.normalized() if rd.length > 1e-6 else radial
                    oo = o_axis(k_, t_)
                    den = rd.dot(nrm)
                    q = oo + rd * ((A - oo).dot(nrm) / den) if abs(den) > 1e-4 else hit
                    uvq = barycentric_transform(q, A, B, C, ua, ub, uc)
                    l[uvl].uv = (uvq.x, uvq.y)
        made += len(faces)
    print(side, "fingers rebuilt; removed", len(kill), "cap tris", len(caps))

bm.normal_update()
bm.to_mesh(me)
bm.free(); orig.free()
me.update()
# The imported body carries custom (split) normals; the new fingers and caps have none, which
# renders them faceted. Old corners keep theirs; everything touching the hands' new geometry
# gets smooth vertex normals.
flag = me.attributes["new_geo"].data
hand_v = set()
for poly in me.polygons:
    if flag[poly.index].value:
        hand_v.update(me.loops[li].vertex_index for li in poly.loop_indices)
normals = []
for poly in me.polygons:
    for li in poly.loop_indices:
        vi = me.loops[li].vertex_index
        normals.append(me.vertices[vi].normal.copy() if vi in hand_v else me.corner_normals[li].vector.copy())
me.normals_split_custom_set(normals)
me.attributes.remove(me.attributes["new_geo"])
bpy.ops.wm.save_as_mainfile(filepath=blend)
print("FINGERS_OK faces", made)
