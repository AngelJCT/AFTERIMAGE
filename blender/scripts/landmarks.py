"""Detect skeleton joint positions from an A-pose body scan (metres, Z up, facing -Y, her left = +X).
Run with Blender's bundled python (numpy). Writes a JSON of joint positions."""
import sys, json
import numpy as np

co = np.load(sys.argv[1])["co"]
out = sys.argv[2]
X, Y, Z = co[:, 0], co[:, 1], co[:, 2]
H = Z.max()
J = {}

def slab(z, h=0.004, m=None):
    sel = np.abs(Z - z) < h
    return sel if m is None else sel & m

# ── Crotch: highest z (below the pelvis) where the body has a gap at x≈0.
crotch = None
for z in np.arange(0.95, 0.5, -0.002):
    s = slab(z, 0.003, np.abs(X) < 0.2)
    if s.sum() < 10: continue
    if np.abs(X[s]).min() > 0.006:
        crotch = z; break
J["_crotch"] = float(crotch)

# ── Neck base: scanning up from the chest, first height where width (|y|<0.12, no arms) drops.
torso = (np.abs(Y) < 0.14)
neck_base = None
for z in np.arange(1.15, 1.55, 0.002):
    s = slab(z, 0.003, torso)
    if s.sum() < 10: continue
    w = np.abs(X[s]).max()
    if w < 0.1:
        neck_base = z; break
if neck_base is None:
    # A collar or hood and a full bob can hide the neck (the child): take the narrowest
    # section between them instead.
    best = 9
    for z in np.arange(1.2, 1.5, 0.002):
        s = slab(z, 0.003, torso)
        if s.sum() < 10: continue
        w = np.abs(X[s]).max()
        if w < best: best, neck_base = w, z
J["_neckBase"] = float(neck_base)

def ring_centre(z, mask, h=0.004):
    s = slab(z, h, mask)
    if s.sum() < 5: return None
    p = co[s]
    return (p.max(0) + p.min(0)) / 2

# ── Legs (compute left, mirror to right for a symmetric rig).
legL = (X > 0.005) & (X < 0.2)
ank = None
for z in np.arange(0.03, 0.3, 0.002):
    s = slab(z, 0.003, legL)
    if s.sum() < 5: continue
    if np.ptp(Y[s]) < 0.105:
        ank = z; break
# Chunky boots read as ankle-deep: the joint is never above the boot's heel counter.
ank = min(ank, 0.115)
hipZ = crotch + 0.045
thigh_c = ring_centre(crotch - 0.05, legL)
knee_z = ank + (hipZ - ank) * 0.47
knee_c = ring_centre(knee_z, legL)
ank_c = ring_centre(ank + 0.02, legL)
foot = legL & (Z < 0.045)
toe_y = Y[foot].min()
J["LeftUpLeg"] = [float(thigh_c[0] * 0.92), float(thigh_c[1]), float(hipZ)]
J["LeftLeg"] = [float(knee_c[0]), float(knee_c[1] - 0.012), float(knee_z)]
J["LeftFoot"] = [float(ank_c[0]), float(ank_c[1] + 0.005), float(ank + 0.015)]
J["LeftToeBase"] = [float(ank_c[0]), float(ank_c[1] + (toe_y - ank_c[1]) * 0.68), 0.022]
J["LeftToe_End"] = [float(ank_c[0]), float(toe_y + 0.005), 0.015]

# ── Spine.
pelvis_c = ring_centre(hipZ + 0.02, np.abs(X) < 0.2)
J["Hips"] = [0.0, float(pelvis_c[1]), float(hipZ + 0.02)]
chest_top = neck_base - 0.03
for i, name in enumerate(["Spine", "Spine1", "Spine2"]):
    z = hipZ + 0.02 + (chest_top - hipZ - 0.02) * (0.22 + 0.27 * i)
    c = ring_centre(z, np.abs(X) < 0.1)
    # The spine runs closer to the back than the section centre.
    J[name] = [0.0, float(c[1] + 0.028), float(z)]
nc = ring_centre(neck_base + 0.01, np.abs(X) < 0.06)
J["Neck"] = [0.0, float(nc[1]), float(neck_base)]
J["Head"] = [0.0, float(nc[1] + 0.005), float(neck_base + 0.085)]
J["HeadTop_End"] = [0.0, float(nc[1] + 0.01), float(min(H - 0.03, neck_base + 0.3))]

# ── Arm: shoulder, then axis toward the fingertips, wrist at the narrowest section near the hand.
# Hands hang clear of the thighs in A-pose: legs never reach |x| > 0.19.
armside = (X > 0.2) & (Z > 0.35 * H)   # (not a boot sole that sticks out at the floor)
tip_idx = np.argmin(np.where(armside, Z, 9))
tip = co[tip_idx]
sh_z = neck_base - 0.045
s = slab(sh_z, 0.006, (X > 0) & (np.abs(Y) < 0.1))
sh_x = X[s].max() - 0.05
sh_y = float(np.median(Y[s & (X > X[s].max() - 0.06)]))
S = np.array([sh_x, sh_y, sh_z])
J["LeftShoulder"] = [0.03, float(sh_y + 0.005), float(sh_z + 0.015)]
J["LeftArm"] = S.tolist()
d = tip - S; L = np.linalg.norm(d); d /= L
rel = co - S
t = rel @ d
radial = np.linalg.norm(rel - np.outer(t, d), axis=1)
arm = (X > 0.08) & (t > 0) & (t < L) & (radial < 0.07)
bins = np.arange(0.35 * L, 0.85 * L, 0.005)
prof = []
for b in bins:
    m = arm & (np.abs(t - b) < 0.004)
    prof.append(np.percentile(radial[m], 80) if m.sum() > 8 else 9)
prof = np.array(prof)
# wrist: narrowest point in the 60–82% band
band = (bins > 0.6 * L) & (bins < 0.82 * L)
wt = bins[band][np.argmin(prof[band])]
def arm_centre(tt):
    m = arm & (np.abs(t - tt) < 0.006)
    p = co[m]
    return (p.max(0) + p.min(0)) / 2
W = arm_centre(wt)
E = arm_centre(wt * 0.53)
E[1] += 0.01  # elbow joint sits slightly behind the section centre
J["LeftForeArm"] = E.tolist()
J["LeftHand"] = W.tolist()
J["_armLen"] = float(L); J["_wristT"] = float(wt)
J["_fingertip"] = tip.tolist()
json.dump(J, open(out, "w"), indent=1)
for k, v in J.items(): print(k, np.round(v, 3))
