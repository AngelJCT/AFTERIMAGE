"""Locate the painted eyes on the head mesh (blue iris + pale sclera, read from its texture)
and store their openings on the object as glTF extras for the game's shader eyelids.
Usage: Blender -b -P eye_data.py -- <rigged.blend>"""
import bpy, sys, json
import numpy as np

blend = sys.argv[sys.argv.index("--") + 1]
bpy.ops.wm.open_mainfile(filepath=blend)
head = bpy.data.objects["WomanHead"]
me = head.data
img = [n.image for n in head.active_material.node_tree.nodes if n.type == 'TEX_IMAGE' and 'basecolor' in (n.image.name if n.image else '')][0]
W, H = img.size
px = np.empty(W * H * 4, dtype=np.float32); img.pixels.foreach_get(px); px = px.reshape(H, W, 4)[..., :3]
co = np.empty(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
M = np.array(head.matrix_world); co = (M[:3, :3] @ co.T).T + M[:3, 3]
uv = np.zeros((len(me.vertices), 2), dtype=np.float32)
uvd = me.uv_layers.active.data
for l in me.loops: uv[l.vertex_index] = uvd[l.index].uv[:]
c = px[np.clip((uv[:, 1] * (H - 1)).astype(int), 0, H - 1), np.clip((uv[:, 0] * (W - 1)).astype(int), 0, W - 1)]
r, g, b = c[:, 0], c[:, 1], c[:, 2]

import os
# Eye band (metres at the 1.65 m working scale) and iris colour: her blue eyes by default;
# EYE_IRIS=dark for brown eyes (the child), with a band that stops under a dark fringe.
zlo, zhi = (float(v) for v in os.environ.get("EYE_BAND", "1.43,1.55").split(","))
face = (co[:, 1] < -0.06) & (co[:, 2] > zlo) & (co[:, 2] < zhi) & (np.abs(co[:, 0]) < 0.07)
if os.environ.get("EYE_IRIS") == "dark":
    iris = face & ((r + g + b) / 3 < 0.36)
else:
    iris = face & (b - r > 0.12) & (b > 0.25)
print("iris verts", int(iris.sum()))
out = {}
for side, sgn in (("L", 1), ("R", -1)):          # her left = +X
    m = iris & (np.sign(co[:, 0]) == sgn)
    if m.sum() < 5:
        print("eye not found", side); continue
    p = co[m]
    cen = np.median(p, axis=0)
    iris_r = float(np.percentile(np.abs(p[:, 0] - cen[0]), 90))
    # Opening: pale sclera + iris around the iris centre.
    near = face & (np.abs(co[:, 0] - cen[0]) < iris_r * 3.2) & (np.abs(co[:, 2] - cen[2]) < iris_r * 1.8)
    lum = (r + g + b) / 3
    sclera = near & (lum > 0.62) & ((np.max(c, 1) - np.min(c, 1)) < 0.12)
    op = co[m | sclera]
    hw = float(max(iris_r * 1.6, (np.percentile(op[:, 0], 97) - np.percentile(op[:, 0], 3)) / 2))
    top = float(np.percentile(op[:, 2], 96)); bot = float(np.percentile(op[:, 2], 4))
    cx = float((np.percentile(op[:, 0], 97) + np.percentile(op[:, 0], 3)) / 2)
    cz = (top + bot) / 2
    hh = float(max(iris_r * 0.9, (top - bot) / 2))
    cy = float(np.median(co[face & (np.abs(co[:, 0] - cx) < hw) & (np.abs(co[:, 2] - cz) < hh), 1]))
    # Lid skin: just above the opening.
    lidm = face & (np.abs(co[:, 0] - cx) < hw * 0.8) & (co[:, 2] > top + 0.002) & (co[:, 2] < top + 0.007)
    lid = np.median(c[lidm], axis=0) if lidm.sum() > 3 else np.array([0.85, 0.75, 0.72])
    # glTF space: (x, z, -y)
    out[side] = {"c": [cx, cz, -cy], "hw": hw, "hh": hh, "iris": iris_r, "lid": [float(v) for v in lid]}
    print(side, {k: (np.round(v, 4).tolist() if isinstance(v, (list, np.ndarray)) else round(v, 4)) for k, v in out[side].items()})
head["eyes"] = json.dumps(out)
bpy.ops.wm.save_as_mainfile(filepath=blend)
print("EYES_OK")

# ── Shape key "eyesClosed": relax the sculpted iris dome into a smooth lid surface.
import bmesh
from mathutils import Vector
me = head.data
if me.shape_keys is None:
    head.shape_key_add(name="Basis", from_mix=False)
key = me.shape_keys.key_blocks.get("eyesClosed") or head.shape_key_add(name="eyesClosed", from_mix=False)
basis = me.shape_keys.key_blocks["Basis"]
for i in range(len(key.data)): key.data[i].co = basis.data[i].co.copy()
bm = bmesh.new(); bm.from_mesh(me); bm.verts.ensure_lookup_table()
Minv = np.linalg.inv(M)
region = {}
for side, e in out.items():
    cx, cz, gz = e["c"]; cy = -gz                    # back to Blender (x, y, z)
    hw, hh = e["hw"] * 1.2, e["hh"] * 1.35
    if side == "R":                                  # the fringe hides part of it: use the left size
        hw, hh = max(hw, out.get("L", e)["hw"] * 1.2), max(hh, out.get("L", e)["hh"] * 1.35)
    for i, p in enumerate(co):
        u = (p[0] - cx) / hw; v = (p[2] - cz) / hh
        r2 = u * u + v * v
        # Only the face surface: hair strands hanging in front of the eye stay put.
        if r2 < 1.0 and cy - 0.005 < p[1] < cy + 0.012:
            region[i] = max(region.get(i, 0.0), 1.0 - r2)   # falloff weight toward the rim
pos = {i: Vector(co[i]) for i in region}
for _ in range(40):                                   # Laplacian relax, rim held by the falloff
    nxt = {}
    for i in region:
        v = bm.verts[i]
        nb = [pos.get(e.other_vert(v).index, Vector(co[e.other_vert(v).index])) for e in v.link_edges]
        if not nb: continue
        avg = sum(nb, Vector()) / len(nb)
        nxt[i] = pos[i].lerp(avg, 0.6 * min(1.0, region[i] * 2.5))
    pos.update(nxt)
# A lid rides over a round eyeball: push the relaxed surface forward (face direction, not the
# noisy vertex normals), most at the centre, then relax again so it stays smooth.
fwd = Vector((0.0, -1.0, 0.0))
for i, p in pos.items():
    w = min(1.0, region[i] * 1.6)
    pos[i] = p + fwd * (0.0018 * w * w)
for _ in range(15):
    nxt = {}
    for i in region:
        v = bm.verts[i]
        nb = [pos.get(e.other_vert(v).index, Vector(co[e.other_vert(v).index])) for e in v.link_edges]
        if nb: nxt[i] = pos[i].lerp(sum(nb, Vector()) / len(nb), 0.5 * min(1.0, region[i] * 2.5))
    pos.update(nxt)
for i, p in pos.items():
    local = Minv @ np.array([p.x, p.y, p.z, 1.0])
    key.data[i].co = Vector(local[:3])
bm.free()
print("eyesClosed shape key verts", len(region))
bpy.ops.wm.save_as_mainfile(filepath=blend)
print("EYELIDS_OK")
