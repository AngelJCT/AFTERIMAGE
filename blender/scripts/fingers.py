"""Finger joints from surface (geodesic) distance on the hand. Appends to joints.json.
Usage: python fingers.py prep.npz joints.json"""
import sys, json, heapq, os
import numpy as np

dat = np.load(sys.argv[1]); co = dat["co"]; edges = dat["edges"]
J = json.load(open(sys.argv[2]))
S = np.array(J["LeftArm"]); tip = np.array(J["_fingertip"])
d = tip - S; L = np.linalg.norm(d); d /= L
rel = co - S; t = rel @ d
radial = np.linalg.norm(rel - np.outer(t, d), axis=1)
arm = (co[:, 0] > 0.08) & (t > 0) & (t < L + 0.02) & (radial < 0.09)
if os.environ.get("HAND_SKIN") and "col" in dat.files:
    # Bare skin only (a coat sleeve and its cuff sit right against a child's hand).
    c = dat["col"]; r, g, b = c[:, 0], c[:, 1], c[:, 2]
    skin = (r > 0.45) & (b > 0.3) & (g > b) & (r - b > 0.08) & (r - b < 0.4)
    arm &= skin | (t < 0.55 * L)

if os.environ.get("HAND_MODE") == "anatomic":
    # Clean scan fingers pressed together (the child): tips can't be told apart on the mesh,
    # so place the finger joints anatomically from the wrist, the lowest fingertip and the
    # measured palm. Bone-heat weighting then binds the scan's own fingers to them.
    Wp = np.array(J["LeftHand"]); T = np.array(J["_fingertip"])
    h = T - Wp; HL = float(np.linalg.norm(h)); h /= HL
    across = np.array([0.0, -1.0, 0.0]); across -= h * (across @ h); across /= np.linalg.norm(across)   # pinky -> index (thumbs forward in A-pose)
    palm_n = np.cross(across, h); palm_n /= np.linalg.norm(palm_n)
    if palm_n[0] > 0: palm_n = -palm_n                # the palm faces her thigh
    rel = co - Wp; sv = rel @ h
    sl = arm & (np.abs(sv - 0.45 * HL) < 0.006) & (np.linalg.norm(rel - np.outer(sv, h), axis=1) < 0.06)
    q = rel[sl] @ across
    k_index = Wp + h * 0.45 * HL + across * np.percentile(q, 85) * 0.8
    k_pinky = Wp + h * 0.43 * HL + across * np.percentile(q, 15) * 0.8
    mid_len = 0.55 * HL
    RATIO = {"Index": 0.94, "Middle": 1.0, "Ring": 0.95, "Pinky": 0.76}
    PHAL = (0.46, 0.30, 0.24)
    for j, f in enumerate(["Index", "Middle", "Ring", "Pinky"]):
        k = k_index + (k_pinky - k_index) * (j / 3.0)
        d = h.copy(); p = k.copy()
        J[f"LeftHand{f}1"] = p.tolist()
        for i in range(3):
            p = p + d * mid_len * RATIO[f] * PHAL[i]
            J[f"LeftHand{f}{i + 2}"] = p.tolist()
    t0 = Wp + h * 0.14 * HL + across * np.percentile(q, 85) * 0.55 + palm_n * 0.01
    td = h * 0.55 + across * 0.8 + palm_n * 0.2; td /= np.linalg.norm(td)
    tl = 0.5 * HL
    for i, f in enumerate((0.0, 0.4, 0.72, 1.0), 1):
        J[f"LeftHandThumb{i}"] = (t0 + td * tl * f).tolist()
    J["_wristT"] = float((Wp - S) @ ((T - S) / np.linalg.norm(T - S)))
    json.dump(J, open(sys.argv[2], "w"), indent=1)
    print("anatomic hand: length", round(HL * 100, 1), "cm, palm width", round((np.percentile(q, 85) - np.percentile(q, 15)) * 100, 1), "cm")
    sys.exit(0)

# Wrist = narrowest section before the palm widens (see profile), searched in 0.62–0.78 L.
u = np.cross(d, [0, 0, 1]); u /= np.linalg.norm(u); v = np.cross(d, u)
best, wt = 9, None
for b in np.arange(0.62 * L, 0.78 * L, 0.004):
    m = arm & (np.abs(t - b) < 0.003)
    if m.sum() < 8: continue
    p = rel[m]; area = np.ptp(p @ u) * np.ptp(p @ v)
    if area < best: best, wt = area, b
wt += 0.012  # wrist joint sits just below the narrowest point
hand = arm & (t > wt - 0.015)
idx = np.nonzero(hand)[0]
local = -np.ones(len(co), dtype=np.int64); local[idx] = np.arange(len(idx))
adj = [[] for _ in idx]
for a, b in edges:
    la, lb = local[a], local[b]
    if la >= 0 and lb >= 0:
        w = float(np.linalg.norm(co[a] - co[b]))
        adj[la].append((lb, w)); adj[lb].append((la, w))
src = [i for i, g in enumerate(idx) if abs(t[g] - wt) < 0.004]
dist = np.full(len(idx), np.inf); prev = -np.ones(len(idx), dtype=np.int64)
pq = [(0.0, s) for s in src]
for s in src: dist[s] = 0
while pq:
    dd, a = heapq.heappop(pq)
    if dd > dist[a]: continue
    for b, w in adj[a]:
        nd = dd + w
        if nd < dist[b]: dist[b] = nd; prev[b] = a; heapq.heappush(pq, (nd, b))
P = co[idx]
fin = np.isfinite(dist)
# Tips: local maxima of geodesic distance within a 1.4 cm neighbourhood.
cand = []
order = np.argsort(-np.where(fin, dist, -1))
for i in order:
    if not fin[i] or dist[i] < 0.06: break
    if all(np.linalg.norm(P[i] - P[j]) > 0.011 for j in cand):
        # must beat every vertex near it
        near = np.linalg.norm(P - P[i], axis=1) < 0.008
        if dist[i] >= dist[near & fin].max() - 1e-6:
            cand.append(i)
    if len(cand) >= 9: break
Wc = rel[idx][src].mean(0)
def uvg(c):
    q = P[c] - S - Wc
    return round(float(q @ u) * 100, 1), round(float(q @ v) * 100, 1), round(float(dist[c]) * 100, 1)
print("candidates (u, v, geo cm):", [uvg(c) for c in cand])
# Four fingers: the longest tips lying on the finger row; thumb: the shorter tip beyond the index side.
tips4 = sorted(cand[:6], key=lambda c: -dist[c])[:4]
row_u = sorted(float((P[c] - S - Wc) @ u) for c in tips4)
rest = [c for c in cand if c not in tips4 and dist[c] > 0.11]
side = 1 if abs(row_u[-1] - row_u[0]) > 0 else 1
thumb = max(rest, key=lambda c: float((P[c] - S - Wc) @ u))  # beyond the index along u
tips = tips4 + [thumb]

def centre_line(tipi):
    """Walk back from the tip; at each geodesic band take the centroid of nearby band vertices."""
    path = [tipi]
    while prev[path[-1]] >= 0: path.append(prev[path[-1]])
    pts = []
    for k in path[::3]:
        g = dist[k]
        band = fin & (np.abs(dist - g) < 0.002) & (np.linalg.norm(P - P[k], axis=1) < 0.013)
        pts.append((g, P[band].mean(0)))
    return pts  # from tip toward wrist

W = rel[idx][src].mean(0) + S
hand_len = max(dist[tips])
fingers = []
for ti in tips:
    cl = centre_line(ti)
    tipP = P[ti]
    fingers.append({"tip": tipP, "geo": dist[ti], "cl": cl, "u": float((tipP - W) @ u), "v": float((tipP - W) @ v)})
# Order: thumb (largest u), then index..pinky by decreasing u.
fingers.sort(key=lambda f: -f["u"])
print("ordered thumb->pinky (u, v, geo cm):", [(round(f["u"] * 100, 1), round(f["v"] * 100, 1), round(f["geo"] * 100, 1)) for f in fingers])
order = fingers
names = ["Thumb", "Index", "Middle", "Ring", "Pinky"]
# Knuckles sit a palm-length from the wrist (measured on this mesh: palm ~10 cm at 1.65 m).
palm = 0.10 * (co[:, 2].max() / 1.65)
mcp_geo = {"Thumb": palm * 0.35, "Index": palm, "Middle": palm, "Ring": palm * 0.97, "Pinky": palm * 0.9}
for name, f in zip(names, order):
    g_tip = f["geo"]
    def at(g):
        return min(f["cl"], key=lambda gp: abs(gp[0] - g))[1]
    g1 = mcp_geo[name]
    if name == "Thumb":
        gs = [g1, g1 + (g_tip - g1) * 0.45, g1 + (g_tip - g1) * 0.75]
    else:
        gs = [g1, g1 + (g_tip - g1) * 0.5, g1 + (g_tip - g1) * 0.78]
    for i, g in enumerate(gs, 1):
        J[f"LeftHand{name}{i}"] = at(g).tolist()
    J[f"LeftHand{name}4"] = f["tip"].tolist()
J["LeftHand"] = W.tolist()
J["_wristT"] = float(wt)
J["RightIndexTip_hint"] = None
json.dump({k: v for k, v in J.items() if v is not None}, open(sys.argv[2], "w"), indent=1)
print("wrist", np.round(W, 3), "hand geo len", round(hand_len * 100, 1), "cm")
