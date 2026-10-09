"""Fit a head scan onto the body's head (similarity transform: scale, rotation, translation).
Usage: Blender -b -P register_head.py -- <body_prep.npz> <head_pts.npy> <out.json>
head_pts.npy: Nx3 head-scan vertices (scan units, Z up)."""
import sys, json
import numpy as np
from mathutils.kdtree import KDTree

args = sys.argv[sys.argv.index("--") + 1:]
body = np.load(args[0])["co"]
head = np.load(args[1])
out = args[2]
tgt = body[body[:, 2] > 1.38]                     # body head + hair above the collar
Hs = head[:, 2].max()
src_all = head[head[:, 2] > Hs * 0.5]             # scan head + hair (drop shoulders/collar)
rng = np.random.default_rng(0)
src = src_all[rng.choice(len(src_all), min(15000, len(src_all)), replace=False)]

kd = KDTree(len(tgt))
for i, p in enumerate(tgt): kd.insert(p, i)
kd.balance()
def nearest(P):
    idx = np.empty(len(P), dtype=np.int64); d = np.empty(len(P))
    for i, p in enumerate(P):
        _, j, dist = kd.find(p); idx[i] = j; d[i] = dist
    return idx, d

def umeyama(A, B):
    """s, R, t minimising |s R A + t - B|."""
    ma, mb = A.mean(0), B.mean(0); a, b = A - ma, B - mb
    U, S, Vt = np.linalg.svd(b.T @ a / len(A))
    D = np.eye(3); D[2, 2] = np.sign(np.linalg.det(U @ Vt))
    R = U @ D @ Vt
    s = (S * np.diag(D)).sum() / ((a ** 2).sum() / len(A))
    return s, R, mb - s * R @ ma

# Coarse: align top of hair and x/y centres, search scale.
best = None
for s in np.linspace(0.25, 0.9, 27):
    t = np.array([tgt[:, 0].mean() - s * src[:, 0].mean(), tgt[:, 1].mean() - s * src[:, 1].mean(),
                  tgt[:, 2].max() - s * src[:, 2].max()])
    _, d = nearest(src[::10] * s + t)
    score = np.median(d)
    if best is None or score < best[0]: best = (score, s, np.eye(3), t)
_, s, R, t = best
print(f"coarse s={s:.3f} median={best[0]*1000:.1f}mm")
# Trimmed ICP.
for it in range(40):
    P = (s * (R @ src.T)).T + t
    idx, d = nearest(P)
    keep = d < np.percentile(d, 60)
    s2, R2, t2 = umeyama(src[keep], tgt[idx[keep]])
    moved = abs(s2 - s) + np.abs(t2 - t).sum()
    s, R, t = s2, R2, t2
    if moved < 1e-6: break
P = (s * (R @ src.T)).T + t
_, d = nearest(P)
print(f"icp iters={it+1} s={s:.4f} median={np.median(d)*1000:.2f}mm p60={np.percentile(d,60)*1000:.2f}mm p90={np.percentile(d,90)*1000:.1f}mm")
print("R=", np.round(R, 4).tolist(), "t=", np.round(t, 4).tolist())
json.dump({"s": float(s), "R": R.tolist(), "t": t.tolist()}, open(out, "w"))
