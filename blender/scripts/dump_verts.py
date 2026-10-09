"""Dump world-space vertex positions of the first mesh in a GLB to .npy. -- <glb> <out.npy>"""
import bpy, sys
import numpy as np
path, out = sys.argv[sys.argv.index("--") + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=path)
o = [x for x in bpy.data.objects if x.type == 'MESH'][0]
me = o.data
co = np.empty(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get("co", co)
co = co.reshape(-1, 3)
M = np.array(o.matrix_world)
co = (M[:3, :3] @ co.T).T + M[:3, 3]
np.save(out, co.astype(np.float32)); print("DUMP", co.shape)
