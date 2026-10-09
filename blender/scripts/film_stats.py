"""Colour statistics of the Part I film (Lab mean/std + luminance percentiles), for grading the game.
Usage: python film_stats.py <video> -> prints JSON"""
import sys, json, subprocess
import numpy as np

W, H = 192, 108
raw = subprocess.run(["ffmpeg", "-v", "error", "-i", sys.argv[1], "-vf", f"fps=1,scale={W}:{H}", "-f", "rawvideo",
                      "-pix_fmt", "rgb24", "-"], capture_output=True, check=True).stdout
fr = np.frombuffer(raw, np.uint8).reshape(-1, H, W, 3)[:, : int(H * 0.8)]      # drop subtitle band
fr = fr[fr.reshape(len(fr), -1).mean(1) > 20]                                    # skip black frames
px = fr.reshape(-1, 3) / 255.0

def srgb_to_lab(c):
    c = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    M = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = c @ M.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 216 / 24389, np.cbrt(xyz), (24389 / 27 * xyz + 16) / 116)
    return np.stack([116 * f[:, 1] - 16, 500 * (f[:, 0] - f[:, 1]), 200 * (f[:, 1] - f[:, 2])], 1)

lab = srgb_to_lab(px)
L = lab[:, 0]
out = {"frames": int(len(fr)), "mean": lab.mean(0).round(2).tolist(), "std": lab.std(0).round(2).tolist(),
       "L_pct": np.percentile(L, [2, 10, 50, 90, 98]).round(1).tolist(),
       # hue of shadows vs highlights (split toning)
       "shadow_ab": lab[L < np.percentile(L, 20), 1:].mean(0).round(2).tolist(),
       "highlight_ab": lab[L > np.percentile(L, 80), 1:].mean(0).round(2).tolist()}
print(json.dumps(out))
